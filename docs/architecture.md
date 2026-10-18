# Architecture

ClauseWise is a local web app: a React frontend and a Python backend, both on the user's machine, with Gemma running in a local runtime (Ollama by default, or llama.cpp's `llama-server`). Nothing in normal operation talks to anything outside `127.0.0.1`.

```
 Browser (React, 127.0.0.1:5173 in dev, or served by the backend)
   │  same-origin /api requests only
   ▼
 FastAPI backend (127.0.0.1:8000)                      in-process egress guard:
   ├─ document_parser  PDF (pypdf) / TXT → pages + offsets   non-loopback DNS/connect → refused
   ├─ chunking         clause-sized spans of the canonical text
   ├─ retrieval        BM25 + legal synonym map (no embeddings)
   ├─ analysis         prompts, windows, structured findings, Q&A
   ├─ citations        quote → source span; numeric support check
   ├─ safety           question triage, output screening, injection detection
   ├─ store            in-memory only, TTL + delete
   └─ gemma_engine     HTTP to loopback only, trust_env=False
          │
          ▼
 Ollama (127.0.0.1:11434) running gemma3n:e2b   ← weights on local disk, pulled once at setup
```

## Data flow for one document

1. **Upload** (`POST /api/documents`). The multipart body is held in memory (the Starlette spool limit is raised above the upload limit so nothing is written to a temp file; tested in `test_privacy.py::test_upload_never_spools_to_disk`).
2. **Extract** (`document_parser.py`). Type is detected by content (`%PDF-` magic), not only the extension. PDF pages are extracted with pypdf; each page's text is stored with its `char_start` in the canonical text (the concatenation of page texts). Empty, corrupt, encrypted and text-less (scanned) PDFs get specific error codes. Pages without text are listed as unreadable and the extraction is marked `partial`.
3. **Chunk** (`chunking.py`). Paragraphs are merged to ~900 characters and long ones split at sentence boundaries (max 1,500). A chunk is only `(start, end)` into the canonical text, so its text is always an exact slice. The last detected heading becomes the chunk's `section`.
4. **Select** (`analysis.select_windows`). If the document fits the analysis budget (24,000 characters by default) every chunk is analysed; otherwise chunks are ranked by density of legal signal words and the top ones are analysed, with a warning. Selected chunks are grouped into windows of about 4,000 characters.
5. **Analyse with Gemma.** One call per window. The system prompt holds the rules; document text goes only in the user turn inside `<document_excerpt id=… page=… section=…>` tags, with `<`/`>` in the document replaced so the text cannot close the tag. Ollama's structured-output mode constrains the reply to a JSON schema: `chunk_id`, `category`, `title`, `explanation`, `classification`, exact `quote`, `priority`, `priority_reason`, `next_step`.
6. **Validate** (`citations.py`, `safety.py`). For each finding the quote is located in the source: exact match, then a whitespace/quote/case/hyphenation-normalised match, then a ≥ 0.90 fuzzy match restricted to the chunk the model named. The passage returned to the UI is always `text[start:end]` from the source. If the quote is not found it is discarded, the finding gets `evidence_status: none` and `classification: not_established`. Numbers in the explanation that do not occur in the cited passage cause the explanation to be withheld. Sentences stating legal conclusions ("is unenforceable", "you should not sign") are removed. Duplicate findings on overlapping passages are merged.
7. **Summarise.** One more call over the document's opening and the verified findings produces the summary, a document-type guess and a glossary. Summary sentences with figures absent from the document are removed; glossary terms must occur in the document and their passage is taken from source.
8. **Deterministic checks.** Topics such as termination, payment, penalties, renewal, dispute resolution, governing law and liability are searched with regexes; absent ones are reported as "Not found in the reviewed text". Prompt-injection-like text is detected with patterns and reported both as a warning and as a `concern` finding citing the passage.
9. **Store** the extracted text, chunks, index and analysis in memory under a random id (`d_` + 96 random bits). `DELETE` removes them; documents also expire after one hour, and at most 20 are kept.

## Questions

`POST /api/documents/{id}/ask`: the question is triaged (`safety.triage_question`) into document / legal-judgment / advice and checked for jurisdiction words. BM25 retrieves the top 4 chunks, ignoring generic words like "agreement" or "say". If no chunk shares a meaningful term, the answer is `not_in_document` without a model call. Otherwise Gemma answers from those chunks only, with quotes, which are validated as above. An `answered` reply without any verified quote is withheld and becomes `not_in_document`. Legal-judgment and advice questions always become `needs_professional` with an escalation message, plus whatever the document itself says.

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
