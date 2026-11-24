import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { extname } from "node:path";
import { z } from "zod";
import { streamAgent } from "./agent";
import { ensureIndexes, loadHistory, saveMessage } from "./conversations";
import { documents, ensureDocumentIndexes } from "./documents";
import { createChatModel } from "./llm";
import { ingestQueue } from "./queue";
import { sseResponse, type StreamEvent } from "./sse";
import { saveFile } from "./storage";

const model = createChatModel();

const ChatRequest = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.uuid().optional(), // assente = nuova conversazione
});

// In produzione il tenant arriva dal token dell'utente autenticato, mai dal client.
const TENANT_ID = "demo";
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_EXTENSIONS = [".md", ".txt"];

// Fail fast: se MongoDB non risponde, meglio fermarsi subito con un messaggio chiaro.
try {
  await ensureIndexes();
  await ensureDocumentIndexes();
} catch (err) {
  console.error("MongoDB non raggiungibile. Hai avviato `docker compose up -d`?\n", (err as Error).message);
  process.exit(1);
}

async function* streamChat(message: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const stream = await model.stream(
    [
      new SystemMessage("Sei un assistente aziendale. Rispondi in italiano, in modo conciso."),
      new HumanMessage(message),
    ],
    { signal },
  );
  for await (const chunk of stream) {
    if (chunk.text) yield { type: "token", text: chunk.text };
  }
}

// Avvolge l'agente: legge la storia prima, salva domanda e risposta.
// L'agente resta "puro": non sa niente di database.
async function* agentWithMemory(
  conversationId: string,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  // 1. Diciamo subito al client l'id della conversazione, così lo rimanda al messaggio successivo.
  yield { type: "meta", conversationId };

  // 2. Storia PRIMA di salvare il nuovo messaggio (l'agente lo aggiunge da sé).
  const history = await loadHistory(conversationId);
  await saveMessage(conversationId, "user", message);

  let answer = "";
  let completed = false;
  try {
    for await (const event of streamAgent(history, message, signal)) {
      if (event.type === "token") answer += event.text;
      yield event;
    }
    completed = true;
  } finally {
    // finally gira anche se l'utente preme Stop: salviamo la risposta parziale, marcata come interrotta.
    if (answer) await saveMessage(conversationId, "assistant", answer, !completed);
  }
}

const server = Bun.serve({
  port: 3000,
  idleTimeout: 120,
  routes: {
    "/health": new Response("ok"),

    "/chat": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "richiesta non valida" }, { status: 400 });
        return sseResponse(streamChat(parsed.data.message, req.signal), req.signal);
      },
    },

    "/documents": {
      // Upload: salva il file, crea il record, mette un job in coda e risponde SUBITO.
      // L'elaborazione (chunk + embedding) la fa il worker, in un altro processo.
      POST: async (req) => {
        const form = await req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return Response.json({ error: "campo 'file' mancante" }, { status: 400 });

        const ext = extname(file.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return Response.json({ error: `formato non supportato: ammessi ${ALLOWED_EXTENSIONS.join(", ")}` }, { status: 415 });
        }
        if (file.size > MAX_FILE_BYTES) return Response.json({ error: "file troppo grande (max 2 MB)" }, { status: 413 });

        // Stesso contenuto già caricato (e non fallito)? Non lo rielaboriamo: risparmiamo embedding.
        const hash = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex");
        const existing = await documents.findOne({ tenantId: TENANT_ID, hash, status: { $ne: "failed" } });
        if (existing) return Response.json({ documentId: existing._id, status: existing.status, duplicate: true });

        const documentId = crypto.randomUUID();
        // Il percorso usa il NOSTRO id, mai il nome scelto dall'utente: un nome come "../../server.ts"
        // potrebbe sovrascrivere file fuori dalla cartella (path traversal).
        const storageKey = `${TENANT_ID}/${documentId}${ext}`;
        await saveFile(storageKey, file);

        const now = new Date();
        await documents.insertOne({
          _id: documentId,
          tenantId: TENANT_ID,
          filename: file.name,
          storageKey,
          hash,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        });
        await ingestQueue.add("ingest", { documentId }, { jobId: documentId });

        // 202 Accepted: "ricevuto, lo elaboro". Il client controlla lo stato con GET.
        return Response.json({ documentId, status: "queued" }, { status: 202 });
      },
    },

    "/documents/:id": {
      GET: async (req) => {
        const doc = await documents.findOne(
          { _id: req.params.id, tenantId: TENANT_ID },
          { projection: { filename: 1, status: 1, chunks: 1, error: 1 } },
        );
        if (!doc) return Response.json({ error: "documento non trovato" }, { status: 404 });
        return Response.json(doc);
      },
    },

    "/agent": {
      POST: async (req) => {
        const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "richiesta non valida" }, { status: 400 });

        // In produzione: verificare che la conversazione appartenga all'utente autenticato,
        // altrimenti chiunque conosca un id potrebbe leggere la chat di un altro.
        const conversationId = parsed.data.conversationId ?? crypto.randomUUID();
        return sseResponse(agentWithMemory(conversationId, parsed.data.message, req.signal), req.signal);
      },
    },
  },
});

console.log(`Server su ${server.url}`);