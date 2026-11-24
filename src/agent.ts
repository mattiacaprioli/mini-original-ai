import { HumanMessage, SystemMessage, ToolMessage, type AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createChatModel } from "./llm";
import type { StreamEvent } from "./sse";
import { tools } from "./tools";

const MAX_STEPS = 5; // senza limite un agente può girare in loop e consumare token all'infinito

// bindTools: allega gli schemi dei tool a ogni chiamata, così il modello sa che esistono.
const model = createChatModel().bindTools(tools);
const toolsByName = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]));
// emette eventi (yield) man mano che succedono. Chi lo consuma li riceve in tempo reale.
export async function* streamAgent(userMessage: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const messages: BaseMessage[] = [
    new SystemMessage(
      "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
        "Per domande su un ordine usa sempre lo strumento get_order_status: non inventare mai stati o date. " +
        "Se un'informazione non arriva da uno strumento, di' che non la conosci e suggerisci di contattare il supporto. Non inventare mai orari, prezzi o policy.",
    ),
    new HumanMessage(userMessage),
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    // 1. stream() invece di invoke(): i token arrivano a pezzi.
    //    Li inoltriamo subito al client e intanto li accumuliamo per avere il messaggio completo.
    let full: AIMessageChunk | undefined;
    for await (const chunk of await model.stream(messages, { signal })) {
      full = full ? full.concat(chunk) : chunk;
      if (chunk.text) yield { type: "token", text: chunk.text };
    }
    if (!full) throw new Error("Risposta vuota dal modello");
    messages.push(full);

    // 2. Le tool call si conoscono solo a stream finito, quando i pezzi sono stati riuniti.
    const toolCalls = full.tool_calls ?? [];
    if (toolCalls.length === 0) return; // risposta finale: già inviata token per token

    // 3. Eseguiamo i tool, avvisando il client prima e dopo.
    for (const call of toolCalls) {
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
  }

  yield { type: "token", text: "Non sono riuscito a completare la richiesta." };
}