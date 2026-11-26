import type { StructuredToolInterface } from "@langchain/core/tools";
import { MCPAdapter } from "@langchain/mcp-adapters";

// I server MCP a cui si collega l'agente. Per aggiungerne uno basta una voce qui.
const adapter = new MCPAdapter({
  servers: {
    // Il nostro server: l'adapter lo avvia come processo figlio (stdio).
    // cwd = cartella del progetto, così il processo figlio legge lo stesso .env.
    negozio: { command: process.execPath, args: ["src/mcp.ts"], cwd: process.cwd() },
  },
  // Default "throw": se il server del negozio non parte, il server della chat si ferma subito con un errore chiaro.
});

// Lista dei tool ammessi: l'agente usa SOLO questi, anche se un server ne espone altri.
// Un server può aggiungere tool in qualsiasi momento (es. uno che invia dati all'esterno):
// senza questa lista, l'agente li userebbe senza che nessuno l'abbia deciso.
const ALLOWED_TOOLS = new Set(["negozio_get_order_status", "negozio_search_knowledge_base"]);

let tools: StructuredToolInterface[] | undefined;

// Carica i tool una volta sola (all'avvio) e li riusa per ogni richiesta.
export async function loadMcpTools() {
  tools ??= (await adapter.listTools()).filter((t) => ALLOWED_TOOLS.has(t.name));
  return tools;
}

export const closeMcp = () => adapter.close();
