// @ts-ignore React's types are not available in the current TypeScript setup.
import { useEffect, useRef, useState } from 'react'
import { readEvents } from './sse'

export type ToolStatus = { id: string; name: string; state: 'running' | 'ok' | 'error'; ms?: number }
export type Message = { role: 'user' | 'assistant'; text: string; tools: ToolStatus[] }

export function useAgentChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const conversationIdRef = useRef<string | null>(null) // memorizza l'id della conversazione corrente, ricevuto dal server

  // Aggiorna l'ultimo messaggio (quello dell'assistente in arrivo).
  // Forma funzionale di setState: arrivano decine di token al secondo e ognuno deve partire dallo stato più recente.
  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])])

  async function send(text: string) {
    setError(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', text, tools: [] },
      { role: 'assistant', text: '', tools: [] },
    ])
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: conversationIdRef.current ?? undefined }),
        signal: controller.signal, // abort qui = il server riceve req.signal e ferma il modello
      })

      for await (const event of readEvents(res)) {
        switch (event.type) {
          case 'token':
            updateLast((m) => ({ ...m, text: m.text + event.text }))
            break
          case 'tool_start':
            updateLast((m) => ({ ...m, tools: [...m.tools, { id: event.id, name: event.name, state: 'running' }] }))
            break
          case 'tool_end':
            updateLast((m) => ({
              ...m,
              tools: m.tools.map((t) =>
                t.id === event.id ? { ...t, state: event.ok ? 'ok' : 'error', ms: event.ms } : t,
              ),
            }))
            break
          case 'error':
            setError(event.message)
            break
          case 'done':
            break
          case 'meta':
            conversationIdRef.current = event.conversationId
            break
          default: {
            // Se un giorno il server aggiunge un tipo di evento e qui non lo gestisci, TypeScript dà errore.
            const unhandled: never = event
            console.warn('evento sconosciuto', unhandled)
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  // Nuova chat: dimentichiamo l'id, il server ne creerà uno nuovo al prossimo messaggio.
  function newChat() {
    stop()
    conversationIdRef.current = null
    setMessages([])
    setError(null)
  }

  // Se il componente viene smontato a metà risposta, chiudiamo la richiesta.
  useEffect(() => () => abortRef.current?.abort(), [])

  return { messages, isStreaming, error, send, stop, newChat }
}