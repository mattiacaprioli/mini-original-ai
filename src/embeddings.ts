import { OllamaEmbeddings } from "@langchain/ollama";

// Modello di embedding: trasforma un testo in un vettore di numeri che ne rappresenta il significato.
// bge-m3 è multilingue (l'italiano conta) e produce vettori da 1024 numeri.
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

export function createEmbeddings() {
  return new OllamaEmbeddings({ model: EMBEDDING_MODEL });
}