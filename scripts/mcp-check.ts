import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

// Un client MCP minimo: avvia il server come farebbe Claude Desktop e prova tool e risorse.
// Uso: bun scripts/mcp-check.ts
const transport = new StdioClientTransport({
  command: process.execPath, // lo stesso bun che sta eseguendo questo script
  args: ["src/mcp.ts"],
  cwd: join(import.meta.dir, ".."), // la cartella del progetto: lì Bun trova il file .env
  stderr: "inherit", // i log del server (console.error) compaiono qui
});

const client = new Client({ name: "mcp-check", version: "1.0.0" });
await client.connect(transport);

const text = (result: unknown) => {
  const r = result as { isError?: boolean; content: { text: string }[] };
  return (r.isError ? "ERRORE: " : "") + r.content[0]!.text;
};

console.log("\n== Tool esposti ==");
for (const tool of (await client.listTools()).tools) console.log(`- ${tool.name}: ${tool.description}`);

console.log("\n== Risorsa docs://documenti ==");
const resource = await client.readResource({ uri: "docs://documenti" });
console.log((resource.contents[0] as { text: string }).text);

console.log("\n== get_order_status A-1002 ==");
console.log(text(await client.callTool({ name: "get_order_status", arguments: { orderId: "A-1002" } })));

for (const query of ["orari servizio clienti", "Spedite in Giappone?"]) {
  console.log(`\n== search_knowledge_base "${query}" ==`);
  console.log(text(await client.callTool({ name: "search_knowledge_base", arguments: { query } })).slice(0, 400));
}

await client.close();
