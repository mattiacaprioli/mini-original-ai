import { Fragment, type ReactNode } from 'react'

type Props = {
  text: string
  onCite?: (n: number | null) => void // passa il mouse su [1] → evidenzia la fonte 1
}

// Mini-renderer del testo del modello: paragrafi, elenchi puntati e numerati, **grassetto** e citazioni [n].
// Volutamente piccolo: niente HTML dal modello, quindi niente rischio di XSS.
export function RichText({ text, onCite }: Props) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        const bullet = lines.every((l) => /^\s*[-*•]\s+/.test(l))
        const ordered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l))
        if (bullet || ordered) {
          const items = lines.map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
          const List = ordered ? 'ol' : 'ul'
          return (
            <List key={i}>
              {items.map((item, j) => (
                <li key={j}>{inline(item, onCite)}</li>
              ))}
            </List>
          )
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, onCite)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

function inline(text: string, onCite?: (n: number | null) => void): ReactNode[] {
  // Divide il testo su **grassetto** e [n]; le parti dispari sono i match.
  return text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) return <strong key={i}>{bold[1]}</strong>
    const cite = part.match(/^\[(\d+)\]$/)
    if (cite) {
      const n = Number(cite[1])
      return (
        <sup
          key={i}
          className="cite"
          tabIndex={0}
          aria-label={`Fonte ${n}`}
          onMouseEnter={() => onCite?.(n)}
          onMouseLeave={() => onCite?.(null)}
          onFocus={() => onCite?.(n)}
          onBlur={() => onCite?.(null)}
        >
          {n}
        </sup>
      )
    }
    return part
  })
}
