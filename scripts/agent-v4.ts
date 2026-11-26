// Passo 10b: l'agente usa il server negozio via HTTP e resiste a un server LENTO o SPENTO.
// Uso: bun scripts/agent-v4.ts "domanda"   (con bun src/mcp-http.ts avviato in un altro terminale)
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createAgent, toolCallLimitMiddleware, toolRetryMiddleware } from "langchain";
import { createChatModel } from "../src/llm";
import { guardrails, toolResultToText } from "./agent-v3";

const adapter = new MCPAdapter({
  servers: {
    negozio: {
      url: process.env.NEGOZIO_URL ?? "http://localhost:3001/mcp",
      headers: { Authorization: `Bearer ${process.env.NEGOZIO_TOKEN ?? "dev-demo"}` },
      defaultToolTimeout: 2000, // LENTO: dopo 2 secondi la chiamata al tool fallisce
    },
    docs: { url: "https://docs.langchain.com/mcp", defaultToolTimeout: 5000 },
  },
  onConnectionError: "ignore", // SPENTO: il server viene saltato, gli altri funzionano
});

const ALLOWED = new Set(["negozio_get_order_status", "negozio_search_knowledge_base", "docs_search_docs_by_lang_chain"]);

try {
  const tools = (await adapter.listTools()).filter((t) => ALLOWED.has(t.name));
  console.log(`Tool disponibili: ${tools.map((t) => t.name).join(", ") || "nessuno"}`);

  const agent = createAgent({
    model: createChatModel(),
    tools,
    middleware: [
      guardrails,
      toolResultToText,
      // Errore o timeout → 1 nuovo tentativo dopo 300 ms; se fallisce ancora, il ToolMessage torna con status "error".
      toolRetryMiddleware({ maxRetries: 1, initialDelayMs: 300, onFailure: "continue" }),
      toolCallLimitMiddleware({ runLimit: 5 }),
    ],
    systemPrompt:
      "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
      "Rispondi SOLO usando i risultati degli strumenti. Se non contengono la risposta, dillo. Non inventare mai dati.",
  });

  const question = process.argv[2] ?? "A che punto è l'ordine A-1002?";
  console.log(`\nDomanda: ${question}\n`);

  const start = Date.now();
  const result = await agent.invoke({ messages: [{ role: "user", content: question }] });

  for (const m of result.messages) {
    if (AIMessage.isInstance(m) && m.tool_calls?.length) {
      for (const c of m.tool_calls) console.log(`→ chiama ${c.name} ${JSON.stringify(c.args)}`);
    } else if (ToolMessage.isInstance(m)) {
      console.log(`← ${m.status === "error" ? "ERRORE" : "risultato"}: ${String(m.content).replace(/\s+/g, " ").slice(0, 100)}…`);
    }
  }
  console.log(`\nRisposta: ${result.messages.at(-1)?.text}`);
  console.log(`(tempo: ${((Date.now() - start) / 1000).toFixed(1)} s)\n`);
} finally {
  await adapter.close();
}
