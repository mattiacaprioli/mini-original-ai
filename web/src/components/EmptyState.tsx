const SUGGESTIONS = [
  'A che punto è il mio ordine A-1002?',
  'Che orari ha il servizio clienti?',
  'Spedite anche in Germania?',
  'Posso restituire un prodotto dopo 3 settimane?',
]

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <section className="empty">
      <h1 className="empty-title">Come possiamo aiutarti?</h1>
      <p className="empty-lead">
        Chiedi dello stato di un ordine, di spedizioni, resi e pagamenti. Ogni risposta indica da dove arriva.
      </p>
      <ul className="suggestions">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button type="button" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
