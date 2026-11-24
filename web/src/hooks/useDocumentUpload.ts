import { useEffect, useRef, useState } from 'react'

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; filename: string }
  | { phase: 'processing'; filename: string }
  | { phase: 'ready'; filename: string; chunks: number; duplicate: boolean }
  | { phase: 'error'; filename: string; message: string }

const ACCEPTED = ['.md', '.txt']

// Carica un documento nella knowledge base e segue l'elaborazione del worker (202 + polling dello stato).
export function useDocumentUpload() {
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function upload(file: File) {
    window.clearTimeout(timer.current)
    const filename = file.name
    if (!ACCEPTED.some((ext) => filename.toLowerCase().endsWith(ext))) {
      setState({ phase: 'error', filename, message: 'Puoi caricare solo file .md o .txt.' })
      return
    }

    setState({ phase: 'uploading', filename })
    const body = new FormData()
    body.append('file', file)

    try {
      const res = await fetch('/api/documents', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Errore ${res.status}`)

      const poll = async () => {
        const status = await (await fetch(`/api/documents/${data.documentId}`)).json()
        if (status.status === 'ready') {
          setState({ phase: 'ready', filename, chunks: status.chunks ?? 0, duplicate: Boolean(data.duplicate) })
          timer.current = window.setTimeout(() => setState({ phase: 'idle' }), 6000) // la conferma sparisce da sola
        } else if (status.status === 'failed') {
          setState({ phase: 'error', filename, message: status.error ?? 'Elaborazione non riuscita.' })
        } else {
          setState({ phase: 'processing', filename })
          timer.current = window.setTimeout(poll, 1000)
        }
      }
      await poll()
    } catch (err) {
      setState({ phase: 'error', filename, message: (err as Error).message })
    }
  }

  const dismiss = () => setState({ phase: 'idle' })

  return { state, upload, dismiss, accept: ACCEPTED.join(',') }
}
