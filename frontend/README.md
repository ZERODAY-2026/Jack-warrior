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
2. Accepts one PDF, Word (.docx) or TXT file by drag-and-drop or file picker, checking type and size against the backend's limits, then uploads on an explicit "Analyse document" click. A "Paste text" tab sends pasted text (with an optional name) to `POST /api/documents/text` instead; it appears only when `/api/health` reports `accepts_pasted_text: true`. Old `.doc` files are rejected with a hint to save them as `.docx`.
3. Shows elapsed time while the model runs (no invented progress percentage) and lets the user cancel.
4. Document types (contract v0.4): a "Document type" picker (Auto-detect by default, list from `GET /api/document-types`) is sent with uploads and pasted text. After analysis a card says which type was used; when the backend's confidence is low it opens by itself, names the alternatives, and "Analyse again" calls `POST /api/documents/{id}/reanalyse`, keeping earlier results if that fails or is cancelled. Older backends without the list simply get no picker.
5. Review workspace: Overview (summary, how to read labels, "highest risk first", "not identified in the reviewed text"), Findings (filter by topic, type, risk level), Ask a question.
6. Evidence panel (one finding at a time): evidence from the document, explanation, why it may matter (`impact`), risk level with its reason, and suggested action. Jurisdiction notes are labelled as general information, not from the document. The document's own words in a serif quote block with page/section and verification status, kept visually apart from the AI interpretation. "No supporting passage found" is shown when there is none.
7. "View in document" opens the extracted page and highlights the passage only when the backend's offsets match the quote, or the quote is an exact unique match. Otherwise it says it could not locate it.
8. "Remove document" calls `DELETE /api/documents/{id}` and only says the backend deleted its copy when the backend confirms.

## Privacy rules this code follows

- All requests are same-origin `/api/*`. Production builds ship a Content-Security-Policy with `connect-src 'self'`, so the page cannot send data to any other host.
- No analytics, error reporting, remote fonts, CDNs or remote models. Icons (lucide-react) and the Inter font (@fontsource-variable/inter) are bundled and served from the same origin.
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
  components/layout/          Sidebar (brand, backend status, review tabs, privacy) and Topbar (breadcrumb)
  components/motion/Reveal.tsx shared animation presets
  components/                 upload, analysis, evidence, ask, privacy, common
  styles/                     tokens.css, layout.css, components.css
tests/                        Vitest suites; tests/fixtures are test-only
```

## Design system

- Layout: dark navy sidebar (brand, backend status, current document, review tabs, privacy) beside a warm off-white workspace with a breadcrumb bar. The review screen puts findings next to a sticky evidence panel.
- Tokens live in `src/styles/tokens.css`: colours (one muted-teal accent, status colours with soft backgrounds), radii, shadows, spacing and the Inter font stack.
- Motion (`motion` package, `motion/react`): views, cards and the evidence panel fade and lift 8px over about 240ms; the active tab and the upload/paste switch slide a shared highlight; list items stagger by 35ms, capped. Only opacity and transform animate. `MotionConfig reducedMotion="user"` removes movement when the OS asks for reduced motion, and CSS animations stop too. The analysis bar is indeterminate on purpose, because the backend reports no progress.
- Tests set `MotionGlobalConfig.skipAnimations = true`.

## Accessibility

Semantic landmarks, skip link, labelled controls, visible focus rings, keyboard tabs (arrow keys), native `<dialog>` for overlays, live-region announcements for analysis start/finish/removal, icons plus text on every status (never colour alone), `prefers-reduced-motion` support, and layouts for desktop (sidebar, findings, evidence), tablet (narrower sidebar, evidence below the list) and phone (sidebar becomes a sticky dark top bar with the review tabs).

## Test results

Latest local run (2026-10-18, contract v0.4): 47/47 tests passing, `tsc -b` clean, production build 392 kB JS (125 kB gzip) plus 39 kB CSS, `npm audit` 0 vulnerabilities.
Not yet done: an end-to-end run against the real Gemma model.

## End-to-end check against the backend

`e2e/real-backend.mjs` drives the production build (served by the backend at `/`) in Chromium: TXT, PDF and a prompt-injection document, findings, source highlighting, four questions, deletion and a broken PDF. It reports console errors and any request to another origin.

Re-run on 2026-10-18 against backend v0.3 for .docx upload and pasted text (both analysed, quotes highlighted, question answered with evidence, deletion confirmed, fake .docx rejected by the backend). First run against backend v0.2 with its scripted Ollama stand-in (`tests/fake_ollama.py`), not real Gemma, so it checks the wiring and safety states, not answer quality. Every step passed: quotes highlighted in TXT and PDF; "Is this contract enforceable?" returned "Needs a qualified professional"; "Is there a pet policy?" returned "Document does not specify this"; deletion confirmed by the backend; injection warning shown; broken PDF rejected with a clear message; browser storage empty; no request left 127.0.0.1.
