import { useState, type FormEvent } from 'react'
import { useAgentChat, type ToolStatus } from './useAgentChat'

// Nomi leggibili per i tool: l'utente non deve vedere "get_order_status".
const TOOL_LABELS: Record<string, string> = {
  get_order_status: "Controllo lo stato dell'ordine",
}

function ToolBadge({ tool }: { tool: ToolStatus }) {
  const label = TOOL_LABELS[tool.name] ?? tool.name
  const icon = tool.state === 'running' ? '⏳' : tool.state === 'ok' ? '✅' : '⚠️'
  return (
    <div className="tool">
      {icon} {label}
      {tool.state === 'running' ? '…' : ` (${tool.ms} ms)`}
    </div>
  )
}

export default function App() {
  const { messages, isStreaming, error, send, stop, newChat } = useAgentChat()
  const [input, setInput] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    void send(text)
  }

  return (
    <main className="chat">
      <header>
        <h1>Mini Original AI</h1>
        <button type="button" className="secondary" onClick={newChat}>Nuova chat</button>
      </header>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.tools.map((t) => (
              <ToolBadge key={t.id} tool={t} />
            ))}
            {m.text || (m.role === 'assistant' && isStreaming && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>

      {error && <div className="error">Errore: {error}</div>}

      <form onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Chiedi di un ordine, es. A che punto è A-1002?"
          autoFocus
        />
        {isStreaming ? (
          <button type="button" onClick={stop}>Stop</button>
        ) : (
          <button type="submit">Invia</button>
        )}
      </form>
    </main>
  )
}