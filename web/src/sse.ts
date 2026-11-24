export type Source = { n: number; source: string; documentId: string }

// Stessa union del server. In un monorepo la metteresti in un pacchetto condiviso.
export type StreamEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'token'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; ms: number }
  | { type: 'sources'; sources: Source[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

// EventSource (l'API SSE nativa del browser) supporta solo GET, senza body.
// Noi facciamo POST con un JSON, quindi leggiamo lo stream a mano con fetch.
export async function* readEvents(res: Response): AsyncGenerator<StreamEvent> {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  // TextDecoderStream ricompone i caratteri UTF-8 spezzati tra due chunk (es. "è" = 2 byte).
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value

    // Un chunk di rete NON corrisponde a un evento: può contenerne mezzo o tre.
    // Accumuliamo nel buffer e tagliamo solo sugli eventi completi, che finiscono con "\n\n".
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)

      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')

      if (data) yield JSON.parse(data) as StreamEvent
    }
  }
}
