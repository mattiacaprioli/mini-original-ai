import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-server";

// Trasporto STREAMABLE HTTP: il server MCP è un servizio di rete, non un processo figlio.
// Più client (anche remoti) possono collegarsi, quindi serve sapere CHI sta chiamando.
//
// Regola di sicurezza: il tenant arriva SOLO dal token, mai dagli argomenti del tool.
// Così un modello (o un prompt malevolo) non può chiedere i dati di un altro cliente.

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3001);
const SLOW_MS = Number(process.env.MCP_SLOW_MS ?? 0);

// In produzione: token OAuth verificato (firma, scadenza, scope). Qui: una mappa token → tenant.
// Formato: MCP_TOKENS="token1=tenantA,token2=tenantB"
const TOKENS = new Map(
  (process.env.MCP_TOKENS ?? "dev-demo=demo,dev-acme=acme").split(",").map((pair) => pair.split("=") as [string, string]),
);

function tenantFromRequest(req: Request): string | undefined {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  return token ? TOKENS.get(token) : undefined;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });

    const tenantId = tenantFromRequest(req);
    if (!tenantId) {
      // 401 + WWW-Authenticate: è la risposta standard che dice al client "serve un token".
      return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }

    // SOLO PER TEST (passo 10b): MCP_SLOW_MS=5000 rallenta le chiamate ai tool per simulare un server lento.
    if (SLOW_MS) {
      const body = (await req.clone().json().catch(() => null)) as { method?: string } | null;
      if (body?.method === "tools/call") await Bun.sleep(SLOW_MS);
    }

    // Modalità STATELESS: un server e un trasporto nuovi per ogni richiesta, nessuna sessione in memoria.
    // Più semplice da scalare (più istanze dietro un load balancer) e il tenant non si "mescola" mai.
    const server = createMcpServer(tenantId);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  },
});

console.log(`Server MCP HTTP su http://localhost:${PORT}/mcp`);
