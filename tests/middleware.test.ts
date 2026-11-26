// Test dei middleware: niente Ollama, niente MongoDB. Modello finto + tool finti → veloci e ripetibili.
import { describe, expect, test } from "bun:test";
import { ToolMessage } from "@langchain/core/messages";
import { createAgent, createMiddleware, FakeToolCallingModel, tool } from "langchain";
import { z } from "zod";
import { DOCS_TOOL, guardrails, ORDER_TOOL, SEARCH_TOOL, toolResultToText, UNAVAILABLE } from "../src/middleware";

// Crea tool finti che registrano le chiamate ricevute.
function fakeTools(names: string[], fail = false) {
  const calls: { name: string; args: unknown }[] = [];
  const tools = names.map((name) =>
    tool(
      async (args) => {
        calls.push({ name, args });
        if (fail) throw new Error("server giù");
        return `risultato di ${name}`;
      },
      { name, description: name, schema: z.object({ orderId: z.string().optional(), query: z.string().optional() }) },
    ),
  );
  return { tools, calls };
}

// Il modello finto PROVEREBBE a chiamare un tool sbagliato: i guardrail devono impedirlo.
const sneakyModel = () =>
  new FakeToolCallingModel({ toolCalls: [[{ name: ORDER_TOOL, args: { orderId: "HACK" }, id: "x" }]] });

async function ask(question: string, names = [ORDER_TOOL, SEARCH_TOOL, DOCS_TOOL], opts: { fail?: boolean } = {}) {
  const { tools, calls } = fakeTools(names, opts.fail);
  const agent = createAgent({ model: sneakyModel(), tools, middleware: [guardrails] });
  const result = await agent.invoke({ messages: [{ role: "user", content: question }] });
  return { calls, answer: result.messages.at(-1)?.text };
}

describe("guardrails: il codice sceglie il tool", () => {
  test("codice ordine → get_order_status (anche in minuscolo)", async () => {
    const { calls } = await ask("dov'è l'ordine a-1002?");
    expect(calls).toEqual([{ name: ORDER_TOOL, args: { orderId: "A-1002" } }]);
  });

  test("più codici → una chiamata per codice, senza duplicati", async () => {
    const { calls } = await ask("A-1001 e A-1003, e di nuovo A-1001");
    expect(calls.map((c) => c.args)).toEqual([{ orderId: "A-1001" }, { orderId: "A-1003" }]);
  });

  test("domanda sul negozio → search_knowledge_base", async () => {
    const { calls } = await ask("Spedite in Giappone?");
    expect(calls).toEqual([{ name: SEARCH_TOOL, args: { query: "Spedite in Giappone?" } }]);
  });

  test("domanda su LangChain/MCP → tool della documentazione", async () => {
    const { calls } = await ask("Come collego un server MCP a LangChain?");
    expect(calls[0]?.name).toBe(DOCS_TOOL);
  });

  test("server docs giù → ripiego sul negozio", async () => {
    const { calls } = await ask("Come collego un server MCP a LangChain?", [ORDER_TOOL, SEARCH_TOOL]);
    expect(calls[0]?.name).toBe(SEARCH_TOOL);
  });

  test("small talk → nessun tool, nemmeno se il modello ci prova", async () => {
    const { calls } = await ask("ciao!");
    expect(calls).toEqual([]);
  });
});

describe("guardrails: server spento o in errore", () => {
  test("tool mancante (server spento) → risposta fissa, nessuna chiamata", async () => {
    const { calls, answer } = await ask("A-1002?", [SEARCH_TOOL]);
    expect(calls).toEqual([]);
    expect(answer).toBe(UNAVAILABLE);
  });

  test("tool che fallisce → risposta fissa, il modello non inventa", async () => {
    const { tools } = fakeTools([ORDER_TOOL, SEARCH_TOOL], true);
    // Simuliamo toolRetryMiddleware con onFailure "continue": l'errore diventa un ToolMessage con status "error".
    const asError = createMiddleware({
      name: "AsError",
      wrapToolCall: async (req, handler) => {
        try {
          return await handler(req);
        } catch (err) {
          return new ToolMessage({ content: String(err), tool_call_id: req.toolCall.id!, status: "error" });
        }
      },
    });
    const agent = createAgent({ model: sneakyModel(), tools, middleware: [guardrails, asError] });
    const result = await agent.invoke({ messages: [{ role: "user", content: "A-1002?" }] });
    expect(result.messages.at(-1)?.text).toBe(UNAVAILABLE);
  });
});

describe("toolResultToText", () => {
  // Un "server MCP" finto che risponde a blocchi, come il server docs.
  const blocksServer = (text: string) =>
    createMiddleware({
      name: "Blocks",
      wrapToolCall: async (req) =>
        new ToolMessage({
          content: [{ type: "text", text }, { type: "text", text: "secondo blocco" }],
          tool_call_id: req.toolCall.id!,
          name: req.toolCall.name,
          artifact: { sources: [{ n: 1 }] },
        }),
    });

  async function toolMessageSeenByModel(text: string) {
    let seen: ToolMessage | undefined;
    const spy = createMiddleware({
      name: "Spy",
      wrapModelCall: async (req, handler) => {
        const last = req.messages.at(-1);
        if (ToolMessage.isInstance(last)) seen = last;
        return handler(req);
      },
    });
    const { tools } = fakeTools([DOCS_TOOL]);
    const agent = createAgent({ model: new FakeToolCallingModel({}), tools, middleware: [guardrails, spy, toolResultToText, blocksServer(text)] });
    await agent.invoke({ messages: [{ role: "user", content: "domanda su LangChain" }] });
    return seen!;
  }

  test("i blocchi diventano una stringa e l'artifact resta", async () => {
    const msg = await toolMessageSeenByModel("primo blocco");
    expect(msg.content).toBe("primo blocco\n\nsecondo blocco");
    expect(msg.artifact).toEqual({ sources: [{ n: 1 }] });
  });

  test("i risultati troppo lunghi vengono tagliati", async () => {
    const msg = await toolMessageSeenByModel("x".repeat(10_000));
    expect(String(msg.content).length).toBe(4000);
  });
});
