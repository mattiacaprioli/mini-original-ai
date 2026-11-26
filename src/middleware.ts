// Middleware dell'agente (passi 9b e 10b): li usano gli script agent-v3/v4 e i test.
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

export const ORDER_TOOL = "negozio_get_order_status";
export const SEARCH_TOOL = "negozio_search_knowledge_base";
export const DOCS_TOOL = "docs_search_docs_by_lang_chain";

const ORDER_CODE = /\bA-\d{4}\b/gi;
const LANGCHAIN_TOPIC = /\b(langchain|langgraph|mcp)\b/i;
const SMALL_TALK = /^(ciao|grazie|ok|salve|buongiorno|buonasera)\b[\s!.]*$/i;

export const UNAVAILABLE = "Il servizio non è disponibile in questo momento. Riprova tra qualche minuto.";

// Il CODICE decide quale tool chiamare, non il modello 7B.
function route(text: string, available: Set<string>): AIMessage | undefined {
  if (SMALL_TALK.test(text.trim())) return undefined;

  const codes = [...new Set((text.match(ORDER_CODE) ?? []).map((c) => c.toUpperCase()))];
  const calls = codes.length
    ? codes.map((orderId) => ({ name: ORDER_TOOL, args: { orderId } }))
    : LANGCHAIN_TOPIC.test(text) && available.has(DOCS_TOOL) // se il server docs è giù → ripiego sul negozio
      ? [{ name: DOCS_TOOL, args: { query: text } }]
      : [{ name: SEARCH_TOOL, args: { query: text } }];

  // Server spento all'avvio → il suo tool non c'è: rispondiamo noi, senza far inventare il modello.
  if (calls.some((c) => !available.has(c.name))) return new AIMessage(UNAVAILABLE);

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

    // Tutti i tool appena chiamati sono falliti (timeout, server giù) → risposta fissa, niente modello.
    const lastResults: ToolMessage[] = [];
    for (const m of [...request.messages].reverse()) {
      if (!ToolMessage.isInstance(m)) break;
      lastResults.push(m);
    }
    if (lastResults.length && lastResults.every((m) => m.status === "error")) return new AIMessage(UNAVAILABLE);

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
