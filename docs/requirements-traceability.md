# Requirements traceability (PS-2)

Source: *ZeroDay OSS Hacktoberfest 2026 Participant Guide*, checked 17 Oct 2026. Page numbers refer to that PDF.
Owners: **BE** = backend/AI teammate, **FE** = frontend teammate, **Both**.
Status: ✅ done and tested · 🟡 partly done · ⬜ not started. Frontend columns are maintained by the frontend thread, backend columns by the backend thread.

## Mandatory features L1–L10 (p. 7)

| ID | Requirement | Owner | Frontend implementation | Verification | FE status | BE status |
|---|---|---|---|---|---|---|
| L1 | Local ingestion of PDF or plain text | Both | `FileUploader`, `checkFile` (type, size, empty), multipart upload in `api.analyze` | `validateFile.test.ts`, App "rejects unsupported…" | ✅ | ✅ `document_parser.py`: PDF (pypdf) + TXT, content-type sniffing, size/page/char limits; `test_parser.py` |
| L2 | On-device extraction and interpretation | BE | Shows extraction status, partial/unreadable pages, backend errors (`no_extractable_text`, `encrypted_pdf`…) | App "shows backend extraction errors" | ✅ | 🟡 Extraction ✅ (in memory, page offsets); interpretation by local Gemma implemented, not yet run on real weights |
| L3 | Plain-language summaries and explanations | Both | `OverviewPanel` summary, finding explanations, "In plain language" block | App full-flow test | ✅ | 🟡 Summary, finding explanations, glossary prompts + screening implemented; real-model quality pending |
| L4 | Obligations, rights, deadlines, penalties, termination, concerns | Both | Category labels and filters, only categories present are offered; "Not found in the reviewed text" list | App full-flow test | ✅ | 🟡 Categories via Gemma + deterministic "not found in the reviewed text" topics (`test_not_found_topics_use_safe_wording`); real-model recall pending |
| L5 | Responses supported by identifiable source passages | Both | `EvidencePanel` quotes with page/section; `SourceViewer` highlights only on offset match or unique exact match; "No supporting passage found" | `locatePassage.test.ts`, App full-flow | ✅ | ✅ Every passage re-derived from source offsets; fabricated quotes dropped (`test_fabricated_quotes_are_never_shown`, e2e mismatch check) |
| L6 | Distinguish explicit statements from interpretations/concerns | Both | `classification` badges (icon + text), separate quote block vs "AI interpretation" box, legend | App full-flow | ✅ | ✅ classification enforced and downgraded when evidence fails; figure check (`test_wrong_numbers_in_explanation_are_withheld`) |
| L7 | Recognise ambiguity, insufficient evidence, jurisdiction issues | Both | `answer_type` badges, jurisdiction note, `not_established`, unverified evidence downgrade | App enforceability test, api downgrade tests | ✅ | 🟡 Silent-document and jurisdiction handling tested; ambiguity/contradiction depends on the model, pending |
| L8 | Refuse unsupported conclusions, recommend a qualified professional | Both | Persistent "not a lawyer" disclaimer, escalation notes; no frontend logic ever labels a document valid/enforceable | App enforceability test | ✅ | ✅ Legal-judgment/advice questions always escalate; conclusion sentences removed (`test_ask_enforceability_escalates`, `test_legal_conclusions_are_screened`) |
| L9 | Demonstrable privacy | Both | Same-origin requests only, production CSP `connect-src 'self'`, no storage/logging, privacy dialog that does not overclaim | Playwright check: no external requests; App test: storage empty, no console output | 🟡 (FE side done; needs joint offline test) | 🟡 Egress guard, loopback-only, no temp files, content-free logs tested; offline harness PASS with stand-in model; real run pending |
| L10 | Meaningful Gemma use, reproducible open source | Both | Shows model name/runtime/quantization from `/api/health`; pinned `package-lock.json` | `npm ci && npm test && npm run build` | 🟡 | 🟡 Ollama/llama.cpp engine done; Gemma 3n E2B not yet run (container blocks model downloads) |

