import { Queue } from "bullmq";
import IORedis from "ioredis";

export const INGEST_QUEUE = "ingest";
export type IngestJob = { documentId: string };

// I job vivono in Redis, non nella memoria del server: sopravvivono a un riavvio
// e possono essere presi da un altro processo (il worker).
// BullMQ 6 non include più il client Redis: lo creiamo noi con ioredis.
export function createRedis() {
  return new IORedis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6380),
    maxRetriesPerRequest: null, // richiesto da BullMQ: i worker restano in attesa di job senza timeout
  });
}

export const ingestQueue = new Queue<IngestJob>(INGEST_QUEUE, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: 3, // se fallisce (es. Ollama spento) BullMQ riprova da solo
    backoff: { type: "exponential", delay: 2000 }, // attese di 2s, poi 4s
    removeOnComplete: { count: 100 }, // teniamo solo gli ultimi 100 job completati
    removeOnFail: { count: 100 },
  },
});