import type { ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { documents } from "./documents";
import { createTools } from "./tools";

// Crea il server MCP per UN tenant. Lo usano sia il trasporto stdio (src/mcp.ts)
// sia quello HTTP (src/mcp-http.ts): stessi tool, cambia solo come arrivano le richieste.
export function createMcpServer(tenantId: string): McpServer {
  const server = new McpServer({ name: "mini-original-ai", version: "1.0.0" });

  // 1. TOOLS: azioni che il modello del client può chiamare.
  const tools: StructuredToolInterface[] = createTools({ tenantId });
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
        .find({ tenantId }, { projection: { _id: 0, filename: 1, status: 1, chunks: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(docs, null, 2) }] };
    },
  );

  return server;
}
