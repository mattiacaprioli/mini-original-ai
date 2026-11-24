import { tool } from "@langchain/core/tools";
import { z } from "zod";

const ORDERS: Record<string, { status: string; eta: string }> = {
  "A-1001": { status: "spedito", eta: "2026-11-26" },
  "A-1002": { status: "in preparazione", eta: "2026-11-28" },
  "A-1003": { status: "consegnato", eta: "2026-11-20" },
};

const ORDER_ID = /^A-\d{4}$/i;

export const getOrderStatus = tool(
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

export const tools = [getOrderStatus];