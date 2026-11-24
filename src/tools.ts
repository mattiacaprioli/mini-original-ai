import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { hybridSearch } from "./search";

const ORDERS: Record<string, { status: string; eta: string }> = {
  "A-1001": { status: "spedito", eta: "2026-11-26" },
  "A-1002": { status: "in preparazione", eta: "2026-11-28" },
  "A-1003": { status: "consegnato", eta: "2026-11-20" },
};

const ORDER_ID = /^A-\d{4}$/i;

export type Source = { n: number; source: string; documentId: string };

// I tool si creano PER RICHIESTA, con il contesto dell'utente (qui il tenant).
// Il tenantId arriva dal server, mai dagli argomenti del modello: il modello non può
// decidere di cercare nei documenti di un altro cliente, nemmeno se un prompt lo convince a provarci.
export function createTools(ctx: { tenantId: string }) {
  const getOrderStatus = tool(
    async ({ orderId }) => {
      // Il formato lo controlliamo NOI, nel codice: il modello non vede la regex.
      if (!ORDER_ID.test(orderId)) {
        return `Codice non valido: ${orderId}. Il formato corretto è la lettera A seguita da 4 cifre, es. A-1001.`;
      }
      const order = ORDERS[orderId.toUpperCase()];
      if (!order) return `Nessun ordine trovato con codice ${orderId}.`;
      return JSON.stringify({ orderId, ...order });
    },
    {
      name: "get_order_status",
      description:
        "Restituisce lo stato e la data di consegna prevista di un ordine a partire dal suo codice (es. A-1001). Usalo ogni volta che l'utente chiede di un ordine.",
      // Al modello mostriamo uno schema semplice: niente regex, che confonde i modelli piccoli.
      schema: z.object({
        orderId: z.string().describe("Codice ordine, es. A-1001"),
      }),
    },
  );

  const searchKnowledgeBase = tool(
    async ({ query }) => {
      const { hybrid } = await hybridSearch(query, ctx.tenantId);
      if (hybrid.length === 0) return ["Nessun documento trovato.", { sources: [] as Source[] }];

      // Al modello: i testi numerati, così può citarli come [1], [2].
      const content = hybrid.map((hit, i) => `[${i + 1}] Fonte: ${hit.source}\n${hit.text}`).join("\n\n");
      // Al client (come "artifact", che il modello non vede): le fonti strutturate da mostrare.
      const sources: Source[] = hybrid.map((hit, i) => ({ n: i + 1, source: hit.source, documentId: hit.documentId }));
      return [content, { sources }];
    },
    {
      name: "search_knowledge_base",
      description:
        "Cerca nei documenti aziendali: orari del servizio clienti, spedizioni, resi e rimborsi, metodi di pagamento, garanzia, privacy, chiusure. Usalo per qualsiasi domanda su regole o informazioni del negozio.",
      schema: z.object({
        query: z.string().describe("La domanda dell'utente riformulata come ricerca, es. 'orari servizio clienti'"),
      }),
      responseFormat: "content_and_artifact", // il tool restituisce [contenuto per il modello, dati per noi]
    },
  );

  return [getOrderStatus, searchKnowledgeBase];
}
