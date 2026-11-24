import { useState } from 'react'
import type { Message, ToolStatus } from '../useAgentChat'
import { AlertIcon, CheckIcon, CopyIcon, DocumentIcon } from './Icons'
import { RichText } from './RichText'

// Cosa ha fatto l'assistente, in parole dell'utente (mai i nomi tecnici dei tool).
function stepLabel(tool: ToolStatus) {
  const order = typeof tool.args.orderId === 'string' ? tool.args.orderId.toUpperCase() : ''
  if (tool.name === 'get_order_status') {
    if (tool.state === 'running') return `Controllo l'ordine ${order}`
    if (tool.state === 'ok') return `Ho controllato l'ordine ${order}`
    return `Non riesco a controllare l'ordine ${order}`
  }
  if (tool.name === 'search_knowledge_base') {
    if (tool.state === 'running') return 'Cerco nei documenti del negozio'
    if (tool.state === 'ok') return 'Ho consultato i documenti del negozio'
    return 'Non riesco a consultare i documenti'
  }
  return tool.state === 'running' ? 'Sto lavorando' : 'Fatto'
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path

export function MessageView({ message, streaming }: { message: Message; streaming: boolean }) {
  const [activeCite, setActiveCite] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="turn turn-user">
        <p className="bubble">{message.text}</p>
      </div>
    )
  }

  // Più chunk dello stesso documento diventano UNA fonte, con tutti i suoi numeri.
  const sources = Object.values(
    message.sources.reduce<Record<string, { name: string; numbers: number[] }>>((acc, s) => {
      acc[s.documentId] ??= { name: basename(s.source), numbers: [] }
      acc[s.documentId].numbers.push(s.n)
      return acc
    }, {}),
  )
  // Se il testo cita [n], mostriamo come "Fonti" solo i documenti citati.
  // Se non cita nulla, non possiamo sapere quale documento ha usato: mostriamo onestamente
  // tutti i "Documenti consultati", senza far finta che siano fonti verificate.
  const cited = new Set([...message.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const shownSources = cited.size > 0 ? sources.filter((s) => s.numbers.some((n) => cited.has(n))) : sources

  const thinking = streaming && message.text === '' && message.tools.every((t) => t.state !== 'running')

  async function copy() {
    await navigator.clipboard.writeText(message.text.replace(/\s?\[\d+\]/g, ''))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="turn turn-assistant" aria-busy={streaming}>
      {(message.tools.length > 0 || thinking) && (
        <ol className="steps" aria-label="Passaggi">
          {message.tools.map((tool) => (
            <li key={tool.id} className={`step step-${tool.state}`}>
              <span className="step-mark" aria-hidden>
                {tool.state === 'ok' ? <CheckIcon /> : tool.state === 'error' ? <AlertIcon /> : null}
              </span>
              {stepLabel(tool)}
            </li>
          ))}
          {thinking && (
            <li className="step step-running">
              <span className="step-mark" aria-hidden />
              {message.tools.length ? 'Preparo la risposta' : 'Leggo la domanda'}
            </li>
          )}
        </ol>
      )}

      {message.text && (
        <div className={`answer${streaming ? ' is-streaming' : ''}`}>
          <RichText text={message.text} onCite={setActiveCite} />
        </div>
      )}

      {message.interrupted && <p className="note">Risposta interrotta.</p>}

      {!streaming && message.text && (
        <div className="answer-footer">
          {shownSources.length > 0 && (
            <ul className="sources" aria-label={cited.size > 0 ? 'Fonti' : 'Documenti consultati'}>
              <li className="sources-label">{cited.size > 0 ? 'Fonti' : 'Documenti consultati'}</li>
              {shownSources.map((s) => (
                <li key={s.name} className={s.numbers.includes(activeCite ?? -1) ? 'source is-active' : 'source'}>
                  <DocumentIcon />
                  <span className="source-name">{s.name}</span>
                  {cited.size > 0 && (
                    <span className="source-numbers">{s.numbers.filter((n) => cited.has(n)).join(' ')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ghost-button" onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copiata' : 'Copia'}
          </button>
        </div>
      )}
    </div>
  )
}
