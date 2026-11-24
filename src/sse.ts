// Union discriminata: ogni evento ha un "type" e TypeScript sa quali campi ha ciascuno.
export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; ms: number }
  | { type: "done" }
  | { type: "error"; message: string };

const encoder = new TextEncoder();

export function sse(event: StreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// Trasforma qualsiasi generatore di eventi in una risposta SSE.
// La logica (chat semplice o agente) produce eventi; questa funzione si occupa solo del trasporto HTTP.
export function sseResponse(events: AsyncIterable<StreamEvent>, signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) controller.enqueue(sse(event));
        controller.enqueue(sse({ type: "done" }));
      } catch (err) {
        if (!signal.aborted) controller.enqueue(sse({ type: "error", message: (err as Error).message }));
      } finally {
        try {
          controller.close();
        } catch {
          // già chiuso: il client se n'è andato
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
