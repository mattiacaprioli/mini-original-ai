// Passo 10a: proviamo il server MCP HTTP con token diversi.
// Prima avvia il server in un altro terminale: bun src/mcp-http.ts
import { MCPAdapter } from "@langchain/mcp-adapters";

const URL = "http://localhost:3001/mcp";

async function tryToken(label: string, token?: string) {
  console.log(`\n=== ${label} ===`);
  const adapter = new MCPAdapter({
    servers: { negozio: { url: URL, headers: token ? { Authorization: `Bearer ${token}` } : {} } },
    onConnectionError: "throw", // qui vogliamo VEDERE l'errore
  });
  try {
    const tools = await adapter.listTools();
    console.log("tool:", tools.map((t) => t.name).join(", "));

    const search = tools.find((t) => t.name === "negozio_search_knowledge_base")!;
    const result = await search.invoke({ query: "Spedite in Giappone?" });
    const text = Array.isArray(result) ? String(result[0]) : String(result);
    console.log("ricerca:", text.replace(/\s+/g, " ").slice(0, 120));
  } catch (err) {
    console.log("errore:", (err as Error).message.slice(0, 120));
  } finally {
    await adapter.close();
  }
}

await tryToken("senza token");
await tryToken("token tenant demo", "dev-demo");
await tryToken("token tenant acme", "dev-acme");
