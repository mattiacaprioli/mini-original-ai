import { db } from "./db";

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

export type DocumentRecord = {
  _id: string;
  tenantId: string; // a quale cliente appartiene: servirà per filtrare la ricerca al passo 6
  filename: string; // il nome originale, solo da mostrare
  storageKey: string; // dove sta il file (MAI costruito dal nome scelto dall'utente)
  hash: string; // impronta del contenuto: stesso file caricato due volte = stesso hash
  status: DocumentStatus;
  chunks?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChunkRecord = {
  documentId: string;
  tenantId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  source: string; // nome del file, per citare la fonte nella risposta
  createdAt: Date;
};

export const documents = db.collection<DocumentRecord>("documents");
export const chunks = db.collection<ChunkRecord>("chunks");

export async function ensureDocumentIndexes() {
  await documents.createIndex({ tenantId: 1, hash: 1 });
  await chunks.createIndex({ documentId: 1, chunkIndex: 1 });
}

export async function setStatus(documentId: string, status: DocumentStatus, extra: Partial<DocumentRecord> = {}) {
  await documents.updateOne({ _id: documentId }, { $set: { status, updatedAt: new Date(), ...extra } });
}