# ClauseWise: private legal document triage (PS-2)

ClauseWise reads a PDF or TXT legal document on your own machine and explains it in plain language. It uses Google Gemma 3n running locally. Every finding comes with the exact passage it is based on, and what the document states is kept separate from interpretation and concerns. Questions it cannot answer from the document, or that need legal judgment, are flagged as such. **It is not a lawyer and does not give legal advice.**

Nothing leaves the device during normal use. Downloads happen only at setup (Python and npm packages, Ollama, the Gemma weights). See `docs/privacy.md`.

## Folder layout

| Path | What |
|---|---|
| `backend/` | FastAPI service on 127.0.0.1:8000: parsing, retrieval, Gemma calls, citation checks, safety rules ([backend/README.md](backend/README.md)) |
| `frontend/` | React + TypeScript app ([frontend/README.md](frontend/README.md)) |
| `docs/` | API contract, architecture, model card, privacy, evaluation, requirements traceability, decisions, backend plan |
| `scripts/` | `env_report.py` (hardware report), `e2e_check.py` (end-to-end check), `offline_check.sh` (offline run for Linux/WSL) |
| `screenshots/` | UI screenshots |

## Quick start

Prerequisites: Python 3.10+, Node.js 22 LTS, and [Ollama](https://ollama.com/download).

```bash
# 1. model (one-time download, about 5.6 GB; accept the Gemma Terms of Use)
ollama pull gemma3n:e2b

# 2. backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
python -m clausewise            # leave running: http://127.0.0.1:8000/api/health

# 3. frontend (new terminal)
cd frontend
npm ci
npm run dev                     # open http://127.0.0.1:5173
```

Alternatively, run `npm run build` in `frontend/` and the backend serves the built app at http://127.0.0.1:8000/.

## Status

This is work in progress. See `docs/backend-plan.md` and `docs/requirements-traceability.md`. Real Gemma inference has not been measured yet; the first run is on the team laptop.

## Licence

Apache-2.0 (`LICENSE`). The Gemma model weights are not included and are covered by the Gemma Terms of Use.
