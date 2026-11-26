import { MCPAdapter } from "@langchain/mcp-adapters";

// L'agente come CLIENT MCP: si collega a due server e chiede "che strumenti hai?".
const adapter = new MCPAdapter({
  servers: {
    // 1. Il TUO server, sul computer (stdio): l'adapter lo avvia da solo.
    negozio: { command: process.execPath, args: ["src/mcp.ts"] },
    // 2. Un server remoto e pubblico (HTTP): la documentazione di LangChain.
    docs: { url: "https://docs.langchain.com/mcp" },
  },
  onConnectionError: "ignore", // se un server non risponde, continua con gli altri
});

try {
  const tools = await adapter.listTools();
  for (const t of tools) console.log(`- ${t.name}`);
} finally {
  await adapter.close(); // chiude le connessioni e spegne il server locale
}
