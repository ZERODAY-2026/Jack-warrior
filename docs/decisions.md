# Decision log and open questions

Newest first. Record anything a teammate (or a new session) would otherwise have to rediscover.

## 2026-10-18 (backend)

- **Repository:** https://github.com/ZERODAY-2026/Jack-warrior (team repo). Sanjay commits and pushes (as GitHub user thokasanjayteja014-star); Claude sessions must not push to it. Single branch: everything goes on `main` (no feature branches, Sanjay's decision). Initial import: commit `e3f38b2`.

- **Repository hosting:** no GitHub account is linked to the project yet, so both threads work in the shared project folder `/mnt/project-files/clausewise/` (`backend/` owned by the backend thread, `frontend/` by the frontend thread, `docs/` shared). Move to one GitHub repo with `feature/ai-backend` and `feature/frontend` branches as soon as it exists.
- **Licence:** Apache-2.0 proposed for the repository (`LICENSE`). Compatible with all backend dependencies (BSD/MIT/Apache). Gemma weights are not distributed and stay under the Gemma Terms of Use.
- **Model:** Gemma 3n E2B (`gemma3n:e2b`) via Ollama, Q4_K_M. Not yet run; see `model-card.md`.
- **API contract:** frontend's v0.1 accepted and extended additively to v0.2.
- **PDF parser:** pypdf (BSD) over PyMuPDF (AGPL).
- **Retrieval:** BM25 with synonym expansion, no embeddings, until evaluation shows misses.
- **Citations:** an unmatched model quote is dropped, never shown as "unverified".
- **Storage:** memory only; uploads never touch disk.
- **Dataset:** none bundled. Tests use synthetic documents written for this project (`backend/tests/fixtures/`). CUAD (CC BY 4.0) may be used for an evaluation subset later; it would be downloaded by a script, not committed.

## Open questions (need a human)

1. Confirm the laptop specs and OS (Windows native or WSL2?). Run `python scripts/env_report.py` there.
2. Document scope for testing and the demo: rental and employment agreements in English are the proposal.
3. Confirm Apache-2.0.

## 2026-10-18, later (backend v0.6)

- **No risk levels** (Sanjay's decision): `priority` and `priority_reason` removed from findings, prompts, schemas, UI and docs. No other severity ranking replaces them; findings are in document order. The guide asks to "highlight potential risks or ambiguities", which concern findings still do; it does not ask for a rating.
- **Gemma makes the analysis decisions** (Sanjay's decision): keyword type detection, per-type topic checklists, fixed wording rules and the computed risk score were removed. Gemma now picks the type, finds concerns, merges duplicates, and proposes and checks missing points. Kept as fixed code: quote verification, figure checks, legal-conclusion screening, escalation of validity and advice questions, the instruction-like-text warning, and keyword ranking of chunks when a long document exceeds the analysis budget.
- **Duplicates fixed at the source and by a Gemma merge call**, not by a similarity threshold. Only exact repeats (same title, same passages) are removed by code.
- **Earlier request (11:09) for type-specific analysis** is now met by passing Gemma's type label into the prompts, without per-type rules.
