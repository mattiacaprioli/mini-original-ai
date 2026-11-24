import { useCallback, useEffect, useRef, useState } from 'react'

// Segue la risposta mentre arriva, ma SOLO se l'utente è già in fondo:
// se è risalito a rileggere qualcosa, non gli strappiamo la pagina da sotto.
export function useStickToBottom(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (atBottom) scrollToBottom(false)
  }, [dependency, atBottom, scrollToBottom])

  return { ref, onScroll, atBottom, scrollToBottom }
}
