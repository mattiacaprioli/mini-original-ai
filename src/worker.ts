import { Worker } from "bullmq";
import { mongo } from "./db";
import { ensureDocumentIndexes, setStatus } from "./documents";
import { ingestDocument } from "./ingest";
import { createRedis, INGEST_QUEUE, type IngestJob } from "./queue";

// Processo SEPARATO dal server: il lavoro pesante (embedding) non rallenta le chat,
// e se serve più potenza si lanciano più worker senza toccare il server.
await ensureDocumentIndexes();

const worker = new Worker<IngestJob>(
  INGEST_QUEUE,
  async (job) => {
    console.log(`[job ${job.id}] tentativo ${job.attemptsMade + 1}: documento ${job.data.documentId}`);
    const chunkCount = await ingestDocument(job.data.documentId, (p) => job.updateProgress(p));
    return { chunks: chunkCount };
  },
  {
    connection: createRedis(),
    concurrency: 2, // al massimo 2 documenti in parallelo: non vogliamo saturare Ollama
  },
);

worker.on("completed", (job, result) => console.log(`[job ${job.id}] completato: ${result.chunks} chunk`));

worker.on("failed", async (job, err) => {
  console.error(`[job ${job?.id}] errore: ${err.message}`);
  // "failed" solo quando i tentativi sono finiti: prima BullMQ riprova da solo.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await setStatus(job.data.documentId, "failed", { error: err.message });
  }
});

// Shutdown pulito: il job in corso finisce, poi il processo esce. Nessun lavoro perso a metà.
async function shutdown() {
  console.log("Chiusura del worker...");
  await worker.close();
  await mongo.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Worker in ascolto sulla coda "${INGEST_QUEUE}"`);