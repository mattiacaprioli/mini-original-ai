# Mini Original AI

Agente AI per il servizio clienti di un e-commerce, con dati e modelli **interamente in locale**:
chat in streaming, tool calling, memoria della conversazione e caricamento di documenti per il RAG.

Stack: **Bun + TypeScript**, **LangChain.js**, **Ollama** (LLM ed embedding locali), **MongoDB Atlas Local**, **BullMQ + Redis**, **React + Vite**.

## Architettura

```
Browser (React) ──SSE──> Server Bun ──> Agente (LangChain) ──> Ollama (qwen2.5:7b)
                              │               ├──> Tool: get_order_status
                              │               └──> Tool: search_knowledge_base ──> hybrid search (vettoriale + full-text, RRF)
                              │
                              ├──> MongoDB: conversazioni, documenti, chunk + embedding
                              └──> Redis (BullMQ) ──> Worker: chunking + embedding (bge-m3)
```

- **Chat**: risposta in streaming via SSE con eventi tipizzati (`meta`, `token`, `tool_start`, `tool_end`, `error`, `done`).
- **Ingestion**: l'upload risponde subito `202`, un worker separato elabora il documento dalla coda.
- **RAG**: a ogni domanda (tranne i saluti) il codice riscrive la domanda usando la storia, poi cerca l'ordine o nei documenti; il modello risponde citando le fonti, che arrivano anche al client come evento `sources`.

## Prerequisiti

- [Bun](https://bun.com)
- Docker (OrbStack o Docker Desktop)
- [Ollama](https://ollama.com) con i modelli:
  ```bash
  ollama pull qwen2.5:7b   # chat e tool calling
  ollama pull bge-m3       # embedding multilingue (1024 dimensioni)
  ```

## Installazione

```bash
bun install
cd web && bun install && cd ..
echo 'MONGODB_URI=mongodb://localhost:27018/?directConnection=true' > .env
docker compose up -d     # MongoDB (porta 27018) e Redis (porta 6380)
```

## Avvio

Servono quattro processi, ognuno nella sua finestra del terminale:

| # | Processo | Comando |
| --- | --- | --- |
| 1 | Ollama | apri l'app Ollama (oppure `ollama serve`) |
| 2 | Server API | `bun --watch src/server.ts` |
| 3 | Worker di ingestion | `bun --watch src/worker.ts` |
| 4 | Frontend | `cd web && bun dev` → http://localhost:5173 |

Per fermare i database: `docker compose down` (i dati restano nei volumi).

## Porte

| Servizio | Porta |
| --- | --- |
| Frontend (Vite) | 5173 |
| Server API | 3000 |
| Ollama | 11434 |
| MongoDB | 27018 |
| Redis | 6380 |

## API

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| `POST` | `/agent` | Chat con l'agente (SSE). Body: `{ "message": "...", "conversationId"?: "uuid" }` |
| `POST` | `/chat` | Chat semplice senza tool (SSE) |
| `POST` | `/documents` | Upload di un documento `.md` o `.txt` (multipart, campo `file`, max 2 MB) |
| `GET` | `/documents/:id` | Stato dell'elaborazione: `queued`, `processing`, `ready`, `failed` |
| `GET` | `/search?q=...` | Debug: le classifiche vettoriale, full-text e ibrida per una domanda |
| `GET` | `/health` | Health check |

Esempi:

```bash
# Chat in streaming
curl -N -X POST localhost:3000/agent -H 'Content-Type: application/json' \
  -d '{"message":"A che punto è il mio ordine A-1002?"}'

# Upload di un documento e controllo dello stato
curl -s -F "file=@docs/faq.md" localhost:3000/documents
curl -s localhost:3000/documents/<documentId>

# Contenuto del database
docker compose exec mongo mongosh mini_original_ai --quiet --eval 'db.messages.find().toArray()'
```

## Struttura

```
src/
  server.ts         Route HTTP, validazione con Zod, memoria della conversazione
  agent.ts          Agent loop con tool calling e guardrail deterministico sui codici ordine
  tools.ts          Tool dell'agente (get_order_status)
  llm.ts            Scelta del modello (unico punto da cambiare per un altro provider)
  sse.ts            Eventi tipizzati e trasporto SSE
  conversations.ts  Storia della chat su MongoDB (finestra di 20 messaggi, TTL 30 giorni)
  db.ts             Client MongoDB
  queue.ts          Coda BullMQ
  worker.ts         Worker di ingestion (processo separato)
  ingest.ts         Chunking, embedding e salvataggio dei chunk
  documents.ts      Collection documents e chunks
  search.ts         Indici Atlas Search, ricerca vettoriale, full-text e fusione RRF
  embeddings.ts     Modello di embedding
  storage.ts        Salvataggio dei file originali
web/src/
  sse.ts            Parser dello stream SSE (fetch + reader, non EventSource)
  useAgentChat.ts   Hook della chat: streaming, stop, nuova chat
  App.tsx           Interfaccia
docs/faq.md         Documento di esempio per il RAG
```

## Scelte tecniche

- **SSE e non WebSocket**: il flusso va solo dal server al client ed è HTTP standard.
- **AbortSignal propagato** dal browser fino al modello: lo Stop interrompe la generazione.
- **Guardrail deterministico**: se il messaggio contiene un codice ordine, il tool lo chiama il codice e non il modello. Con un modello da 7B il prompt da solo non bastava a evitare risposte inventate.
- **Storia della conversazione sul server**: il client manda solo un `conversationId` e non può falsificare la storia.
- **TTL di 30 giorni** sui messaggi: la policy di conservazione dei dati la applica il database.
- **Ingestion asincrona**: retry con backoff esponenziale, job idempotenti, deduplica tramite hash del contenuto.
- **Recupero deterministico**: nei test il 7B non decideva da solo di cercare e inventava risposte ("sì, spediamo in Giappone"). La ricerca la fa sempre il codice; il modello scrive solo la risposta.
- **Riscrittura della domanda**: "e quando arriva?" diventa "Quando arriva l'ordine A-1002?" prima della ricerca.
- **Hybrid search con RRF**: gli embedding capiscono il significato, il full-text trova le parole esatte (es. "TWINT"); le classifiche si fondono per posizione.
- **Isolamento per tenant**: `tenantId` è un campo filtro dell'indice vettoriale e arriva dal server, mai dagli argomenti del modello.
- **Upload sicuro**: estensioni e dimensione validate; il percorso su disco usa un id generato, mai il nome del file (protezione dal path traversal).

## Prossimi passi

- [x] Ricerca vettoriale con Atlas Vector Search, hybrid search e citazione delle fonti
- [ ] Server MCP che espone gli stessi tool
- [ ] Autenticazione e isolamento per tenant
- [ ] Set di eval automatici per prompt e tool