## Required technology and privacy rules (p. 7)

| Rule | Guide status | Implementation | Verification | Status |
|---|---|---|---|---|
| Google Gemma, preferably Gemma 3n E2B/E4B (Gemma 4 E2B/E4B accepted after checking its model card); meaningful part of document understanding; report memory and speed | REQUIRED | `gemma3n:e2b` via Ollama (`docs/model-card.md`) | Real run + `/api/metrics` | 🟡 BE, real run pending |
| Snowflake / cloud data platform | Not required; must not receive document content | Not used | Code review | ✅ |
| Private contents (file, text, chunks, embeddings, summaries, answers, names, metadata, questions) stay on device, shown by a reproducible test | REQUIRED | `docs/privacy.md`, `scripts/offline_check.sh` | Offline run + connection monitoring | 🟡 BE |
| Open-source deliverable: code, setup and dependency info, model acquisition instructions, architecture explaining local processing, reusable beyond one document | REQUIRED | `backend/README.md`, `docs/model-card.md`, `docs/architecture.md` | Newcomer setup run | 🟡 Both |
| Local inference, parsing, OCR, embeddings, vector stores | Allowed | Local inference + parsing; no OCR/embeddings | | ✅ |
| Downloading weights/deps/public datasets at setup | Allowed; separate setup from operation | Documented separately (`docs/privacy.md`) | | ✅ |
| Remote LLM/hosted APIs, cloud OCR/translation/embeddings/storage receiving content | Not allowed | None; runtime URL must be loopback; egress guard | `test_privacy.py` | ✅ BE |
| Telemetry, analytics, crash reports, logs with content or derived text | Not allowed | None; logs metadata only | `test_logs_contain_no_document_content_or_questions` | ✅ BE |
| Any other network access (e.g. update checks) | Document; no content; optional or off | Backend makes none. Ollama desktop app may check for updates: to verify and document on the laptop | Offline run | 🟡 |
| Document scope | State honestly, test within it (p. 7) | Proposed: English rental and employment agreements | | 🟡 needs team decision |

## Rubric weights (p. 9) and final score (p. 10)

PS-2 track (100): accuracy 15, grounding 15, uncertainty/refusal/escalation 15, privacy/network isolation 15, Gemma integration 10, robustness 12, usability 8, reusability/docs 10. Common (100): C1 10, C2 20, C3 15, C4 15, C5 15, C6 10, C7 10, C8 5. Final = 0.70 × track + 0.30 × common. A failed gate means the team is not ranked. Mapping of tests to criteria: `docs/evaluation.md`.

Deadlines, portal and team rules: not stated in the guide ("announced separately by the organizers", p. 11).

## Compliance gates (p. 10)

| Gate | Pass condition | Owner | Status |
|---|---|---|---|
| G1 | Public repo with open-source licence file | Both | 🟡 Apache-2.0 `LICENSE` proposed by backend; no repo yet |
| G2 | Reproducible demo without undisclosed credentials or paid services | Both | 🟡 Frontend needs only Node + npm |
| G3 | Real system, no mock-ups or hard-coded outputs | Both | 🟡 Frontend renders only backend responses; fixtures live in `frontend/tests/` and are never imported by the app. Backend: all analysis comes from the model + source text; the scripted engine lives only in `backend/tests/` |
| G4 | Dataset sources/licences disclosed; no private data committed | Both | 🟡 Backend uses only synthetic fixtures written for this project (`docs/decisions.md`) |
| G5 | No secrets in repo | Both | ✅ Frontend and backend have none; `.env*` ignored |
| L1–L4 gate | Gemma runs locally; no content leaves device; no systematic fabrication; not presented as legal advice, shows escalation | Both | 🟡 Frontend side done; backend checks done and tested; real Gemma run pending |

## Score caps and rubric (p. 9)

