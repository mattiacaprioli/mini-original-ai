import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { streamAgent } from "./agent";
import { ensureIndexes, loadHistory, saveMessage } from "./conversations";
import { createChatModel } from "./llm";
import { sseResponse, type StreamEvent } from "./sse";

const model = createChatModel();

const ChatRequest = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.uuid().optional(), // assente = nuova conversazione
});

// Fail fast: se MongoDB non risponde, meglio fermarsi subito con un messaggio chiaro.
try {
  await ensureIndexes();
} catch (err) {
  console.error("MongoDB non raggiungibile. Hai avviato `docker compose up -d`?\n", (err as Error).message);
  process.exit(1);
}

async function* streamChat(message: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const stream = await model.stream(
    [
      new SystemMessage("Sei un assistente aziendale. Rispondi in italiano, in modo conciso."),
      new HumanMessage(message),
    ],
    { signal },
  );
  for await (const chunk of stream) {
    if (chunk.text) yield { type: "token", text: chunk.text };
  }
}

// Avvolge l'agente: legge la storia prima, salva domanda e risposta.
// L'agente resta "puro": non sa niente di database.
async function* agentWithMemory(
  conversationId: string,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // 1. Diciamo subito al client l'id della conversazione, così lo rimanda al messaggio successivo.
  yield { type: "meta", conversationId };

  // 2. Storia PRIMA di salvare il nuovo messaggio (l'agente lo aggiunge da sé).
  const history = await loadHistory(conversationId);
  await saveMessage(conversationId, "user", message);

  let answer = "";
  let completed = false;
  try {
    for await (const event of streamAgent(history, message, signal)) {
      if (event.type === "token") answer += event.text;
      yield event;
    }
    completed = true;
  } finally {
    // finally gira anche se l'utente preme Stop: salviamo la risposta parziale, marcata come interrotta.
    if (answer) await saveMessage(conversationId, "assistant", answer, !completed);
  }
}

const server = Bun.serve({
  port: 3000,
  idleTimeout: 120,
  routes: {
    "/health": new Response("ok"),

    "/chat": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "richiesta non valida" }, { status: 400 });
        return sseResponse(streamChat(parsed.data.message, req.signal), req.signal);
      },
    },

    "/agent": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "richiesta non valida" }, { status: 400 });

        // In produzione: verificare che la conversazione appartenga all'utente autenticato,
        // altrimenti chiunque conosca un id potrebbe leggere la chat di un altro.
        const conversationId = parsed.data.conversationId ?? crypto.randomUUID();
        return sseResponse(agentWithMemory(conversationId, parsed.data.message, req.signal), req.signal);
      },
    },
  },
});

console.log(`Server su ${server.url}`);