# Requirements traceability (PS-2)

Source: *ZeroDay OSS Hacktoberfest 2026 Participant Guide* (11 pages, facts checked by the organisers on 17 October 2026). Page numbers refer to that PDF. Updated 2026-10-18 for backend v0.6 and frontend contract v0.6.

Status: ✅ implemented and tested · 🟡 implemented, but not yet verified with real Gemma or not complete · ⬜ not done.
"Stand-in" means the test uses the scripted model in `backend/tests/scripted_engine.py`, so it proves the code around the model, not Gemma's quality.

## Core features L1–L10 (p. 7)

| ID | Requirement | Where | Verification | Status |
|---|---|---|---|---|
| L1 | Local ingestion of at least PDF or plain text | `document_parser.py` (PDF, DOCX, TXT), `app.py` (`/api/documents`, `/api/documents/text`), frontend `FileUploader`, `PasteTextForm` | `test_parser.py`, `test_api.py::test_pasted_text_is_analysed_like_a_file`, `test_upload_and_paste_use_the_same_pipeline`, `test_pasted_text_errors`, browser run with the stand-in | ✅ |
| L2 | On-device extraction and interpretation | Parsing in memory; interpretation by local Gemma (`analysis.py`, `gemma_engine.py`) | Extraction: tests. Interpretation: two real runs on an earlier version (`evaluation.md`) | 🟡 current version not yet run on real Gemma |
| L3 | Plain-language summaries and explanations | Summary, finding explanations, `impact`, glossary (`analysis.py` prompts) | Stand-in tests for structure and screening | 🟡 quality needs the real run |
| L4 | Obligations, rights, deadlines, penalties, termination, concerns | Findings with categories; concerns from Gemma; "Not addressed" points proposed and checked by Gemma | `test_model_concerns_are_shown_as_concerns`, `test_missing_points_are_proposed_and_checked_by_the_model`, `test_divorce_settlement_missing_child_support_is_raised` (stand-in) | 🟡 recall needs the real run |
| L5 | Responses supported by identifiable source passages | `citations.locate`, `DocContext.verify_quote`, `passage()` rebuilds text from offsets; frontend evidence panel and source viewer | `test_analysis_returns_verified_findings_with_source_offsets`, `test_fabricated_quotes_are_never_shown`, `test_a_fabricated_quote_is_dropped_but_a_real_one_in_the_same_finding_is_kept`, e2e mismatch check | ✅ |
| L6 | Explicit statements kept apart from interpretations or concerns | `classification` from Gemma; downgraded to `not_established` without evidence; figure checks | `test_wrong_numbers_in_explanation_are_withheld`, frontend badges | ✅ (labels themselves come from Gemma) |
| L7 | Ambiguity, insufficient evidence, jurisdiction | `concern`/`ambiguity` findings, `uncertainty` → `limitations`, `not_established`, `not_in_document`, jurisdiction note, summary limitation on governing law | `test_ask_document_silent`, `test_ask_enforceability_escalates` | 🟡 ambiguity detection depends on Gemma |
| L8 | Limit unsupported conclusions, recommend a qualified professional | `safety.screen_output`, `safety.triage_question`, Gemma's `needs_professional`, disclaimer | `test_legal_conclusions_are_screened`, `test_ask_advice_escalates`, `test_model_can_escalate_a_question_the_fixed_triage_misses` | ✅ |
| L9 | Demonstrable privacy | Loopback-only config, egress guard, memory-only store, no telemetry, CSP in the frontend | `test_privacy.py`, `scripts/offline_check.sh` (PASS with stand-in), browser run: no request left 127.0.0.1 | 🟡 offline run with real Gemma and connection monitoring still to record |
| L10 | Meaningful Gemma use; reproducible open source | Gemma does type, findings, merging, summary, missing points, answers (`docs/model-card.md`); pinned dependencies; Apache-2.0 | Code review; README setup | 🟡 real-model run of v0.6 pending |

## Technology and privacy rules (p. 7)

| Rule | Implementation | Status |
|---|---|---|
| Gemma 3n-class model, meaningful part of understanding, report memory and speed | `gemma3n:e2b` (Q4_K_M) via Ollama; measured 2.4 GB, 100% GPU, about 50 tokens/s on an RTX 3050 6 GB (`model-card.md`) | ✅ measured on an earlier version; re-measure for v0.6 |
| No cloud service receives document content | None used; runtime URL must be loopback; egress guard | ✅ |
| Private content stays on device, shown by a reproducible test | `docs/privacy.md`, `scripts/offline_check.sh` | 🟡 real-model offline recording pending |
| Source, setup, dependencies, model acquisition, architecture | `README.md`, `backend/README.md`, `frontend/README.md`, `docs/model-card.md`, `docs/architecture.md` | ✅ |
| No telemetry or logs with content | Logs hold counts and timings only (`test_logs_contain_no_document_content_or_questions`) | ✅ |
| Other network access documented, no content, optional | Backend makes none (`docs/privacy.md`). The Ollama desktop app may check for its own updates; this is not yet checked and documented | 🟡 check on the laptop |
| State scope honestly and test within it | README "Objectives and scope" | ✅ |

## Optional ideas (p. 7) that are implemented

Missing-clause detection (Gemma-proposed and Gemma-checked "Not addressed" points), structured extraction of parties and dates in the summary, local deletion controls, prompt-injection tests, malformed-file tests.

## Compliance gates (p. 10)

| Gate | Status |
|---|---|
| G1 Public repo with licence | ✅ https://github.com/ZERODAY-2026/Jack-warrior, Apache-2.0 |
| G2 Reproducible without credentials or paid services | ✅ Ollama and Gemma are free; no accounts besides accepting the Gemma terms |
| G3 Real system, no hard-coded outputs | ✅ Findings come from Gemma and the document. The stand-in model exists only in `backend/tests/`. The only code-made finding is the labelled security warning |
| G4 Data disclosure | ✅ Synthetic samples only |
| G5 No secrets | ✅ |
| PS-2 L1–L4 gate | 🟡 local, no egress, grounded and escalating by design and tests; real-model evidence for v0.6 pending |

## Submission S1–S10 (p. 11)

| ID | Deliverable | Where | Status |
|---|---|---|---|
| S1 | Public repo and licence | GitHub, `LICENSE` | ✅ |
| S2 | README: overview, setup, run, configuration, troubleshooting | `README.md` | ✅ |
| S3 | Pinned dependencies, tool versions, OS and hardware, model sizes | `requirements*.txt`, `package-lock.json`, README technology table, `model-card.md` | ✅ |
| S4 | Architecture | `docs/architecture.md`, README diagram | ✅ |
| S5 | Dataset sources and licences | README "Team, licence and references" | ✅ (no external data) |
| S6 | How Gemma is used | README, `docs/model-card.md` | ✅ |
| S7 | Working demonstration, recording up to about 5 minutes | | ⬜ to record |
| S8 | Test results and known limitations | `docs/evaluation.md`, `docs/audit-ps2.md`, README | 🟡 real-model results for v0.6 pending |
| S9 | Instructions to reproduce the demo | README "Running it", `scripts/e2e_check.py` | ✅ |
| S10 | Main technical contribution | README | ✅ |
| PS-2 extra | Offline run log and connection monitoring; every network call explained; model acquisition; sample outputs with cited passages and a "document is silent" case; refusal and prompt-injection results | `docs/privacy.md`, `docs/model-card.md`, `evidence/` | 🟡 offline recording and fresh `e2e.json` pending |
