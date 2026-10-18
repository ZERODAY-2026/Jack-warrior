# Clausewise frontend

React 19 + TypeScript (strict) + Vite single-page app for the Private Legal Document Triage Agent (PS-2).
It talks only to the local backend described in [`../docs/api-contract.md`](../docs/api-contract.md).

## Run

Prerequisites: Node.js 22 LTS (tested with 22.22.0) and npm 10.

```bash
cd frontend
npm ci                 # exact versions from package-lock.json
npm run dev            # http://127.0.0.1:5173, proxies /api to http://127.0.0.1:8000
```

Start the backend first (see the root README). To point the proxy elsewhere on your own machine:
`CLAUSEWISE_BACKEND_URL=http://127.0.0.1:9000 npm run dev`.

| Command | What it does |
|---|---|
| `npm test` | Unit, API-client and workflow tests (Vitest + Testing Library, jsdom) |
| `npm run typecheck` | `tsc -b` in strict mode |
| `npm run build` | Typecheck, then production build to `dist/` with a strict CSP |
| `npm run preview` | Serve `dist/` on 127.0.0.1:4173 with the same `/api` proxy |

Optional env vars (`.env.local`, never committed): `VITE_ANALYZE_TIMEOUT_MS` (default 15 min), `VITE_ASK_TIMEOUT_MS` (default 5 min).

## What it does

1. Checks `GET /api/health` and shows whether the local backend and Gemma model are ready. Analysis is disabled until they are.
2. Accepts one PDF or TXT by drag-and-drop or file picker, checks type and size against the backend's limits, then uploads on an explicit "Analyse document" click.
3. Shows elapsed time while the model runs (no invented progress percentage) and lets the user cancel.
4. Review workspace: Overview (summary, how to read labels, "review first", "not found in the reviewed text"), Findings (filter by topic, type, priority), Ask a question.
5. Evidence panel: the document's own words in a serif quote block with page/section and verification status, kept visually apart from the AI interpretation. "No supporting passage found" is shown when there is none.
6. "View in document" opens the extracted page and highlights the passage only when the backend's offsets match the quote, or the quote is an exact unique match. Otherwise it says it could not locate it.
7. "Remove document" calls `DELETE /api/documents/{id}` and only says the backend deleted its copy when the backend confirms.

## Privacy rules this code follows

- All requests are same-origin `/api/*`. Production builds ship a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to any other host.
- No analytics, error reporting, remote fonts, CDNs or remote models. Icons are bundled (lucide-react).
- Document text, findings and questions live only in React state. Nothing is written to localStorage, sessionStorage, IndexedDB or cookies, and nothing is logged to the console. A test asserts this.
- Every async result is tied to the document session it started in; results that arrive after the user removed or replaced the document are discarded, and an orphaned analysis is deleted on the backend.
- Backend responses are validated at runtime (`src/services/validate.ts`). A response that does not match the contract is shown as an error, never partially rendered. Evidence is downgraded if passages are missing or unverified.

A frontend cannot prove the whole system is private. The backend's offline and network-monitoring test is the evidence (`docs/privacy.md`).

## Structure

```
src/
  App.tsx                     page states and review workspace
  services/api.ts             typed client, timeouts, error mapping
  services/validate.ts        runtime response validation
  hooks/useBackendHealth.ts   health polling
  hooks/useDocumentSession.ts document lifecycle, stale-result protection
  components/                 upload, analysis, evidence, ask, privacy, common
  styles/                     tokens.css, layout.css, components.css
tests/                        Vitest suites; tests/fixtures are test-only
```

## Accessibility

Semantic landmarks, skip link, labelled controls, visible focus rings, keyboard tabs (arrow keys), native `<dialog>` for overlays, live-region announcements for analysis start/finish/removal, icons plus text on every status (never colour alone), `prefers-reduced-motion` support, and layouts for desktop (3 panels), tablet (2) and phone (1 column with a sticky section bar).

## Test results

Latest local run (2026-10-18): 31/31 tests passing, `tsc -b` clean, production build 245 kB JS (77 kB gzip), `npm audit` 0 vulnerabilities.
Not yet done: an end-to-end run against the real backend and Gemma model.

## End-to-end check against the backend

`e2e/real-backend.mjs` drives the production build (served by the backend at `/`) in Chromium: TXT, PDF and a prompt-injection document, findings, source highlighting, four questions, deletion and a broken PDF. It reports console errors and any request to another origin.

Run on 2026-10-18 against backend v0.2 with its scripted Ollama stand-in (`tests/fake_ollama.py`), not real Gemma, so it checks the wiring and safety states, not answer quality. Every step passed: quotes highlighted in TXT and PDF; "Is this contract enforceable?" returned "Needs a qualified professional"; "Is there a pet policy?" returned "Document does not specify this"; deletion confirmed by the backend; injection warning shown; broken PDF rejected with a clear message; browser storage empty; no request left 127.0.0.1.
