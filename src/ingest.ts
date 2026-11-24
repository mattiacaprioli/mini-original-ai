import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { chunks, documents, setStatus } from "./documents";
import { createEmbeddings } from "./embeddings";
import { readText } from "./storage";

// Split "per struttura": prima sui titoli markdown, poi paragrafi, poi frasi.
// chunkSize è in CARATTERI (500 caratteri sono circa 120 token). Le sezioni di una FAQ sono brevi:
// chunk piccoli = un argomento per chunk = ricerca più precisa. Il valore giusto si misura, non si indovina.
const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
  chunkSize: 500,
  chunkOverlap: 50, // un po' di sovrapposizione: una frase a cavallo di due chunk non va persa
});

const embeddings = createEmbeddings();

// La logica vera dell'ingestion, separata dal worker: si può testare senza BullMQ.
export async function ingestDocument(documentId: string, onProgress?: (percent: number) => Promise<void>) {
  const doc = await documents.findOne({ _id: documentId });
  if (!doc) throw new Error(`documento ${documentId} non trovato`);

  await setStatus(documentId, "processing");
  const text = await readText(doc.storageKey);

  // 1. Chunking
  const pieces = await splitter.splitText(text);
  if (pieces.length === 0) throw new Error("il documento è vuoto");
  await onProgress?.(20);

  // 2. Embedding: una sola chiamata per tutti i chunk (batch), non una per chunk.
  const vectors = await embeddings.embedDocuments(pieces);
  await onProgress?.(80);

  // 3. Idempotenza: il job può girare più volte (retry dopo un errore a metà).
  //    Cancelliamo i chunk di un tentativo precedente prima di inserire: mai duplicati.
  await chunks.deleteMany({ documentId });
  await chunks.insertMany(
    pieces.map((text, i) => ({
      documentId,
      tenantId: doc.tenantId,
      chunkIndex: i,
      text,
      embedding: vectors[i]!,
      source: doc.filename,
      createdAt: new Date(),
    })),
  );

  await documents.updateOne(
    { _id: documentId },
    { $set: { status: "ready", chunks: pieces.length, updatedAt: new Date() }, $unset: { error: "" } },
  );
  await onProgress?.(100);
  return pieces.length;
}