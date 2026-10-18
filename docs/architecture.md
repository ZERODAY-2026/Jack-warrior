# Architecture

ClauseWise is a local web app: a React frontend and a Python backend, both on the user's machine, with Gemma running in a local runtime (Ollama by default, or llama.cpp's `llama-server`). Nothing in normal operation talks to anything outside `127.0.0.1`.

```
 Browser (React, 127.0.0.1:5173 in dev, or served by the backend)
   │  same-origin /api requests only
   ▼
 FastAPI backend (127.0.0.1:8000)                      in-process egress guard:
   ├─ document_parser  PDF (pypdf) / DOCX / TXT / pasted text → pages + offsets   non-loopback DNS/connect → refused
   ├─ chunking         clause-sized spans of the canonical text
   ├─ retrieval        BM25 + legal synonym map (no embeddings)
   ├─ doc_types        list of type labels (the model picks one)
   ├─ analysis         prompts, windows, findings, merging, missing points, Q&A
   ├─ citations        quote → source span; numeric support check
   ├─ safety           question triage, output screening, injection detection
   ├─ store            in-memory only, TTL + delete
   └─ gemma_engine     HTTP to loopback only, trust_env=False
          │
          ▼
 Ollama (127.0.0.1:11434) running gemma3n:e2b   ← weights on local disk, pulled once at setup
```

## Data flow for one document

Uploaded files and pasted text take the same path from step 3 on: `POST /api/documents` (multipart file) and `POST /api/documents/text` (JSON text) both produce an `ExtractedDocument` and call the same `run_analysis` in `app.py`.

1. **Receive.** A file upload is held in memory (the Starlette spool limit is raised above the upload limit so nothing is written to a temp file; `test_privacy.py::test_upload_never_spools_to_disk`). Pasted text is checked for emptiness and the same size limit.
2. **Extract** (`document_parser.py`). The type is detected by content, not only the extension. PDF pages are read with pypdf, Word `.docx` with the standard library (paragraphs and table rows), TXT as UTF-8. Each page's text is stored with its `char_start` in the canonical text. Empty, corrupt, encrypted and text-less (scanned) files get specific error codes; pages without text are listed as unreadable and the extraction is marked `partial`.
3. **Chunk** (`chunking.py`). Paragraphs are merged to about 900 characters and long ones split at sentence boundaries (max 1,500). Chunks do not overlap; a chunk is only `(start, end)` into the canonical text. The last detected heading becomes the chunk's `section`.
4. **Document type (Gemma).** Unless the user picked a type, Gemma reads the first 3,000 characters and chooses one label from the list in `doc_types.py`, with a confidence and up to two alternatives. If its answer is unusable, the type falls back to "Other legal document" with a warning. The label is only context for the later prompts; there are no per-type rules or checklists.
5. **Select windows** (`analysis.select_windows`). If the document fits the analysis budget (24,000 characters by default) every chunk is analysed; otherwise the chunks with the densest legal wording are analysed first, with a warning, and the rest stay reachable through questions. Selected chunks are grouped into windows of about 4,000 characters.
6. **Findings (Gemma, one call per window).** The system prompt holds the rules; document text goes only in the user turn inside `<document_excerpt id=… page=… section=…>` tags, with `<`/`>` in the document replaced so the text cannot close the tag. Ollama's structured-output mode constrains the reply to a JSON schema. Gemma is told to report each underlying issue once: one finding for several sentences about the same issue, no separate paragraph-level and sentence-level findings, one finding when a clause both states a term and raises a concern, and separate findings for genuinely different issues. Each finding has a category, title, 1-3 exact quotes, a plain-language explanation, why it matters (`impact`), explicit/interpretation/concern, a suggested action (`next_step`, null when none is needed) and any missing context (`uncertainty`).
7. **Validate** (`citations.py`, `safety.py`). Each quote is located in the source: exact match, then a whitespace/quote/case/hyphenation-normalised match, then a fuzzy match of at least 0.90 restricted to the chunk the model named. The passage returned is always `text[start:end]` from the source. Unfound quotes are discarded; a finding with none left gets `evidence_status: none` and `classification: not_established`. Figures in the explanation that are not in the cited passage cause it to be withheld. Sentences stating legal conclusions ("is unenforceable", "you should not sign") are removed.
8. **Security check.** Text addressed to an AI system ("ignore previous instructions", "reveal your prompt", "send this document to …") is found with patterns (`safety.find_injection_spans`) and shown as a concern finding and a warning. This is the only finding the code creates by itself, and it is labelled as coming from a fixed check.
9. **Merge duplicates (Gemma).** All findings from all windows, including the security-check ones, go to Gemma in one call, as `<finding id="F1">` blocks. Gemma returns groups of findings that describe the same underlying issue, with the clearest one to keep and a combined title and explanation. `merge_groups` applies each valid group: the passages of all members are kept (where one passage contains another, the narrower one is kept), the first non-empty `impact` and `next_step` are kept, and a combined explanation with figures not found in the passages is replaced by the kept finding's own. Groups with unknown or reused ids are ignored, and a security-check finding is never rewritten. If the call fails, every finding is kept and a `consolidation_skipped` warning says so. The only deterministic deduplication is structural: the same title on the same passages.
10. **Summary, glossary and possibly missing points (Gemma).** One call over the document's opening and the verified findings produces the summary, a document-type phrase, a glossary and up to 4 points this document gives reason to expect but may not address. Summary sentences with figures absent from the document are removed; glossary terms must occur in the document and their passage is taken from source.
11. **Check missing points (Gemma).** For each proposed missing point, BM25 retrieves the 3 most related chunks from the whole document, and one Gemma call decides for each point whether those passages address it. Only points Gemma marks `not_addressed` are kept; they appear in `not_found` and as a "Not addressed: …" concern finding with no passage, with Gemma's reason and suggested action. A point Gemma says is addressed is dropped.
12. **Store** the extracted text, chunks, index and analysis in memory under a random id. `DELETE` removes them; documents also expire after one hour, and at most 20 are kept.

