import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type AIMessageChunk, type BaseMessage, type ToolCall } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createChatModel } from "./llm";
import type { StreamEvent } from "./sse";
import { createTools, type Source } from "./tools";

const MAX_STEPS = 5;
const ORDER_CODE = /\bA-\d{4}\b/gi;
// Saluti e ringraziamenti brevi: non serve cercare nei documenti (e il 7B li userebbe a sproposito).
const SMALL_TALK = /^\s*(ciao|salve|buongiorno|buonasera|grazie|ok|perfetto|ottimo)\b[\s\S]{0,30}$/i;

const SYSTEM_PROMPT =
  "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
  "Per domande su un ordine usa sempre lo strumento get_order_status: non inventare mai stati o date. " +
  "Per regole e informazioni del negozio rispondi solo con i risultati della ricerca nei documenti e cita la fonte con il suo numero, es. [1]. " +
  "Se un'informazione non arriva da uno strumento, di' che non la conosci e suggerisci di contattare il supporto. Non inventare mai orari, prezzi o policy. " +
  "Non nominare mai gli strumenti all'utente.";

const REWRITE_PROMPT =
  "Riscrivi l'ultimo messaggio dell'utente come una domanda completa e comprensibile da sola, usando la conversazione precedente " +
  "per sostituire riferimenti come 'quello', 'e quando', 'e il sabato'. Mantieni codici, numeri e nomi esatti. " +
  "Se il messaggio è già completo, restituiscilo uguale. Rispondi SOLO con la domanda riscritta, senza spiegazioni.";

const baseModel = createChatModel();

// "e quando arriva?" da solo non dice niente a una ricerca. Con la storia diventa
// "Quando arriva l'ordine A-1002?": una domanda che si può cercare (e che fa scattare il guardrail).
async function rewriteQuestion(history: BaseMessage[], message: string, signal: AbortSignal) {
  if (history.length === 0) return message; // prima domanda: niente da riscrivere, nessuna chiamata in più
  const conversation = history
    .map((m) => `${HumanMessage.isInstance(m) ? "Utente" : "Assistente"}: ${m.text}`)
    .join("\n");
  const response = await baseModel.invoke(
    [
      new SystemMessage(REWRITE_PROMPT),
      new HumanMessage(`Conversazione:\n${conversation}\n\nUltimo messaggio: ${message}`),
    ],
    { signal },
  );
  return response.text.trim() || message;
}

// Esegue un tool, avvisa il client prima e dopo, e aggiunge il risultato alla conversazione.
async function* runTool(
  call: ToolCall,
  messages: BaseMessage[],
  toolsByName: Map<string, StructuredToolInterface>,
): AsyncGenerator<StreamEvent> {
  const id = call.id!;
  yield { type: "tool_start", id, name: call.name, args: call.args };

  const started = performance.now();
  let message: ToolMessage;
  let ok = true;
  try {
    const selected = toolsByName.get(call.name);
    if (!selected) throw new Error(`tool sconosciuto: ${call.name}`);
    // Invocato con la ToolCall intera, il tool restituisce direttamente un ToolMessage
    // (con l'eventuale "artifact": dati per noi che il modello non vede).
    message = (await selected.invoke({ ...call, type: "tool_call" })) as ToolMessage;
  } catch (err) {
    ok = false;
    message = new ToolMessage({ content: `Errore: ${(err as Error).message}`, tool_call_id: id });
  }

  yield { type: "tool_end", id, name: call.name, ok, ms: Math.round(performance.now() - started) };

  // Le fonti arrivano al client dal codice, non dal testo del modello: sono sempre affidabili.
  const sources = (message.artifact as { sources?: Source[] } | undefined)?.sources;
  if (sources?.length) yield { type: "sources", sources };

  messages.push(message);
}

export async function* streamAgent(
  history: BaseMessage[],
  userMessage: string,
  signal: AbortSignal,
  ctx: { tenantId: string },
): AsyncGenerator<StreamEvent> {
  // Tool creati per questa richiesta, con il tenant dell'utente.
  const tools = createTools(ctx);
  const model = baseModel.bindTools(tools);
  const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    ...history, // i messaggi precedenti della conversazione, letti da MongoDB
    new HumanMessage(userMessage),
  ];

  // Recupero deterministico: è il CODICE a decidere cosa cercare, non il modello.
  // Nei test il 7B non chiamava la ricerca da solo e inventava ("sì, spediamo in Giappone").
  if (!SMALL_TALK.test(userMessage)) {
    const question = await rewriteQuestion(history, userMessage, signal);
    const codes = [...new Set((question.match(ORDER_CODE) ?? []).map((c) => c.toUpperCase()))];

    // Codice ordine presente → dati dell'ordine. Altrimenti → ricerca nei documenti.
    const calls: ToolCall[] =
      codes.length > 0
        ? codes.map((orderId) => ({ id: crypto.randomUUID(), name: "get_order_status", args: { orderId }, type: "tool_call" }))
        : [{ id: crypto.randomUUID(), name: "search_knowledge_base", args: { query: question }, type: "tool_call" }];

    // Una richiesta di tool "come se l'avesse fatta il modello", seguita dai risultati veri.
    messages.push(new AIMessage({ content: "", tool_calls: calls }));
    for (const call of calls) yield* runTool(call, messages, toolsByName);
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

    // Il modello può comunque chiamare altri tool da solo (es. una seconda ricerca).
    for (const call of toolCalls) yield* runTool(call, messages, toolsByName);
  }

  yield { type: "token", text: "Non sono riuscito a completare la richiesta." };
}
