import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type AIMessageChunk, type BaseMessage, type ToolCall } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createChatModel } from "./llm";
import type { StreamEvent } from "./sse";
import { tools } from "./tools";

const MAX_STEPS = 5;
const ORDER_CODE = /\bA-\d{4}\b/gi;

const model = createChatModel().bindTools(tools);
const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]));

// Esegue un tool, avvisa il client prima e dopo, e aggiunge il risultato alla conversazione.
// La usano sia il guardrail iniziale sia il ciclo dell'agente.
async function* runTool(call: ToolCall, messages: BaseMessage[]): AsyncGenerator<StreamEvent> {
  const id = call.id!;
  yield { type: "tool_start", id, name: call.name, args: call.args };

  const started = performance.now();
  let result: string;
  let ok = true;
  try {
    const selected = toolsByName.get(call.name);
    if (!selected) throw new Error(`tool sconosciuto: ${call.name}`);
    result = String(await selected.invoke(call.args));
  } catch (err) {
    ok = false;
    result = `Errore: ${(err as Error).message}`;
  }

  // Al client mandiamo solo l'esito, non il risultato grezzo: può contenere dati interni.
  yield { type: "tool_end", id, name: call.name, ok, ms: Math.round(performance.now() - started) };
  messages.push(new ToolMessage({ content: result, tool_call_id: id }));
}

export async function* streamAgent(
  history: BaseMessage[],
  userMessage: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const messages: BaseMessage[] = [
    new SystemMessage(
      "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
        "Per domande su un ordine usa sempre lo strumento get_order_status: non inventare mai stati o date. " +
        "Se un'informazione non arriva da uno strumento, di' che non la conosci e suggerisci di contattare il supporto. Non inventare mai orari, prezzi o policy. " +
        "Non nominare mai gli strumenti all'utente.",
    ),
    ...history, // i messaggi precedenti della conversazione, letti da MongoDB
    new HumanMessage(userMessage),
  ];

  // Guardrail deterministico: se il messaggio contiene codici ordine, il tool lo chiamiamo NOI,
  // senza lasciare la decisione al modello. Il modello riceve i dati veri e deve solo scrivere la risposta.
  const codes = [...new Set((userMessage.match(ORDER_CODE) ?? []).map((c) => c.toUpperCase()))];
  if (codes.length > 0) {
    const calls: ToolCall[] = codes.map((orderId) => ({
      id: crypto.randomUUID(),
      name: "get_order_status",
      args: { orderId },
      type: "tool_call",
    }));
    // Una richiesta di tool "come se l'avesse fatta il modello", seguita dai risultati veri.
    messages.push(new AIMessage({ content: "", tool_calls: calls }));
    for (const call of calls) yield* runTool(call, messages);
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    let full: AIMessageChunk | undefined;
    for await (const chunk of await model.stream(messages, { signal })) {
      full = full ? full.concat(chunk) : chunk;
      if (chunk.text) yield { type: "token", text: chunk.text };
    }
    if (!full) throw new Error("Risposta vuota dal modello");
    messages.push(full);

    const toolCalls = full.tool_calls ?? [];
    if (toolCalls.length === 0) return;

    // yield* = inoltra tutti gli eventi prodotti da runTool, come se fossero nostri.
    for (const call of toolCalls) yield* runTool(call, messages);
  }

  yield { type: "token", text: "Non sono riuscito a completare la richiesta." };
}