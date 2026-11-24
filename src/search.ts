import { chunks } from "./documents";
import { db } from "./db";
import { createEmbeddings, EMBEDDING_DIMENSIONS } from "./embeddings";

const VECTOR_INDEX = "chunks_vector";
const TEXT_INDEX = "chunks_text";

const embeddings = createEmbeddings();

export type SearchHit = {
  id: string;
  documentId: string;
  source: string;
  text: string;
  score: number;
};

// Crea (una volta sola) i due indici di ricerca sulla collection dei chunk:
// - vettoriale: trova i chunk con significato simile alla domanda
// - full-text: trova i chunk che contengono le parole esatte (codici, nomi, numeri)
export async function ensureSearchIndexes() {
  await db.createCollection("chunks").catch(() => {}); // esiste già: va bene

  const existing = new Set((await chunks.listSearchIndexes().toArray()).map((i) => i.name));
  const toCreate = [];

  if (!existing.has(VECTOR_INDEX)) {
    toCreate.push({
      name: VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMENSIONS, similarity: "cosine" },
          // tenantId come "filter": il filtro per cliente viene applicato DENTRO la ricerca, non dopo.
          { type: "filter", path: "tenantId" },
        ],
      },
    });
  }

  if (!existing.has(TEXT_INDEX)) {
    toCreate.push({
      name: TEXT_INDEX,
      type: "search",
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            text: { type: "string", analyzer: "lucene.italian" }, // gestisce plurali, accenti, parole comuni
            tenantId: { type: "token" }, // token = valore esatto, per il filtro equals
          },
        },
      },
    });
  }

  if (toCreate.length === 0) return;
  console.log(`Creo gli indici di ricerca: ${toCreate.map((i) => i.name).join(", ")}...`);
  await chunks.createSearchIndexes(toCreate);

  // Gli indici si costruiscono in background: aspettiamo che siano interrogabili.
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const indexes = (await chunks.listSearchIndexes().toArray()) as { name: string; queryable?: boolean }[];
    const ready = [VECTOR_INDEX, TEXT_INDEX].every((name) => indexes.find((i) => i.name === name)?.queryable);
    if (ready) {
      console.log("Indici di ricerca pronti.");
      return;
    }
    await Bun.sleep(2000);
  }
  throw new Error("gli indici di ricerca non sono diventati pronti entro 2 minuti");
}

// Ricerca per SIGNIFICATO: la domanda diventa un vettore e cerchiamo i chunk più vicini.
export async function vectorSearch(query: string, tenantId: string, limit = 10): Promise<SearchHit[]> {
  const queryVector = await embeddings.embedQuery(query);
  const docs = await chunks
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: "embedding",
          queryVector,
          numCandidates: limit * 20, // candidati esaminati: più alto = più preciso, ma più lento
          limit,
          filter: { tenantId }, // pre-filtro: un cliente non vede mai i chunk di un altro
        },
      },
      { $project: { documentId: 1, source: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();
  return docs.map(toHit);
}

// Ricerca per PAROLE: trova i match esatti che gli embedding tendono a perdere (es. "TWINT", "A-1001").
export async function textSearch(query: string, tenantId: string, limit = 10): Promise<SearchHit[]> {
  const docs = await chunks
    .aggregate([
      {
        $search: {
          index: TEXT_INDEX,
          compound: {
            must: [{ text: { query, path: "text" } }],
            filter: [{ equals: { path: "tenantId", value: tenantId } }],
          },
        },
      },
      { $limit: limit },
      { $project: { documentId: 1, source: 1, text: 1, score: { $meta: "searchScore" } } },
    ])
    .toArray();
  return docs.map(toHit);
}

// Reciprocal Rank Fusion: unisce più classifiche usando solo la POSIZIONE, non il punteggio.
// I punteggi delle due ricerche hanno scale diverse e non si possono sommare; le posizioni sì.
// Punteggio finale = somma di 1 / (k + posizione). Chi è in alto in entrambe vince.
export function reciprocalRankFusion(lists: SearchHit[][], k = 60): SearchHit[] {
  const fused = new Map<string, SearchHit>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const current = fused.get(hit.id) ?? { ...hit, score: 0 };
      current.score += 1 / (k + index + 1);
      fused.set(hit.id, current);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

// Hybrid search: le due ricerche in parallelo, poi la fusione.
export async function hybridSearch(query: string, tenantId: string, limit = 4) {
  const [vector, text] = await Promise.all([vectorSearch(query, tenantId), textSearch(query, tenantId)]);
  return { vector, text, hybrid: reciprocalRankFusion([vector, text]).slice(0, limit) };
}

function toHit(doc: Record<string, unknown>): SearchHit {
  return {
    id: String(doc._id),
    documentId: String(doc.documentId),
    source: String(doc.source),
    text: String(doc.text),
    score: Number(doc.score),
  };
}
