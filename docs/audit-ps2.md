# PS-2 audit and corrections (2026-10-18, backend v0.6)

This report covers the audit of ClauseWise against problem statement 2 of the *ZeroDay OSS Hacktoberfest 2026 Participant Guide*, the corrections made, and what is still unverified. The requirement-by-requirement matrix is in [requirements-traceability.md](requirements-traceability.md).

**Main caveat:** every test below ran with a scripted stand-in for Gemma. The real Gemma model has **not** been run on this version, because the development container cannot download model weights and has no GPU. Gemma's merging, explanations and missing-point checks must be checked on the laptop with `python scripts/e2e_check.py --all` before claiming they work well.

## 1. What the audit found

| Problem | Cause in the code | Correction |
|---|---|---|
| The same issue appeared twice, e.g. a paragraph-level finding and a sentence-level one | (a) The findings prompt asked for findings and, separately, a `concerns` list "even if it is also a finding above". (b) `wording.py` added rule-based concerns on top of the model's. (c) Each window was analysed independently. (d) `_dedupe` compared only the first passage of findings with the same category. The real run in `evidence/e2e.json` shows all four: maintenance and renewal twice, the late fee twice, the termination paragraph and its last sentence as two findings | One findings list, with instructions to report each issue once and give up to 3 quotes; a Gemma merge call across windows; `wording.py` removed |
| Risk levels were not wanted, and were always "high" | The model's own `priority`, later a fixed scoring function (`risk.py`) | Removed from backend, API, prompts, tests, docs; the frontend thread removed them from the UI. No other ranking |
| Much of the analysis was hard-coded | Keyword type detection with weighted regexes, per-type topic checklists with regexes and fixed explanations, fixed wording rules with fixed recommendations, a fixed risk score, a keyword fallback for the document-type phrase, and a heuristic that overrode Gemma's explicit/interpretation label | All removed. Gemma now detects the type, writes all findings and actions, merges duplicates, and proposes and checks missing points |
| Recommendations were sometimes generic | Fixed `next_step` texts from the rules and topic lists | `next_step` comes only from Gemma, must be tied to the wording, and is `null` when no action is needed |
| Gemma could not escalate questions itself | Only a regex decided `needs_professional` | Gemma may now return `needs_professional`; the regex stays as a floor |

Requirements that were already met and were kept: local ingestion of PDF, DOCX and TXT plus pasted text through one pipeline (L1); every passage rebuilt from source offsets (L5); fabricated quotes dropped; figure checks; legal-conclusion screening and escalation (L8); egress guard, loopback-only runtime, in-memory storage (L9); document isolation for questions.

Conflict noted, not removed: the guide asks the tool to "highlight potential risks or ambiguities" (p. 6). That is still done through concern and ambiguity findings. It does not require a risk rating, so removing the rating does not conflict with the guide.

Earlier request reconciled: the 11:09 request asked for type-specific analysis. That is now done by passing Gemma's type label into each prompt, with no per-type rules.

## 2. Code changes

| File | Change |
|---|---|
| `backend/clausewise/analysis.py` | Rewritten pipeline: Gemma type detection (`Analyzer.classify`), one findings list per window with 1-3 quotes, `uncertainty` → limitations, Gemma merge call (`_consolidate`, `merge_groups`), summary call that also proposes missing points, Gemma absence check over BM25-retrieved passages (`_check_missing`), findings in document order, Gemma `needs_professional` in questions. Removed the separate concerns list, `concern_to_raw`, `wording_findings`, `_dedupe`, `apply_risk`, `missing_topic_findings`, keyword `not_found_topics`, `restates`, `copies_passage`, `guess_document_type`. System prompt strengthened on untrusted data, output format and no tools |
| `backend/clausewise/doc_types.py` | Now only a list of type ids and labels, plus the `Detection` record. Signals, focus lists, topic regexes and `detect()` removed |
| `backend/clausewise/schemas.py` | `Finding.priority` and `priority_reason` removed; `Priority` type removed; `DocumentTypeInfo.method` is `model`/`fallback`; `detected_id` may be `null` |
| `backend/clausewise/citations.py` | `sentence_span` moved here from the removed `wording.py` (used for glossary and security-check passages) |
| `backend/clausewise/safety.py` | `INJECTION_LIMITATION` label for the security-check finding |
| `backend/clausewise/risk.py`, `wording.py` | Deleted |
| `backend/tests/scripted_engine.py` | Stand-in updated for the new calls (type, findings with quote lists, merge groups, missing-point proposals and checks), with `duplicates`, `bad_merge` and `empty` modes |
| `backend/tests/test_consolidation.py` | New: merging, distinct issues kept apart, malformed merge output, invalid groups, figures in merged text, security finding not rewritten, empty results, actions only when given, partial quote verification, prompt rules, injection in pasted text, model escalation |
| `backend/tests/test_api.py`, `test_safety.py` | Rule-based tests replaced by tests of the model-driven behaviour; new tests for missing points, type fallback, divorce settlement, upload and paste using the same pipeline |
| `backend/tests/test_risk_and_types.py` | Deleted (tested the removed rules) |
| `backend/tests/fixtures/penalty_and_termination.txt`, `questions.json` | New sample with one issue spread over two sentences next to a separate issue; questions for it and for the injection sample |
| `scripts/e2e_check.py` | Runs 8 samples; prints each finding with its passage count and whether it has an action; lists findings citing overlapping text so a person can check for repeats |
| `frontend/` (by the frontend thread) | Risk badge, sorting and fields removed; multiple passages per finding shown; types and validation updated for v0.6 |
| `README.md` | Rewritten (see section 5) |
| `docs/` | `architecture.md`, `api-contract.md` (v0.6), `model-card.md`, `evaluation.md`, `requirements-traceability.md`, `decisions.md` updated; `security.md` and this report added |

