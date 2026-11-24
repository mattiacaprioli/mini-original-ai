import { Composer } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import { ArrowDownIcon, PlusIcon } from './components/Icons'
import { MessageView } from './components/MessageView'
import { useDocumentUpload } from './hooks/useDocumentUpload'
import { useStickToBottom } from './hooks/useStickToBottom'
import { useAgentChat } from './useAgentChat'

export default function App() {
  const { messages, isStreaming, error, send, stop, retry, newChat } = useAgentChat()
  const upload = useDocumentUpload()
  const lastText = messages.at(-1)?.text.length ?? 0
  // Si riscorre in fondo quando arriva testo e quando la risposta finisce (compaiono fonti e azioni).
  const scroll = useStickToBottom(`${messages.length}:${lastText}:${isStreaming}:${error}`)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/mark.svg" alt="" width={30} height={30} />
          <div>
            <p className="brand-name">Negozio Demo</p>
            <p className="brand-sub">
              <span className="dot" aria-hidden /> Assistente clienti, modelli e dati in locale
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button type="button" className="ghost-button" onClick={newChat} aria-label="Nuova chat">
            <PlusIcon />
            <span className="label">Nuova chat</span>
          </button>
        )}
      </header>

      <main className="conversation" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="column">
          {messages.length === 0 ? (
            <EmptyState onPick={send} />
          ) : (
            messages.map((m, i) => (
              <MessageView key={m.id} message={m} streaming={isStreaming && i === messages.length - 1} />
            ))
          )}

          {error && (
            <div className="error" role="alert">
              <p>La risposta non è arrivata: {error}</p>
              <button type="button" className="ghost-button" onClick={retry}>
                Riprova
              </button>
            </div>
          )}
        </div>
      </main>

      {!scroll.atBottom && (
        <button type="button" className="jump" onClick={() => scroll.scrollToBottom()} aria-label="Vai all'ultimo messaggio">
          <ArrowDownIcon />
        </button>
      )}

      <div className="dock">
        <div className="column">
          <Composer isStreaming={isStreaming} onSend={send} onStop={stop} upload={upload} />
        </div>
      </div>
    </div>
  )
}
