# Privacy and network behaviour

Requirement (guide p. 7, L9): private document contents (the file, extracted text, chunks, embeddings, summaries, answers, names, metadata and the user's questions) stay on the device, demonstrated with a credible, reproducible test.

## Setup time vs normal operation

| Phase | Network use | Content sent |
|---|---|---|
| Setup: `pip install -r backend/requirements.txt`, `npm ci` | PyPI / npm registry | none |
| Setup: install Ollama, `ollama pull gemma3n:e2b` | ollama.com / Ollama registry | none |
| **Normal operation**: upload, analysis, questions, deletion | **loopback only**: browser → backend `127.0.0.1:8000`, backend → Ollama `127.0.0.1:11434` | stays on the machine |

## What is stored, where, for how long

| Data | Where | Lifetime |
|---|---|---|
| Uploaded file bytes | backend process memory, during parsing only | dropped after extraction; never written to disk (multipart spooling disabled, tested) |
| Extracted text, chunks, BM25 index, analysis, Q&A history | backend process memory (`store.py`) | until `DELETE /api/documents/{id}`, 1 hour TTL, eviction beyond 20 documents, or backend exit |
| Prompts and model outputs | Ollama process memory (KV cache) | Ollama keeps the model loaded for 30 minutes (`keep_alive`); ClauseWise does not ask Ollama to store anything |
| Logs | stdout of the backend | metadata only: sizes, page counts, durations, counts, error codes, random document ids. Never filenames, text, questions or answers (tested) |

Not implemented, so not claimed: encryption at rest (nothing is at rest), secure memory wiping, multi-user isolation (the backend is for one local user; document ids are random 96-bit values).

Ollama's own logs: Ollama's server log records requests and timings, and with `OLLAMA_DEBUG=1` can log prompts. Do not enable debug logging when processing private documents. Check where your install writes logs (`~/.ollama/logs` on macOS/Windows, the systemd journal on Linux).

## Controls in the code

1. **Bind to loopback.** The backend refuses a non-loopback bind address unless `CLAUSEWISE_ALLOW_NON_LOOPBACK_BIND=1` (`config.py`). Binding to localhost is useful but is not, by itself, proof of privacy.
2. **Loopback-only inference URL.** `CLAUSEWISE_RUNTIME_URL` must resolve to 127.0.0.1, ::1 or localhost, so a misconfiguration cannot send text to a remote model server.
3. **No proxy for inference.** The inference HTTP client uses `trust_env=False`, so `HTTP(S)_PROXY` variables cannot route document text through a proxy (tested with bogus proxy variables set).
4. **In-process egress guard** (`privacy.py`, on by default). Python's `socket.getaddrinfo`, `socket.connect` and `connect_ex` are wrapped: any lookup of a non-local hostname or connection to a non-loopback address raises and is counted by destination in `/api/health` and `/api/metrics`. This also covers any dependency that might try to phone home. It is defence in depth, not the proof.
5. **No telemetry.** No analytics, crash reporting or update checks exist in the backend. FastAPI's Swagger UI is disabled because it loads assets from a CDN. Dependencies (FastAPI, Starlette, Uvicorn, Pydantic, pypdf, python-multipart, httpx) have no telemetry.
6. **Content-free errors.** Unexpected exceptions are logged by type only, because exception messages can contain document text; API errors never include stack traces, paths or document text (tested).

## Reproducible offline test (Linux or WSL2)

```bash
scripts/offline_check.sh path/to/document.pdf
```

The script:

1. creates a new network namespace with `unshare -rn`, which contains only a loopback interface, and confirms an outbound connection fails;
2. starts `ollama serve` and the backend inside it, with the backend traced by `strace -f -e trace=connect`;
3. runs `scripts/e2e_check.py`: upload, analysis, five questions (notice period, late payment, "is this enforceable?", a question the document is silent on, "should I sign this?"), passage verification against the extracted text, deletion;
4. lists every `connect()` the backend made and fails if any target is not loopback or a Unix socket.

Evidence goes to `evidence/` (git-ignored): `backend_connect.strace`, `backend.log`, `runtime.log`, `e2e_offline.json`.

If Ollama runs as a system service, point `OLLAMA_MODELS` at its model directory (often `/usr/share/ollama/.ollama/models`) so the namespaced `ollama serve` finds the weights.

### Self-test of the harness (no model)

```bash
OLLAMA_SERVE_CMD="python3 backend/tests/fake_ollama.py" scripts/offline_check.sh
```

Run in the development container on 2026-10-18 with a scripted Ollama-compatible stand-in (no Gemma): outbound network unreachable inside the namespace; two documents analysed and ten questions answered; 0 passage mismatches; strace saw 29 `connect()` calls, all to 127.0.0.1; result PASS. This proves the harness and the backend's network behaviour, not model quality.

## Offline test on Windows (native)

1. Start Ollama and the backend, open the app, and load the model once (`GET /api/health` shows `ready`).
2. Disconnect Wi-Fi/Ethernet (or enable Airplane mode).
3. Run a full analysis and the five questions from the UI or with `python scripts/e2e_check.py <file>`.
4. While it runs, record connections: `Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notin '127.0.0.1','::1' }` in PowerShell, or Sysinternals TCPView filtered to `python.exe` and `ollama.exe`. Expected: no rows for those processes.
5. Check `/api/metrics`: `blocked_outbound_attempts` should be `{}`.

## Threat model (honest scope)

- **In scope:** accidental or hidden transmission of document content by ClauseWise or its Python dependencies; content in logs, temp files and error messages; prompt injection in documents trying to change behaviour.
- **Out of scope:** a compromised operating system or malware on the machine; other local users with access to the same account; the browser's own behaviour (extensions, sync); swap files or memory dumps written by the OS; Ollama's internal behaviour beyond what its documentation and the offline test show.