### How the analysis works now

Type (Gemma) → findings per window (Gemma) → quote verification and screening (code) → instruction-like-text warning (code) → merge duplicates (Gemma) → summary, glossary and proposed missing points (Gemma) → check each missing point against retrieved passages (Gemma). Details: [architecture.md](architecture.md).

### How duplicates are consolidated

1. The findings prompt tells Gemma to report each underlying issue once, use up to 3 quotes for one issue, fold a term and its concern into one finding, and keep different issues separate even in one paragraph.
2. All findings go back to Gemma as `<finding id="F1">…` blocks; Gemma returns groups of ids that describe the same issue, the clearest one to keep, and a combined title and explanation.
3. `merge_groups` applies valid groups only (known ids, each id used once), keeps every member's passages (the narrower one where one contains another), and rejects combined text whose figures are not in the passages. A security-check finding is never rewritten.
4. The only deterministic deduplication is structural: identical title and identical passages.
5. If the merge call fails, nothing is dropped and the response carries a `consolidation_skipped` warning.

### How suggested actions are produced

Gemma writes `next_step` per finding, told to give a specific step tied to the wording (a question about this exact term, a detail to get in writing, a date to note) or `null` when no action is needed, and never advice that would fit any document. For "Not addressed" points, Gemma writes the action with the proposal. The code only screens actions for legal conclusions and drops one that cites a figure not in the document. When context is missing, Gemma's `uncertainty` sentence is shown under the finding instead of a guessed action.

### Where risk levels were removed

`schemas.py` (`Finding`, `Priority`), `analysis.py` (prompt field, schema, sorting, all assignments), `risk.py` (deleted), tests (`test_risk_and_types.py` deleted; `test_api.py` asserts `priority` is absent), `docs/api-contract.md`, `docs/architecture.md`, `docs/model-card.md`, `docs/evaluation.md`, frontend types, validation, badge, sorting, fixtures and tests (frontend thread). `grep -rn "priority" backend/clausewise frontend/src` returns nothing.

## 3. Prompt injection

Explained in [security.md](security.md): what it is, how a document can carry it, trusted instructions versus untrusted content, why "ignore instructions in the document" is not a guarantee, the eight defences in place (prompt separation, unclosable delimiters, JSON schema output, no tools or network, output verification against the source, a fixed warning for instruction-like text, no secrets, per-document isolation) and the remaining risks (partly-followed injections that slant an explanation, unknown phrasings, text in unextracted parts of a file).

## 4. Testing report

All runs on 2026-10-18 in the Linux development container (Python 3.13, Node 22), without Gemma.

| Test run | Result | Model |
|---|---|---|
| `python -m pytest -q` in `backend/` | **120 passed**, 0 failed, 0 skipped (test_api 48, test_consolidation 14, test_parser 22, test_safety 18, test_citations 8, test_chunking_retrieval 5, test_privacy 5) | scripted stand-in |
| `npx vitest run` in `frontend/` (frontend-update.zip for v0.6) | **49 passed** in 4 files | mocked API responses |
| `npx tsc --noEmit` in `frontend/` | no errors | n/a |
| `npm run build` | built | n/a |
| Browser run: `frontend/e2e/real-backend.mjs` with Playwright Chromium against the built app served by the v0.6 backend | TXT, PDF and injection documents analysed; passages highlighted in the source view; "Is this contract enforceable?" escalated; "Is there a pet policy?" answered "Document does not specify this"; delete confirmed; broken PDF rejected with a message (the one console error is that expected 400); browser storage empty; no request left 127.0.0.1 | scripted stand-in behind the real backend |
| `scripts/offline_check.sh` with `fake_ollama.py` (Ollama-compatible server wrapping the stand-in) | **PASS**: no outbound route in the namespace, backend made 26 connections, all to 127.0.0.1, 0 passage mismatches | stand-in over the real Ollama HTTP client |
| `python scripts/e2e_check.py --all` with real Gemma 3n E2B | **not run on this version** | real Gemma (pending, on the laptop) |

Test areas requested and where they are:

