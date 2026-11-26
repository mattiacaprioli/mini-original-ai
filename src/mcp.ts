import type { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";
import { mongo } from "./db";
import { documents } from "./documents";
import { createTools } from "./tools";

// Server MCP: espone gli STESSI tool dell'agente a qualsiasi client MCP
// (Claude Desktop, IDE, altri agenti). Una sola implementazione, due modi di usarla.
//
// Trasporto stdio: il client avvia questo processo e ci parla via stdin/stdout con JSON-RPC.
// Per questo stdout è riservato al protocollo: MAI console.log qui, solo console.error.

// Con stdio non c'è un utente autenticato: il tenant lo decide chi configura il server.
// Con un server MCP remoto (trasporto HTTP) arriverebbe dal token OAuth del client.
const TENANT_ID = process.env.MCP_TENANT_ID ?? "demo";

const server = new McpServer({ name: "mini-original-ai", version: "1.0.0" });

// 1. TOOLS: azioni che il modello del client può chiamare.
const tools: StructuredToolInterface[] = createTools({ tenantId: TENANT_ID });
for (const t of tools) {
  server.registerTool(
    t.name,
    {
      description: t.description,
      inputSchema: t.schema as z.ZodObject, // lo stesso schema Zod usato dall'agente (cast: i tipi LangChain sono più generici)
      annotations: { readOnlyHint: true }, // dichiariamo che non modificano nulla: il client può fidarsi di più
    },
    async (args) => {
      try {
        // Invocato con una ToolCall, il tool restituisce un ToolMessage: testo per il modello + eventuale artifact.
        const message = (await t.invoke({ id: crypto.randomUUID(), name: t.name, args, type: "tool_call" })) as ToolMessage;
        const sources = (message.artifact as { sources?: unknown[] } | undefined)?.sources;
        return {
          content: [{ type: "text" as const, text: String(message.content) }],
          // Le fonti viaggiano come dati strutturati: il client le riceve senza doverle estrarre dal testo.
          ...(sources ? { structuredContent: { sources } } : {}),
        };
      } catch (err) {
        // Errore come risultato (isError), non come eccezione: il modello del client lo vede e può reagire.
        return { isError: true, content: [{ type: "text" as const, text: `Errore: ${(err as Error).message}` }] };
      }
    },
  );
}

// 2. RESOURCES: dati che il client può leggere e mostrare (qui: l'elenco dei documenti caricati).
server.registerResource(
  "documenti",
  "docs://documenti",
  { title: "Documenti della knowledge base", description: "Elenco dei documenti caricati e del loro stato", mimeType: "application/json" },
  async (uri) => {
    const docs = await documents
      .find({ tenantId: TENANT_ID }, { projection: { _id: 0, filename: 1, status: 1, chunks: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(docs, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Server MCP "mini-original-ai" avviato (tenant: ${TENANT_ID})`);

// Il client chiude stdin quando ha finito: chiudiamo anche la connessione a MongoDB.
transport.onclose = async () => {
  await mongo.close();
  process.exit(0);
};
