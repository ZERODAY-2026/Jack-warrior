# Backend plan and status (AI/backend lead)

Last updated 2026-10-18. Details live in the linked documents; this page is the overview.

## 1. Guide coverage

All 11 pages of the participant guide were read (text extracted with `pdftotext`; tables and the boxed "Important boundary" note on p. 6 included). Nothing was inaccessible. The PS-2 checklist with sources, owners, verification and status is `requirements-traceability.md`.

## 2. Mandatory requirements in one paragraph

A privacy-first, on-device tool (not a lawyer) that ingests PDF or TXT locally (L1), extracts and interprets it on the device (L2), explains important clauses in plain language (L3), identifies obligations, rights, deadlines, penalties, termination conditions and concerns where present (L4), supports every response with identifiable source passages (L5), separates what the text states from interpretation and concern (L6), recognises ambiguity, missing evidence and jurisdiction-dependent issues (L7), refuses unsupported conclusions and recommends a qualified lawyer (L8), proves with a reproducible test that private content never leaves the device (L9), and uses a Gemma 3n-class model meaningfully in a reproducible open-source repo (L10). Gates G1–G5 and the PS-2 gate are pass/fail; grounding, uncertainty and privacy below "Poor" cap the score at 40.

## 3. Hardware and model feasibility

| Environment | Facts (measured) | Consequence |
|---|---|---|
| Development container (this thread) | Ubuntu 24.04, Python 3.13.16, 4 vCPU Xeon 2.8 GHz, 15.7 GB RAM, no GPU, outbound access to huggingface.co, kaggle.com, ollama.com and registry.ollama.ai blocked by policy | Gemma cannot be downloaded or run here. Everything around the model is built and tested against a scripted stand-in. |
| Team laptop (reported) | RTX 3050 Laptop GPU, ~6 GB VRAM: **not yet verified** | Run `python scripts/env_report.py` there. |

Choice: **Gemma 3n E2B via Ollama (`gemma3n:e2b`, Q4_K_M)**. E2B at Q4 is close to 6 GB, so expect partial GPU offload; E4B (~7.5 GB at Q4) would run mostly on CPU. See `model-card.md`.

## 4. Architecture and API

`architecture.md` (data flow, trust boundaries, trade-offs) and `api-contract.md` v0.2 (agreed with the frontend thread).

## 5. Phases and acceptance tests

| Phase | Scope | Acceptance | Status |
|---|---|---|---|
| 0 Plan | guide checklist, environment, architecture, contract | docs reviewed by the team | ✅ |
| 1 Skeleton | FastAPI app, health, schemas, config, tests | `pytest` green, `/api/health` reports model state | ✅ |
| 2 Ingestion | PDF/TXT, offsets, error cases | `test_parser.py` | ✅ |
| 3 Local Gemma | Ollama/llama.cpp engine, warm-up, metrics | engine tested against an Ollama-compatible server ✅; **real Gemma run on the laptop** ⬜ | 🟡 |
| 4 Grounded analysis | chunking, retrieval, findings, citations, summary, Q&A, escalation | `test_api.py`, `test_citations.py`, `test_safety.py` ✅; real-model evaluation set ⬜ | 🟡 |
| 5 Privacy and robustness | egress guard, no temp files, content-free logs, offline harness, injection, malformed files | `test_privacy.py` ✅, `offline_check.sh` self-test ✅; offline run with real model ⬜ | 🟡 |
| 6 Frontend integration | run the frontend against this backend | full flow on real documents | ⬜ |
| 7 Evaluation and release | measured performance, limitations, demo, README | `evaluation.md` filled with measured numbers | ⬜ |

## 6. Risks and unknowns

| Risk | Impact | Mitigation |
|---|---|---|
| Gemma not yet run anywhere | Phase 3–5 unverified with the real model | First task on the laptop: `ollama pull gemma3n:e2b`, `scripts/e2e_check.py` |
| E2B speed on a 6 GB laptop GPU | Synchronous analysis may take minutes | Budget/window settings; job polling as v0.3 if needed |
| Small-model quality (missed clauses, loose paraphrase) | Accuracy score | Source passage beside every explanation; figure check; evaluation set; try E4B if E2B is weak |
| Ollama's own network behaviour (desktop app update checks) | Privacy documentation | Offline run + connection monitoring on the laptop; document what is seen |
| pypdf on complex layouts | Robustness | Test multi-column PDFs; report limits honestly |
| No shared GitHub repo yet | G1/S1, branch workflow | Shared folder + git bundles until the repo exists |

## 7. Decisions needed from the team

1. GitHub repository (owner/name) and connecting GitHub to this project.
2. Running the first real Gemma inference on the laptop (manually, or by letting Claude run it there via Remote Control).
3. Document scope (proposed: English rental and employment agreements).
4. Licence (proposed: Apache-2.0).
