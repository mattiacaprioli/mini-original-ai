import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { streamAgent } from "./agent";
import { createChatModel } from "./llm";
import { sseResponse, type StreamEvent } from "./sse";

const model = createChatModel();
const ChatRequest = z.object({ message:z.string().min(1).max(4000) });

// La chat semplice del passo 1, riscritta come generatore di eventi.
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

const server = Bun.serve({
  port: 3000,
  idleTimeout: 120,
  routes: {
    "/health": new Response("ok"),

    "/chat": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "message richiesto" }, { status: 400 });
        return sseResponse(streamChat(parsed.data.message, req.signal), req.signal);
      },
    },

    "/agent": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "message richiesto" }, { status: 400 });
        return sseResponse(streamAgent(parsed.data.message, req.signal), req.signal);
      },
    },
  },
});

console.log(`Server su ${server.url}`);