Safety cap: Poor on criterion 2 (grounding), 3 (uncertainty/refusal) or 4 (privacy) caps PS-2 at 40. These are release blockers.
Judges will test: offline run, connection monitoring, code/dependency review for remote calls and telemetry, temp-file checks, citations, unanswerable questions, "is this enforceable?", vague clauses, prompt-injection text, documents we did not script.

## Submission S1–S10 (p. 11)

| ID | Deliverable | Owner | Status |
|---|---|---|---|
| S1 | Public repo + licence | Both | ⬜ |
| S2 | README: overview, setup, run, config, troubleshooting | Both | 🟡 `frontend/README.md` done |
| S3 | Pinned deps, tool versions, OS/hardware, model sizes | Both | 🟡 Frontend pinned (exact versions + lockfile, Node 22.22.0); backend `requirements*.txt` pinned, Python 3.13.16; laptop hardware and model size pending (`scripts/env_report.py`) |
| S4 | Architecture diagram/explanation | Both | 🟡 `docs/architecture.md` (backend side) |
| S5 | Dataset sources, licences, attributions | BE | 🟡 Synthetic fixtures only so far (`docs/decisions.md`) |
| S6 | How Gemma is used | BE | 🟡 `docs/model-card.md`; measurements pending |
| S7 | Working demo (≈5 min recording recommended) | Both | ⬜ |
| S8 | Test results and known limitations | Both | 🟡 Frontend results below; backend in `docs/evaluation.md` |
| S9 | Instructions to reproduce the demo | Both | 🟡 `backend/README.md`, `scripts/offline_check.sh`, `scripts/e2e_check.py` |
| S10 | Main technical contribution statement | Both | ⬜ |

PS-2 extras: offline run log + connection monitoring output; explanation of every network call; model acquisition instructions; sample outputs with cited passages beside the source and a "document is silent" case (the frontend's evidence panel and "Document does not specify this" state support this); recommended refusal/escalation and prompt-injection results.

## Frontend test results (2026-10-18, Node 22.22.0, Linux container)

- `npx vitest run`: 4 files, 31 tests passed (file validation, v0.2 fields and v0.1 compatibility, API client incl. malformed/unreachable/error envelope/multipart, passage location, 10 UI workflow tests incl. stale-result and cancel, duplicate submission, deletion failure, enforceability escalation, storage/console checks).
- `tsc -b`: no errors (strict, `noUncheckedIndexedAccess`).
- `vite build`: 245 kB JS / 77 kB gzip; CSP meta present in `dist/index.html`.
- `npm audit`: 0 vulnerabilities.
- Playwright (Chromium) against the production build with mocked `/api` routes at 1440×900 and 390×844: no console errors, no requests to any other origin, no horizontal overflow on mobile.
- End to end (`frontend/e2e/real-backend.mjs`): built app served by the real backend v0.2, with the backend's scripted model stand-in instead of Gemma. TXT, PDF and injection documents analysed; quotes highlighted in source view for TXT and PDF; enforceability → "Needs a qualified professional"; pet policy → "Document does not specify this"; deletion confirmed; broken PDF rejected; browser storage empty; no request left 127.0.0.1. Not yet run with real Gemma.

Known frontend limitations: no in-app PDF renderer (the source viewer shows extracted text, which can differ in layout from the PDF); not yet run with the real Gemma model; one document at a time; analysis is one synchronous request, so there is no real progress percentage.

## Backend test results (2026-10-18, Python 3.13.16, Linux container, no GPU)

- `python -m pytest -q` in `backend/`: 70 passed. The model is a test-only scripted stand-in, so these cover parsing, citation validation, safety, privacy controls and the API, not Gemma's quality.
- `scripts/offline_check.sh` with the stand-in: PASS (no outbound route in the namespace, 29/29 backend connections to 127.0.0.1, 0 passage mismatches).
- Not run yet: real Gemma inference, memory/speed (container has no GPU and blocks model downloads).

## Open questions

- Repo hosting and licence choice (G1/S1).
- ~~Backend agreement on `docs/api-contract.md`~~ resolved in v0.2.
- Laptop hardware/OS and first real Gemma run (backend).
