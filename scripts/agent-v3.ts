// Passo 9b: lo stesso agente del passo 9a, ma con i guardrail rimessi come MIDDLEWARE (in src/middleware.ts).
// Uso: bun scripts/agent-v3.ts "domanda"
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createAgent, toolCallLimitMiddleware } from "langchain";
import { createChatModel } from "../src/llm";
import { DOCS_TOOL, guardrails, ORDER_TOOL, SEARCH_TOOL, toolResultToText } from "../src/middleware";

if (import.meta.main) {
  const adapter = new MCPAdapter({
    servers: {
      negozio: { command: process.execPath, args: ["src/mcp.ts"], cwd: process.cwd() },
      docs: { url: "https://docs.langchain.com/mcp" },
    },
    onConnectionError: "ignore",
  });
  const ALLOWED = new Set([ORDER_TOOL, SEARCH_TOOL, DOCS_TOOL]);

  try {
    const tools = (await adapter.listTools()).filter((t) => ALLOWED.has(t.name));

    const agent = createAgent({
      model: createChatModel(),
      tools,
      middleware: [guardrails, toolResultToText, toolCallLimitMiddleware({ runLimit: 5 })], // runLimit = il tuo MAX_STEPS
      systemPrompt:
        "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
        "Rispondi SOLO usando i risultati degli strumenti. Se non contengono la risposta, dillo. Non inventare mai dati.",
    });

    const question = process.argv[2] ?? "A che punto è l'ordine A-1002?";
    console.log(`\nDomanda: ${question}\n`);

    const result = await agent.invoke({ messages: [{ role: "user", content: question }] });

    for (const m of result.messages) {
      if (AIMessage.isInstance(m) && m.tool_calls?.length) {
        for (const c of m.tool_calls) console.log(`→ chiama ${c.name} ${JSON.stringify(c.args)}`);
      } else if (ToolMessage.isInstance(m)) {
        console.log(`← risultato: ${String(m.content).replace(/\s+/g, " ").slice(0, 100)}…`);
      }
    }
    console.log(`\nRisposta: ${result.messages.at(-1)?.text}\n`);
  } finally {
    await adapter.close();
  }
}
