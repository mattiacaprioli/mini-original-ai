// Passo 9b: lo stesso agente del passo 9a, ma con i guardrail rimessi come MIDDLEWARE.
// Uso: bun scripts/agent-v3.ts "domanda"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createAgent, createMiddleware, toolCallLimitMiddleware } from "langchain";
import { createChatModel } from "../src/llm";

const ORDER_TOOL = "negozio_get_order_status";
const SEARCH_TOOL = "negozio_search_knowledge_base";
const DOCS_TOOL = "docs_search_docs_by_lang_chain";

const ORDER_CODE = /\bA-\d{4}\b/gi;
const LANGCHAIN_TOPIC = /\b(langchain|langgraph|mcp)\b/i;
const SMALL_TALK = /^(ciao|grazie|ok|salve|buongiorno|buonasera)\b[\s!.]*$/i;

// Il CODICE decide quale tool chiamare, non il modello 7B.
function route(text: string, available: Set<string>): AIMessage | undefined {
  if (SMALL_TALK.test(text.trim())) return undefined;

  const codes = [...new Set((text.match(ORDER_CODE) ?? []).map((c) => c.toUpperCase()))];
  const calls = codes.length
    ? codes.map((orderId) => ({ name: ORDER_TOOL, args: { orderId } }))
    : LANGCHAIN_TOPIC.test(text) && available.has(DOCS_TOOL) // se il server docs è giù → ripiego sul negozio
      ? [{ name: DOCS_TOOL, args: { query: text } }]
      : [{ name: SEARCH_TOOL, args: { query: text } }];

  return new AIMessage({
    content: "",
    tool_calls: calls.map((c) => ({ ...c, id: crypto.randomUUID(), type: "tool_call" as const })),
  });
}

export const guardrails = createMiddleware({
  name: "Guardrails",
  wrapModelCall: async (request, handler) => {
    const last = request.messages.at(-1);

    // 1° giro (ultimo messaggio = utente): niente modello, la chiamata al tool la costruiamo noi.
    if (HumanMessage.isInstance(last)) {
      const available = new Set(request.tools.map((t) => String(t.name)));
      const forced = route(last.text, available);
      if (forced) return forced;
    }

    // Giri successivi (o small talk): il modello deve solo RISPONDERE, senza tool.
    const response = await handler({ ...request, tools: [] });
    // Difesa in più: se il modello prova comunque a chiamare un tool, lo ignoriamo.
    return response.tool_calls?.length ? new AIMessage({ content: response.content }) : response;
  },
});

// I server MCP esterni possono rispondere con una LISTA di blocchi; Ollama accetta solo stringhe.
// Questo middleware sta tra il tool e il modello e "traduce" il risultato.
const MAX_TOOL_CHARS = 4000; // i risultati della doc sono lunghi: il 7B ha poco contesto

export const toolResultToText = createMiddleware({
  name: "ToolResultToText",
  wrapToolCall: async (request, handler) => {
    const result = await handler(request);
    if (!ToolMessage.isInstance(result)) return result;

    const text =
      typeof result.content === "string"
        ? result.content
        : result.content.map((b) => ("text" in b && typeof b.text === "string" ? b.text : JSON.stringify(b))).join("\n\n");

    return new ToolMessage({
      content: text.slice(0, MAX_TOOL_CHARS),
      tool_call_id: result.tool_call_id,
      name: result.name,
      artifact: result.artifact, // le fonti (structuredContent) restano qui
      status: result.status,
    });
  },
});

// Solo se il file viene eseguito direttamente (non quando lo importiamo nei test).
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