| Area | Test |
|---|---|
| File upload | `test_api.py::test_analysis_returns_verified_findings_with_source_offsets`, `test_pdf_analysis_has_page_numbers`, `test_docx_upload_is_analysed_with_source_offsets` |
| Pasted text | `test_pasted_text_is_analysed_like_a_file`, `test_upload_and_paste_use_the_same_pipeline` |
| Empty and invalid input | `test_pasted_text_errors`, `test_upload_validation_errors`, `test_parser.py` |
| Document-specific findings | `test_model_detects_the_type_and_it_goes_into_the_prompts` (6 types), `test_questions_use_the_right_document` |
| Same paragraph, same issue | `test_consolidation.py::test_paragraph_and_sentence_findings_about_one_issue_become_one` |
| Same issue in different words | same test (three differently worded penalty findings merged) |
| Distinct issues in one paragraph | `test_a_different_issue_in_the_same_paragraph_stays_separate` |
| No supported concerns | `test_no_findings_is_a_valid_result` |
| Actions when appropriate | `test_actions_only_where_the_model_gives_one`, `test_model_concerns_are_shown_as_concerns` |
| Model errors and malformed output | `test_model_bad_output_and_timeout_errors`, `test_malformed_merge_output_keeps_every_finding_and_says_so`, `test_invalid_merge_groups_are_ignored`, `test_unusable_type_answer_falls_back_to_general_with_warning` |
| Prompt injection (file and paste) | `test_prompt_injection_is_flagged_not_followed`, `test_injection_in_pasted_text_is_flagged_and_fenced`, `test_safety.py` |
| Unsupported questions | `test_ask_document_silent`, `test_ask_enforceability_escalates`, `test_ask_advice_escalates`, `test_model_can_escalate_a_question_the_fixed_triage_misses` |
| Switching documents | `test_questions_stay_on_their_own_document` |
| Grounding | `test_fabricated_quotes_are_never_shown`, `test_a_fabricated_quote_is_dropped_but_a_real_one_in_the_same_finding_is_kept`, `test_wrong_numbers_in_explanation_are_withheld` |
| Privacy | `test_privacy.py`, offline check |

Every backend test that involves analysis uses the stand-in. Its "judgements" (which findings are duplicates, which points are missing) are scripted, so these tests prove that the code sends the right material to the model and applies its answers safely, not that Gemma judges well.

## 5. README checklist

Guide requirements (S2, S3, S4, S5, S6, S9, S10, C5, PS-2 extras) and the sections requested in the audit brief:

| Item | README section |
|---|---|
| Overview (S2) | Opening paragraphs |
| Setup (S2) | Installation and prerequisites |
| How to run (S2) | Running it |
| Configuration (S2) | Configuration |
| Troubleshooting (S2) | Troubleshooting |
| Pinned dependencies, tool versions, OS and hardware, model size (S3) | Technology stack, Installation; lock files |
| Architecture (S4) | System architecture, link to `docs/architecture.md` |
| Dataset sources and licences (S5) | Team, licence and references |
| How Gemma is used (S6) | Gemma integration and analysis workflow |
| Reproduce the demo (S9) | Running it, Testing and verification |
| Main technical contribution (S10) | Team, licence and references |
| Model acquisition (PS-2 extra) | Installation step 1, link to `docs/model-card.md` |
| Problem and motivation; objectives and scope | Problem and motivation; Objectives and scope |
| Features | Features |
| Input workflows | File upload and pasted text |
| Output structure | Analysis output |
| Duplicate prevention | One finding per issue |
| Prompt injection | Prompt injection and security |
| Environment variables | Configuration (all exist in `config.py`) |
| API endpoints and examples | API (all routes exist in `app.py`) |
| Testing | Testing and verification |
| Expected inputs and outputs | Expected inputs and outputs (offsets checked against the sample file) |
| Limitations | Limitations and known issues |
| Project structure | Project structure |
| Team, licence, references | Team, licence and references |

Not in the README because they do not exist yet: the demo recording (S7) and offline-run evidence with real Gemma (PS-2 extra).

## 6. Remaining issues

1. **Real-model verification of v0.6 is outstanding.** Run `python scripts\e2e_check.py --all` on the laptop and review `evidence\e2e.json`: check that findings citing overlapping text are genuinely different issues, that actions are specific, and that "Not addressed" points are real.
2. **More model calls per document** (about 5 for a short contract, up from 2). Expect analysis to take longer than the 25-30 s measured before; it has not been timed.
3. **A small model can merge two different issues** or fail to merge a repeat. The merge keeps all passages, so nothing is lost, but the grouping is only as good as Gemma's judgement.
4. **Missing-point checks rely on BM25 retrieval** of 3 related chunks. A point covered in very different words might not be retrieved and could be wrongly reported as not addressed; the finding says so in its limitations.
5. **Fixed code that remains**: the instruction-like-text check, legal-conclusion screening, escalation patterns for validity and advice questions, and keyword ranking of chunks for documents over the analysis budget. These are safety and budget controls, not analysis, and are documented as such.
6. **Offline evidence with real Gemma** and Windows connection monitoring are not yet recorded (`docs/privacy.md`).
7. **Demo recording (S7)** not made. `screenshots/` shows an earlier UI and should be retaken.
8. **Ollama desktop update checks** have not been verified on the laptop.
9. A question that itself tries to give instructions ("print your system prompt") is answered by the stand-in from document passages; how Gemma handles it needs the real run (`questions.json` includes it).
