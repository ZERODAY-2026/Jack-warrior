# ClauseWise backend

Local FastAPI service that reads PDF/TXT legal documents, analyses them with Gemma running on this machine, and returns findings with passages copied from the document. Not legal advice.

## Requirements

- Python 3.10+ (tested: 3.13.16)
- [Ollama](https://ollama.com/download) with `gemma3n:e2b` pulled, or llama.cpp `llama-server` with a Gemma 3n E2B GGUF (see `../docs/model-card.md`)
- About 6 GB of disk for the model; a GPU is optional (Ollama offloads to CPU)

## Setup (needs network once)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt          # add -dev for tests: pip install -r requirements-dev.txt
ollama pull gemma3n:e2b
```

## Run (no network needed)

```bash
ollama serve            # if Ollama is not already running as a service
python -m clausewise    # from backend/; listens on http://127.0.0.1:8000
curl http://127.0.0.1:8000/api/health
```

The model state in `/api/health` goes `loading` → `ready` after a warm-up call (first load can take a while). If `frontend/dist` exists next to `backend/`, the app is served at `http://127.0.0.1:8000/`. In development run the Vite dev server, which proxies `/api` here.

## Test

```bash
python -m pytest -q
python ../scripts/e2e_check.py tests/fixtures/rental_agreement.txt   # against a running backend + real model
../scripts/offline_check.sh                                           # Linux/WSL: full run with networking removed
```

## Configuration

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `CLAUSEWISE_HOST` / `CLAUSEWISE_PORT` | `127.0.0.1` / `8000` | Bind address. Non-loopback is refused unless `CLAUSEWISE_ALLOW_NON_LOOPBACK_BIND=1` |
| `CLAUSEWISE_RUNTIME` | `ollama` | `ollama` or `llamacpp` |
| `CLAUSEWISE_RUNTIME_URL` | `http://127.0.0.1:11434` (ollama), `http://127.0.0.1:8080` (llamacpp) | Must be loopback |
| `CLAUSEWISE_MODEL` | `gemma3n:e2b` | Model tag/name in the runtime |
| `CLAUSEWISE_NUM_CTX` | `8192` | Context window requested from Ollama |
| `CLAUSEWISE_TEMPERATURE` | `0.1` | |
| `CLAUSEWISE_MAX_OUTPUT_TOKENS` | `1024` | Per call |
| `CLAUSEWISE_REQUEST_TIMEOUT_S` | `600` | Per model call |
| `CLAUSEWISE_WARMUP` | `1` | Load the model at startup with a content-free prompt |
| `CLAUSEWISE_MAX_FILE_BYTES` | `10485760` | Upload limit |
| `CLAUSEWISE_MAX_PAGES` / `CLAUSEWISE_MAX_CHARS` | `80` / `400000` | Read limits |
| `CLAUSEWISE_ANALYSIS_CHAR_BUDGET` | `24000` | Characters analysed in detail by the model |
| `CLAUSEWISE_WINDOW_CHARS` | `4000` | Characters per model call |
| `CLAUSEWISE_DOCUMENT_TTL_S` / `CLAUSEWISE_MAX_DOCUMENTS` | `3600` / `20` | In-memory retention |
| `CLAUSEWISE_EGRESS_GUARD` | `1` | Block non-loopback DNS and connections from the backend process |

## Layout

```
clausewise/
  app.py              routes, error envelope, upload handling
  config.py           settings + loopback validation
  document_parser.py  PDF/TXT extraction with page offsets
  chunking.py         source-preserving chunks
  retrieval.py        BM25 + legal synonyms
  gemma_engine.py     Ollama / llama.cpp clients (loopback only)
  analysis.py         prompts, findings, summary, Q&A
  citations.py        quote location and support checks
  safety.py           triage, output screening, injection detection
  privacy.py          egress guard, logging policy
  store.py            in-memory document store
  schemas.py          API models (mirror of docs/api-contract.md)
tests/                pytest suite; scripted_engine.py is a test-only model stand-in
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` model `error`: "Ollama is not running" | Start `ollama serve` or the Ollama app; check `curl http://127.0.0.1:11434/api/tags` |
| model `not_installed` | `ollama pull gemma3n:e2b`, or set `CLAUSEWISE_MODEL` to a tag shown by `ollama list` |
| `504 timeout` on analysis | Raise `CLAUSEWISE_REQUEST_TIMEOUT_S`, lower `CLAUSEWISE_WINDOW_CHARS`, or check `ollama ps` shows the GPU in use |
| Out of GPU memory | Lower `CLAUSEWISE_NUM_CTX` (e.g. 4096); Ollama will place fewer layers on the GPU |
| `no_extractable_text` | The PDF is a scan; OCR is not supported |
| `Configuration error: Refusing to bind` | Use the default `127.0.0.1` |
