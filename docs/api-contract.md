# API contract (frontend ⇄ local backend)

**Status: v0.2, agreed by the backend (2026-10-18).** v0.2 only adds fields to v0.1 (marked *added in v0.2*); nothing was renamed or removed. The backend's Pydantic models in `backend/clausewise/schemas.py` are the executable version and are tested; `GET /api/openapi.json` serves the generated schema.
The backend owns this contract. Any field or path change should be made here first and announced to the other teammate. The frontend's TypeScript mirror lives in `frontend/src/types/api.ts`.

## Transport

- Backend: FastAPI bound to `127.0.0.1:8000` by default (never `0.0.0.0`).
- All routes are under the `/api` prefix.
- Development: the Vite dev server (`127.0.0.1:5173`) proxies `/api` to the backend, so the browser sees one origin and no CORS is needed. If the backend enables CORS, it should allow only `http://127.0.0.1:5173` and `http://localhost:5173`.
- Production/demo: the backend may serve `frontend/dist` as static files on the same origin.
- JSON field names use `snake_case`.
- No route ever accepts a remote URL, and nothing in a response points at a remote resource.

## Errors (all routes)

Non-2xx responses use one shape:

```json
{ "error": { "code": "file_too_large", "message": "The file is larger than the 10 MB limit.", "details": null } }
```

`message` is safe to show to the user and never contains document text, stack traces or local file paths.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `unsupported_type` | Not a PDF or TXT (checked by content, not only extension) |
| 400 | `empty_document` | File is empty or has no text at all |
| 400 | `encrypted_pdf` | PDF is password-protected |
| 400 | `corrupt_file` | File cannot be parsed |
| 400 | `no_extractable_text` | PDF has pages but no text layer (likely scanned; OCR not supported) |
| 400 | `invalid_question` | Question empty or longer than the limit |
| 400 | `invalid_request` | Malformed request, e.g. no `file` field (*added in v0.2*) |
| 404 | `document_not_found` | Unknown or already-deleted `document_id` |
| 413 | `file_too_large` | Over `limits.max_file_bytes` |
| 503 | `model_not_ready` | Model not installed, still loading, or failed to load |
| 500 | `analysis_failed` | Inference or validation failed; nothing partial to return |
| 504 | `timeout` | Inference exceeded the server limit |

