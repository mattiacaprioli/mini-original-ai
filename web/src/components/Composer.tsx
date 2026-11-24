import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { UploadState } from '../hooks/useDocumentUpload'
import { ArrowUpIcon, CheckIcon, CloseIcon, PaperclipIcon, StopIcon } from './Icons'

type Props = {
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  upload: { state: UploadState; upload: (file: File) => void; dismiss: () => void; accept: string }
}

export function Composer({ isStreaming, onSend, onStop, upload }: Props) {
  const [text, setText] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // La casella cresce con il testo, fino a circa 8 righe.
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const value = text.trim()
    if (!value || isStreaming) return
    onSend(value)
    setText('')
  }

  // Invio manda, Maiusc+Invio va a capo. isComposing: non inviare mentre si compone un carattere (es. accenti).
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const { state } = upload

  return (
    <form className="composer" onSubmit={submit}>
      {state.phase !== 'idle' && (
        <div className={`upload-status upload-${state.phase}`} role="status">
          <span className="upload-text">
            {state.phase === 'uploading' && `Carico ${state.filename}…`}
            {state.phase === 'processing' && `Leggo ${state.filename}…`}
            {state.phase === 'ready' &&
              (state.duplicate
                ? `${state.filename} era già tra i documenti.`
                : `${state.filename} aggiunto: ${state.chunks} ${state.chunks === 1 ? 'sezione consultabile' : 'sezioni consultabili'}.`)}
            {state.phase === 'error' && `${state.filename}: ${state.message}`}
          </span>
          {(state.phase === 'ready' || state.phase === 'error') && (
            <button type="button" className="icon-button small" onClick={upload.dismiss} aria-label="Chiudi">
              {state.phase === 'ready' ? <CheckIcon /> : <CloseIcon />}
            </button>
          )}
        </div>
      )}

      <div className="composer-box">
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInput.current?.click()}
          aria-label="Aggiungi un documento"
          title="Aggiungi un documento (.md o .txt)"
          disabled={state.phase === 'uploading' || state.phase === 'processing'}
        >
          <PaperclipIcon />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={upload.accept}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.upload(file)
            e.target.value = '' // permette di ricaricare lo stesso file
          }}
        />

        <textarea
          ref={textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Scrivi una domanda…"
          aria-label="Messaggio"
          autoFocus
        />

        {isStreaming ? (
          <button type="button" className="send-button is-stop" onClick={onStop} aria-label="Interrompi la risposta">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!text.trim()} aria-label="Invia">
            <ArrowUpIcon />
          </button>
        )}
      </div>
      <p className="composer-hint">
        Le risposte si basano sui dati degli ordini e sui documenti del negozio. Per resi e rimborsi fa fede la conferma via email.
      </p>
    </form>
  )
}
