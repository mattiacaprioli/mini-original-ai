import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createAgent } from "langchain";
import { createChatModel } from "../src/llm";

// Lo stesso agente, ma con createAgent di LangChain: il ciclo "modello → tool → modello"
// che in src/agent.ts abbiamo scritto a mano, qui lo fa LangChain.
// Uso: bun scripts/agent-v2.ts "la tua domanda"

const adapter = new MCPAdapter({
  servers: {
    negozio: { command: process.execPath, args: ["src/mcp.ts"], cwd: process.cwd() },
    docs: { url: "https://docs.langchain.com/mcp" },
  },
  onConnectionError: "ignore",
});

// Lista dei tool ammessi: due dal negozio, uno (di sola lettura) dalla documentazione LangChain.
const ALLOWED = new Set(["negozio_get_order_status", "negozio_search_knowledge_base", "docs_search_docs_by_lang_chain"]);

try {
  const tools = (await adapter.listTools()).filter((t) => ALLOWED.has(t.name));

  const agent = createAgent({
    model: createChatModel(),
    tools,
    systemPrompt:
      "Sei l'assistente clienti di un e-commerce. Rispondi in italiano, in modo conciso. " +
      "Usa gli strumenti per ordini, regole del negozio e domande su LangChain. Non inventare mai dati.",
  });

  const question = process.argv[2] ?? "A che punto è l'ordine A-1002?";
  console.log(`\nDomanda: ${question}\n`);

  const result = await agent.invoke({ messages: [{ role: "user", content: question }] });

  // Stampiamo i passaggi: ogni messaggio che l'agente ha prodotto lungo il ciclo.
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
