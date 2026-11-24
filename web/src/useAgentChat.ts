import { useEffect, useRef, useState } from 'react'
import { readEvents, type Source } from './sse'

export type ToolStatus = {
  id: string
  name: string
  args: Record<string, unknown>
  state: 'running' | 'ok' | 'error'
  ms?: number
}
export type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolStatus[]
  sources: Source[]
  interrupted?: boolean
}

export function useAgentChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // useRef e non useState: l'id serve solo per la prossima richiesta, non va mostrato a schermo.
  const conversationIdRef = useRef<string | null>(null)
  const lastQuestionRef = useRef<string | null>(null)

  // Aggiorna l'ultimo messaggio (quello dell'assistente in arrivo).
  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])])

  async function send(text: string) {
    setError(null)
    lastQuestionRef.current = text
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text, tools: [], sources: [] },
      { id: crypto.randomUUID(), role: 'assistant', text: '', tools: [], sources: [] },
    ])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: conversationIdRef.current ?? undefined }),
        signal: controller.signal,
      })

      for await (const event of readEvents(res)) {
        switch (event.type) {
          case 'meta':
            conversationIdRef.current = event.conversationId
            break
          case 'token':
            updateLast((m) => ({ ...m, text: m.text + event.text }))
            break
          case 'tool_start':
            updateLast((m) => ({
              ...m,
              tools: [...m.tools, { id: event.id, name: event.name, args: (event.args ?? {}) as Record<string, unknown>, state: 'running' }],
            }))
            break
          case 'tool_end':
            updateLast((m) => ({
              ...m,
              tools: m.tools.map((t) => (t.id === event.id ? { ...t, state: event.ok ? 'ok' : 'error', ms: event.ms } : t)),
            }))
            break
          case 'sources':
            updateLast((m) => ({ ...m, sources: [...m.sources, ...event.sources] }))
            break
          case 'error':
            setError(event.message)
            break
          case 'done':
            break
          default: {
            // Se il server aggiunge un tipo di evento e qui non lo gestisci, TypeScript dà errore.
            const unhandled: never = event
            console.warn('evento sconosciuto', unhandled)
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        updateLast((m) => ({ ...m, interrupted: true }))
      } else {
        setError((err as Error).message)
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  // Riprova: toglie l'ultimo scambio fallito e rimanda la stessa domanda.
  function retry() {
    const question = lastQuestionRef.current
    if (!question || isStreaming) return
    setMessages((prev) => prev.slice(0, -2))
    void send(question)
  }

  // Nuova chat: dimentichiamo l'id, il server ne creerà uno nuovo al prossimo messaggio.
  function newChat() {
    stop()
    conversationIdRef.current = null
    lastQuestionRef.current = null
    setMessages([])
    setError(null)
  }

  // Se il componente viene smontato a metà risposta, chiudiamo la richiesta.
  useEffect(() => () => abortRef.current?.abort(), [])

  return { messages, isStreaming, error, send, stop, retry, newChat }
}