Findings are returned in document order, with "Not addressed" points last. There is no risk level or ranking.

Model calls per document: 1 (type) + 1 per window + 1 (merge, when there are 2 or more findings) + 1 (summary) + 1 (missing-point check, when any are proposed). A short contract is usually 5 calls.

## Questions

`POST /api/documents/{id}/ask`: the question is triaged (`safety.triage_question`) into document / legal-judgment / advice and checked for jurisdiction words. BM25 retrieves the top 4 chunks of that document only, ignoring generic words like "agreement" or "say". If no chunk shares a meaningful term, the answer is `not_in_document` without a model call. Otherwise Gemma answers from those chunks only, with quotes, which are validated as above. Gemma can itself mark a question `needs_professional` when answering would need a legal judgement or a decision, which catches phrasings the fixed triage misses. An `answered` reply without any verified quote is withheld and becomes `not_in_document`. Legal-judgment and advice questions always become `needs_professional` with an escalation message, plus whatever the document itself says. Each document has its own index and context, so a question never sees another document.

## Why these choices

| Decision | Reason |
|---|---|
| Ollama as default runtime | Runs Gemma 3n on Windows, macOS and Linux, uses the GPU when available and offloads the rest to CPU automatically, which matters on a 6 GB laptop GPU. Structured JSON output via a schema. Reached over loopback HTTP, so the backend stays a small Python app. |
| llama.cpp `llama-server` as alternative | Same loopback pattern, GGUF files, no daemon. Selected with `CLAUSEWISE_RUNTIME=llamacpp`. |
| pypdf, not PyMuPDF | pypdf is BSD-licensed and pure Python; PyMuPDF is AGPL, which would constrain the licence of the project. Trade-off: weaker layout handling on complex PDFs. |
| BM25, no vector store | A contract is a few dozen chunks. BM25 with a legal synonym map is deterministic, inspectable and needs no extra model or index on disk. Embeddings can be added later if evaluation shows misses. |
| No fine-tuning | The guide does not require it, and grounding is enforced by validation around the model rather than by trusting the model. |
| In-memory store | Nothing to encrypt or securely delete on disk; deletion is a dictionary removal. Trade-off: restarting the backend loses loaded documents. |
| Synchronous analysis | Simplest contract for v1. See `docs/api-contract.md` for the job-polling fallback if laptop timings are too slow. |

## Trust boundaries

- **Document text is untrusted.** It can contain instructions; it never goes into the system prompt and is fenced in the user turn. Outputs are validated after inference whatever the model did.
- **Model output is untrusted.** Quotes are re-derived from the source; enums are coerced; free text is length-capped and screened.
- **The runtime URL must be loopback** (`config.require_loopback_url`); the backend refuses to start with a remote inference URL or a non-loopback bind address unless explicitly overridden.


## What is decided by Gemma and what by code

| Decided by Gemma | Done by code |
|---|---|
| Document type | Text extraction, chunking, size and type limits |
| What the important points and concerns are, and how to explain them | Placing document text inside fenced excerpt tags |
| Why each point matters and whether an action is useful | Checking every quote against the source; rebuilding passages from offsets |
| Which findings describe the same issue, and the merged wording | Applying the merge groups; dropping exact repeats (same title, same passages) |
| Which important points the document seems to leave out, and whether related passages address them | Retrieving the passages for each check (BM25) |
| Answers to questions, and when a question needs a lawyer | Fixed safety boundaries: screening legal conclusions, escalating validity and advice questions, flagging instruction-like text |

The fixed checks are safety and validation layers. They can remove or label model output, and the injection check adds one labelled kind of finding, but they never decide what a clause means or whether it is a concern.
