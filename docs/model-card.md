# Model card: Gemma in ClauseWise

## Requirement (guide p. 7)

"Preferably a Gemma 3n-class edge model (E2B/E4B); Gemma 4 E2B/E4B edge models are the same class and are accepted … The model must do a meaningful part of the document understanding. Size, quantization, runtime and hardware are your choice if privacy rules hold. Verify the features of your exact variant and runtime, and report memory and speed."

## Selected model

| Item | Value | Status |
|---|---|---|
| Model | Gemma 3n **E2B**, instruction-tuned | chosen |
| Runtime | Ollama, tag `gemma3n:e2b` | chosen; alternative: llama.cpp `llama-server` with a Gemma 3n E2B GGUF |
| Quantization | `Q4_K_M` (Ollama's default for this tag) | confirmed by Ollama's `/api/tags` on the laptop |
| Download size | 7.8 GB in two layers (5.7 GB + 2.1 GB), measured by `ollama pull gemma3n:e2b` on the team laptop, 2026-10-18 (Ollama 0.40.6, Windows) | measured |
| Licence | Gemma Terms of Use (https://ai.google.dev/gemma/terms) and the Gemma Prohibited Use Policy | read and accepted by the team before use |
| Input used | text only | Gemma 3n also accepts images and audio; ClauseWise does not use them |
| Context used | `num_ctx` 8192 (configurable); prompts are kept to about 4,000 characters of document text per call | |

**Why E2B rather than E4B.** The laptop has an RTX 3050 with 6 GB of VRAM (verified). E2B runs fully on the GPU using 2.4 GB at context 8192 (measured), which leaves room, so E4B may also fit; it has not been tried. We will try E4B only if E2B's findings are measurably worse.

**Gemma 4 E2B/E4B** is allowed by the guide but the guide itself says its details come from press coverage and must be confirmed on Google's model card. We have not verified it, so it is not the default. Switching is a configuration change (`CLAUSEWISE_MODEL=<tag>`), provided the tag runs in the chosen runtime.

## What has and has not been verified

| Check | Result |
|---|---|
| Backend talks to Ollama's `/api/tags` and `/api/chat` with a JSON schema in `format` | Verified against an Ollama-compatible test server (`tests/test_privacy.py`), not against real Ollama yet |
| Gemma 3n E2B weights downloaded and run | **Not yet.** The cloud container used for development blocks huggingface.co, kaggle.com, ollama.com and registry.ollama.ai, and has no GPU. Real inference must be run on the team's laptop. |
| Hardware of the target laptop (GPU, VRAM, driver, RAM, OS) | Verified 2026-10-18 with `scripts/env_report.py`: Windows 11 (10.0.26300, native), NVIDIA GeForce RTX 3050 6GB Laptop GPU (6144 MiB), driver 581.86, CUDA 13.0, Intel CPU with 12 logical cores, 15.7 GB RAM, Python 3.13.7, Ollama 0.40.6. Ollama reports `gemma3n:e2b` as 7.30 GB, 4.5B parameters, Q4_K_M. |
| First real inference | 2026-10-18 on the laptop above, `scripts/e2e_check.py` on `rental_agreement.txt` (1,309 chars, 9 chunks): analysis 24.8 s with 2 model calls, 6 findings, 0 quotes rejected, 0 passage mismatches; document questions 2.75 s and 3.03 s; warm-up call 523 ms (model was probably already loaded by an earlier `ollama run`). Escalation and silent-document questions answered without a model call (0.02 s). No outbound connection attempts. |
| Memory and speed | `ollama ps` during the run: 2.4 GB, **100% GPU**, context 8192, llama.cpp runner. `GET /api/metrics`: 5 calls, average 6,210 ms, 52.09 output tokens/s. A longer PDF is still to be timed. |
| Output quality (hand review) | Two real runs reviewed in `evaluation.md`. The pipeline changed afterwards (v0.6: one finding per issue, Gemma merge step, Gemma type detection and missing-point check, fixed wording rules removed), so the real model has **not yet been run on the current version**. |

Results will be added here only after they are measured. No numbers in this file are estimates presented as measurements.

## Acquisition (setup time, needs network)

1. Install Ollama from https://ollama.com/download (Windows, macOS, Linux). Check the version with `ollama --version`.
2. Read the Gemma Terms of Use.
3. `ollama pull gemma3n:e2b` (downloads the weights once; this is the only step that downloads the model).
4. `ollama show gemma3n:e2b` to record the exact quantization, parameter count, context length and licence text; copy the output into the table above.
5. Optional, for llama.cpp: download a Gemma 3n E2B instruction-tuned GGUF from a source whose licence terms you have accepted (the official Google repositories on Hugging Face are gated behind the Gemma licence), then run `llama-server -m <file>.gguf --host 127.0.0.1 --port 8080 -c 8192 -ngl 99` and set `CLAUSEWISE_RUNTIME=llamacpp`.

Model weights are never committed to the repository (`.gitignore` excludes `*.gguf`, `*.safetensors`, `models/`, `.ollama/`).

## How Gemma is used (S6)

Gemma does the document understanding; the backend constrains and checks it:

| Task | Gemma's role | Deterministic checks around it |
|---|---|---|
| Document type | Reads the start of the document and picks a type from the list, with confidence and alternatives (skipped when the user chose the type) | Unknown answers fall back to "Other legal document" with a warning |
| Clause analysis | Reads each window of clauses and writes one finding per distinct issue: category, plain-language explanation, why it matters, explicit/interpretation/concern, a suggested action only when useful, missing context, and 1-3 exact quotes | Every quote must be found in the source; passage text copied from source; figures checked; legal conclusions removed; enums coerced |
| Merging duplicates | Groups findings from all windows that describe the same issue and writes the combined title and explanation | Invalid groups ignored; merged text with figures not in the passages replaced by the original; passages of every member kept; security-check findings never rewritten |
| Summary, glossary, missing points | Writes a plain summary, explains legal terms used in the document, and proposes important points this document gives reason to expect but may not address | Figures absent from the document removed; glossary terms must occur in the document |
| Checking missing points | Decides, for each proposed point, whether the passages most related to it (retrieved by BM25) address it | Only points it finds unaddressed are reported, with no passage and labelled not established |
| Questions | Answers from retrieved passages, classifies the answer type (including "needs a professional") and cites quotes | Answer withheld when no quote verifies; legal-judgment and advice questions escalated regardless of the model |

The only finding the code creates without the model is the security warning for text addressed to an AI system (`docs/security.md`). There are no keyword rules, per-type checklists or fixed recommendations in the analysis.

## Known limitations

- Small edge models can miss clauses, mis-categorise, or paraphrase loosely. Validation removes unsupported quotes and wrong figures but cannot prove an explanation is a faithful reading; users are shown the passage beside every explanation for that reason.
- Only the first 24,000 characters' worth of the most clause-like chunks are analysed in detail on long documents (configurable).
- English only has been considered; other languages are untested.
- No OCR: scanned PDFs are rejected with `no_extractable_text`.