## `GET /api/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "model": {
    "state": "ready",
    "name": "gemma3n:e2b",
    "runtime": "ollama",
    "quantization": "Q4_K_M",
    "parameter_size": "4.5B",
    "detail": null
  },
  "limits": {
    "max_file_bytes": 10485760,
    "max_pages": 80,
    "accepted_extensions": [".pdf", ".txt"],
    "max_question_chars": 500,
    "ocr_supported": false
  },
  "privacy": {
    "bind_host": "127.0.0.1",
    "telemetry_enabled": false,
    "outbound_network_required": false,
    "egress_guard_active": true,
    "blocked_outbound_attempts": 0,
    "storage": "memory_only"
  }
}
```

- `status`: `ok` | `degraded` (backend up but model not usable).
- `model.state`: `ready` | `loading` | `not_installed` | `error`. `detail` is a user-safe sentence when not `ready`.
- *Added in v0.2:* `limits.max_pages`, `model.parameter_size`, `privacy.egress_guard_active` (in-process guard that refuses non-loopback connections), `privacy.blocked_outbound_attempts` (count only), `privacy.storage` (`memory_only`: nothing is written to disk).
- `model.name`, `model.runtime` and `model.quantization` come from the runtime itself (`quantization` may be `null` with llama.cpp).
- `privacy` reports the backend's own configuration. It is not proof of network isolation; the UI says so.

## `POST /api/documents` — upload and analyse

Request: `multipart/form-data` with one field `file`.

Response `200`:

```json
{
  "document_id": "d_7f3a…",
  "document": {
    "filename": "rental_agreement.pdf",
    "file_type": "pdf",
    "size_bytes": 182340,
    "page_count": 6,
    "char_count": 21890,
    "extraction": { "status": "complete", "unreadable_pages": [] }
  },
  "summary": {
    "text": "Plain-language summary…",
    "document_type_guess": "residential rental agreement",
    "limitations": ["Summary covers extracted text only."]
  },
  "findings": [ /* Finding, see below */ ],
  "glossary": [
    { "term": "security deposit", "explanation": "Money paid up front that the landlord holds…", "source_passages": [ /* Passage */ ] }
  ],
  "not_found": [
    { "topic": "Security deposit refund timeline", "note": "Not found in the reviewed text." }
  ],
  "warnings": [ { "code": "long_document_truncated", "message": "Only the first 40 pages were analysed." } ],
  "processing": {
    "model": "gemma3n:e2b", "runtime": "ollama", "duration_ms": 48211,
    "model_calls": 4, "chunks_total": 22, "chunks_analysed": 22, "quotes_rejected": 1
  },
  "disclaimer": "Informational assistance only. Not legal advice."
}
```

- `extraction.status`: `complete` | `partial`. `unreadable_pages` lists 1-based pages with no text.
- `not_found`: topics the backend looked for and did not find. Wording must stay "not found in the reviewed text", never "the contract lacks".
- `warnings`: non-fatal issues. A response with warnings is a partial success. Codes the backend emits: `pages_truncated`, `text_truncated`, `unreadable_pages`, `long_document_partially_analysed`, `partial_analysis`, `instruction_like_text` (prompt-injection-like text found; treated as content and also reported as a `concern` finding).
- `glossary` (*added in v0.2*): legal terms that appear in the document, with a plain-language explanation. A term is kept only if it occurs in the document text, and its passage is copied from the source.
- `processing` (*added in v0.2*: `runtime`, `model_calls`, `chunks_total`, `chunks_analysed`, `quotes_rejected`). `quotes_rejected` counts model-proposed quotes that were not found in the document and were therefore discarded.

### Finding

```json
{
  "id": "f_03",
  "category": "termination",
  "title": "Termination with 30 days' notice",
  "explanation": "Either side can end the agreement by giving 30 days' written notice.",
  "classification": "explicit",
  "priority": "high",
  "priority_reason": "Affects how and when you can leave the agreement.",
  "evidence_status": "verified",
  "source_passages": [ /* Passage */ ],
  "limitations": [],
  "next_step": null
}
```

- `category`: `obligation` | `right` | `deadline` | `payment` | `penalty` | `termination` | `renewal` | `ambiguity` | `concern` | `other`.
- `classification`:
  - `explicit`: the document directly states it.
  - `interpretation`: a cautious plain-language reading of cited wording.
  - `concern`: a possible issue or ambiguity grounded in a passage, to review, not a legal conclusion.
  - `not_established`: the evidence does not establish it.
- `priority`: `high` | `medium` | `low`, always with a `priority_reason`. Not a legal risk rating.
- `evidence_status`:
  - `verified`: every passage was matched against the original extracted text.
  - `unverified`: a passage could not be matched; the UI shows it as unverified. **The v0.2 backend never sends this**: an unmatched quote is discarded and the finding gets `none`, so model-written text is never displayed as a quotation. The value stays in the enum for compatibility.
  - `none`: no supporting passage. The UI shows "No supporting passage found" and never fills it in. The backend also sets `classification: "not_established"`, `priority: "low"` and explains why in `limitations`.
- `next_step`: optional safe suggestion, e.g. "Ask the landlord to clarify" or "Consult a qualified lawyer".

### Passage

```json
{
  "text": "Either party may terminate this agreement by providing thirty (30) days' written notice…",
  "page": 4,
  "section": "Clause 12",
  "char_start": 10412,
  "char_end": 10498,
  "verified": true
}
```

- `text` is copied from the original extraction, never generated.
- `page` is 1-based, `null` for TXT. `section` is the most recent heading the chunker detected before the passage (e.g. `6. TERMINATION`, `Clause 12`), or `null`. Heading detection is heuristic.
- `char_start`/`char_end` are always integers from the backend.
- `char_start`/`char_end` are offsets into the full extracted text (same coordinate system as `/text`).

## `GET /api/documents/{document_id}/text`

Extracted text for the in-app source viewer, so a passage can be shown in context.

```json
{
  "document_id": "d_7f3a…",
  "pages": [ { "page": 1, "char_start": 0, "text": "…" } ]
}
```

TXT documents return one entry with `page: null`. Passage offsets index into the concatenation of `pages[].text` in order.

## `POST /api/documents/{document_id}/ask`

Request:

```json
{ "question": "What is the notice period?" }
```

Response `200`:

```json
{
  "question": "What is the notice period?",
  "answer": "The agreement states 30 days' written notice for either party.",
  "answer_type": "answered",
  "classification": "explicit",
  "source_passages": [ /* Passage */ ],
  "limitations": [],
  "escalation": null,
  "jurisdiction_note": null
}
```

- `answer_type`:
  - `answered`: supported by cited passages.
  - `not_in_document`: the document is silent. `answer` says so; no invented content.
  - `ambiguous`: wording is unclear or conflicting; passages show why.
  - `needs_professional`: needs legal judgment (e.g. "is this enforceable?"). `escalation` explains, with any relevant passages.
  - `out_of_scope`: unrelated to the document or refused.
- `escalation`: user-safe sentence recommending a qualified professional, or `null`.
- `jurisdiction_note`: set when the answer depends on governing law.
- Backend rules: questions about validity, enforceability or legality, and "should I…" questions, always come back as `needs_professional` with `escalation`, plus any passages the document has on the topic. If the model claims `answered` but none of its quotes can be found in the document, the answer is withheld and the response becomes `not_in_document`. If retrieval finds no chunk that shares a meaningful word with the question, the backend answers `not_in_document` without calling the model.

## `DELETE /api/documents/{document_id}`

Response `200`:

```json
{ "deleted": true, "removed": ["uploaded_file", "extracted_text", "chunks", "analysis", "qa_history"] }
```

The frontend tells the user the backend data was removed only after this returns `deleted: true`.

## `GET /api/metrics` (*added in v0.2*, optional)

Timing and token counts only, never content: `{"model": {"calls", "failures", "avg_ms", "last_ms", "last_tokens_per_s", "prompt_tokens", "output_tokens", "cold_start_ms"}, "documents_loaded", "blocked_outbound_attempts": {"host": count}}`.

## Resolved questions (v0.2)

1. **Synchronous `POST /api/documents`** for v1. Analysis makes `ceil(analysed_chars / 4000) + 1` model calls (default budget: 24,000 characters, so at most 7 calls). On CPU or a 6 GB laptop GPU this can take minutes, so the frontend must not set a short fetch timeout and the Vite proxy timeout should be at least 15 minutes (`proxyTimeout`/`timeout: 900000`). If measured times on the target laptop are too long we will add `202` + `GET /api/documents/{id}/status`; that would be a v0.3 change announced here first.
2. **Limits:** 10 MB file, first 80 pages read, 400,000 characters read. Longer documents are read up to the limit with a `pages_truncated`/`text_truncated` warning. Only 24,000 characters are analysed in detail (chunks ranked by legal keywords); questions search the whole extracted text.
3. **Section:** best-effort heading detection, see Passage.
4. **One request at a time:** the backend serialises model calls; a second request waits for the first.
