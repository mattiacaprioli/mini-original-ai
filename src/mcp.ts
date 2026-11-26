import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mongo } from "./db";
import { createMcpServer } from "./mcp-server";

// Trasporto STDIO: il client avvia questo processo e ci parla via stdin/stdout con JSON-RPC.
// Per questo stdout è riservato al protocollo: MAI console.log qui, solo console.error.

// Con stdio non c'è un utente autenticato: il tenant lo decide chi configura il server.
// Con il trasporto HTTP (src/mcp-http.ts) arriva invece dal token del client.
const TENANT_ID = process.env.MCP_TENANT_ID ?? "demo";

const server = createMcpServer(TENANT_ID);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Server MCP "mini-original-ai" avviato (tenant: ${TENANT_ID})`);

// Il client chiude stdin quando ha finito: chiudiamo anche la connessione a MongoDB.
transport.onclose = async () => {
  await mongo.close();
  process.exit(0);
};
