import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { db } from "./db";

type StoredMessage = {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  interrupted?: boolean; // l'utente ha premuto Stop a metà risposta
  createdAt: Date;
};

// Una collection di messaggi, NON un array dentro un documento "conversazione":
// una chat cresce senza limite e un documento MongoDB ha un tetto di 16 MB.
const messages = db.collection<StoredMessage>("messages");

const HISTORY_LIMIT = 20; // quanti messaggi passati diamo al modello (finestra di contesto)
const RETENTION_DAYS = 30; // dopo 30 giorni MongoDB cancella i messaggi da solo

export async function ensureIndexes() {
  // Per leggere velocemente la storia di una conversazione in ordine.
  await messages.createIndex({ conversationId: 1, createdAt: 1 });
  // Indice TTL: è la policy di conservazione dei dati, applicata dal database.
  await messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });
}

export async function loadHistory(conversationId: string): Promise<BaseMessage[]> {
  // Prendiamo gli ultimi N (ordine decrescente + limit), poi li rimettiamo in ordine cronologico.
  const docs = await messages
    .find({ conversationId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(HISTORY_LIMIT)
    .toArray();

  return docs.reverse().map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));
}

export async function saveMessage(
  conversationId: string,
  role: StoredMessage["role"],
  content: string,
  interrupted = false,
) {
  await messages.insertOne({
    conversationId,
    role,
    content,
    createdAt: new Date(),
    ...(interrupted ? { interrupted } : {}),
  });
}