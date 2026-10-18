# Model card: Gemma in ClauseWise

## Requirement (guide p. 7)

"Preferably a Gemma 3n-class edge model (E2B/E4B); Gemma 4 E2B/E4B edge models are the same class and are accepted … The model must do a meaningful part of the document understanding. Size, quantization, runtime and hardware are your choice if privacy rules hold. Verify the features of your exact variant and runtime, and report memory and speed."

## Selected model

| Item | Value | Status |
|---|---|---|
| Model | Gemma 3n **E2B**, instruction-tuned | chosen |
| Runtime | Ollama, tag `gemma3n:e2b` | chosen; alternative: llama.cpp `llama-server` with a Gemma 3n E2B GGUF |
| Quantization | `Q4_K_M` (Ollama's default for this tag) | to confirm with `ollama show gemma3n:e2b` on the target machine |
| Download size | about 5.6 GB (Ollama library listing, as known in mid-2026) | to confirm with `ollama list` |
| Licence | Gemma Terms of Use (https://ai.google.dev/gemma/terms) and the Gemma Prohibited Use Policy | read and accepted by the team before use |
| Input used | text only | Gemma 3n also accepts images and audio; ClauseWise does not use them |
| Context used | `num_ctx` 8192 (configurable); prompts are kept to about 4,000 characters of document text per call | |

**Why E2B rather than E4B.** The developer laptop reportedly has an NVIDIA RTX 3050 Laptop GPU with about 6 GB of VRAM. E4B at Q4 is larger than 6 GB on its own (Ollama lists about 7.5 GB), so it would run mostly on CPU. E2B at Q4 is close to the VRAM size; Ollama places as many layers as fit on the GPU and runs the rest on CPU. We start with E2B and will try E4B only if E2B's findings are measurably worse and E4B's speed is acceptable.

**Gemma 4 E2B/E4B** is allowed by the guide but the guide itself says its details come from press coverage and must be confirmed on Google's model card. We have not verified it, so it is not the default. Switching is a configuration change (`CLAUSEWISE_MODEL=<tag>`), provided the tag runs in the chosen runtime.

## What has and has not been verified

| Check | Result |
|---|---|
| Backend talks to Ollama's `/api/tags` and `/api/chat` with a JSON schema in `format` | Verified against an Ollama-compatible test server (`tests/test_privacy.py`), not against real Ollama yet |
| Gemma 3n E2B weights downloaded and run | **Not yet.** The cloud container used for development blocks huggingface.co, kaggle.com, ollama.com and registry.ollama.ai, and has no GPU. Real inference must be run on the team's laptop. |
| Hardware of the target laptop (GPU, VRAM, driver, RAM, OS) | **Not yet verified.** Run `scripts/env_report.py` there and paste the output into this file. |
| Memory and speed | **Not yet measured.** `scripts/e2e_check.py` and `GET /api/metrics` record cold start, per-call latency and tokens/s. |

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
| Clause analysis | Reads each window of clauses and writes findings: category, plain-language explanation, explicit/interpretation/concern, priority, a suggested next step, and the exact quote it relied on | Quote must be found in the source; passage text copied from source; figures checked; legal conclusions removed; enums coerced |
| Summary and glossary | Writes a plain summary, document-type guess, and explains legal terms used in the document | Sentences with figures absent from the document removed; glossary terms must occur in the document |
| Questions | Answers from retrieved passages, classifies the answer type and cites quotes | Answer withheld when no quote verifies; legal-judgment/advice questions escalated regardless of the model |

## Known limitations

- Small edge models can miss clauses, mis-categorise, or paraphrase loosely. Validation removes unsupported quotes and wrong figures but cannot prove an explanation is a faithful reading; users are shown the passage beside every explanation for that reason.
- Only the first 24,000 characters' worth of the most clause-like chunks are analysed in detail on long documents (configurable).
- English only has been considered; other languages are untested.
- No OCR: scanned PDFs are rejected with `no_extractable_text`.
