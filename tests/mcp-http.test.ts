// Test del server MCP HTTP vero: lo avviamo come processo separato su porte di test.
// Usa solo get_order_status (dati finti in memoria): non servono MongoDB né Ollama.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createAgent, FakeToolCallingModel, toolRetryMiddleware } from "langchain";
import { guardrails, ORDER_TOOL, UNAVAILABLE } from "../src/middleware";

const FAST = 3901; // server normale
const SLOW = 3902; // server lento (2 s per ogni tool)
const DOWN = 3903; // nessun server: simula un server spento

const servers: Bun.Subprocess[] = [];

async function startServer(port: number, env: Record<string, string> = {}) {
  servers.push(Bun.spawn(["bun", "src/mcp-http.ts"], { env: { ...process.env, MCP_HTTP_PORT: String(port), ...env }, stdout: "ignore" }));
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://localhost:${port}/health`).then((r) => r.ok).catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`server sulla porta ${port} non partito`);
}

beforeAll(async () => {
  await Promise.all([startServer(FAST), startServer(SLOW, { MCP_SLOW_MS: "2000" })]);
});
afterAll(() => servers.forEach((s) => s.kill()));

const adapterFor = (port: number, token?: string) =>
  new MCPAdapter({
    servers: {
      negozio: {
        url: `http://localhost:${port}/mcp`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        defaultToolTimeout: 500,
      },
    },
    onConnectionError: "ignore",
  });

async function askOrder(port: number) {
  const adapter = adapterFor(port, "dev-demo");
  try {
    const tools = await adapter.listTools();
    const agent = createAgent({
      model: new FakeToolCallingModel({}),
      tools,
      middleware: [guardrails, toolRetryMiddleware({ maxRetries: 1, initialDelayMs: 50, onFailure: "continue" })],
    });
    const result = await agent.invoke({ messages: [{ role: "user", content: "A-1002?" }] });
    return result.messages;
  } finally {
    await adapter.close();
  }
}

describe("autenticazione", () => {
  const initialize = (token?: string) =>
    fetch(`http://localhost:${FAST}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });

  test("senza token → 401", async () => {
    expect((await initialize()).status).toBe(401);
  });

  test("token sbagliato → 401", async () => {
    expect((await initialize("rubato")).status).toBe(401);
  });

  test("token valido → 200", async () => {
    expect((await initialize("dev-demo")).status).toBe(200);
  });
});

describe("agente + server MCP HTTP", () => {
  test("server normale → il tool risponde con i dati dell'ordine", async () => {
    const messages = await askOrder(FAST);
    const toolResult = messages.find((m) => m.type === "tool");
    expect(String(toolResult?.content)).toContain("in preparazione");
  });

  test("server lento → timeout, nuovo tentativo, poi risposta fissa", async () => {
    const start = Date.now();
    const messages = await askOrder(SLOW);
    expect(messages.at(-1)?.text).toBe(UNAVAILABLE);
    expect(Date.now() - start).toBeLessThan(2000); // non aspettiamo i 2 s del server
  });

  test("server spento → i suoi tool spariscono, risposta fissa subito", async () => {
    const adapter = adapterFor(DOWN, "dev-demo");
    const tools = await adapter.listTools();
    await adapter.close();
    expect(tools.map((t) => t.name)).not.toContain(ORDER_TOOL);

    const messages = await askOrder(DOWN);
    expect(messages.at(-1)?.text).toBe(UNAVAILABLE);
  });
});
