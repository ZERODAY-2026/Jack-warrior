"""Local Gemma inference through a runtime running on this machine.

Two runtimes are supported, both reached over loopback HTTP only:

* ``ollama``   - Ollama's native API (``/api/chat``), structured output via a JSON schema
* ``llamacpp`` - llama.cpp ``llama-server`` (OpenAI-compatible ``/v1/chat/completions``)

The HTTP client is created with ``trust_env=False`` so proxy environment
variables can never route document text through a proxy. The runtime URL is
validated as loopback in ``config``. Metrics recorded here are counts and
timings only.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from .config import Settings, require_loopback_url

log = logging.getLogger("clausewise.engine")


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # not_installed | unreachable | timeout | bad_output | error
        self.message = message


@dataclass
class ModelStatus:
    state: str  # ready | loading | not_installed | error
    name: str
    runtime: str
    quantization: str | None = None
    parameter_size: str | None = None
    detail: str | None = None


@dataclass
class Metrics:
    calls: int = 0
    failures: int = 0
    total_ms: float = 0.0
    last_ms: float | None = None
    last_tokens_per_s: float | None = None
    prompt_tokens: int = 0
    output_tokens: int = 0
    cold_start_ms: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def record(self, ms: float, prompt_tokens: int | None, output_tokens: int | None, tps: float | None) -> None:
        with self._lock:
            self.calls += 1
            self.total_ms += ms
            self.last_ms = ms
            self.prompt_tokens += prompt_tokens or 0
            self.output_tokens += output_tokens or 0
            self.last_tokens_per_s = tps

    def as_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "failures": self.failures,
            "avg_ms": round(self.total_ms / self.calls) if self.calls else None,
            "last_ms": round(self.last_ms) if self.last_ms is not None else None,
            "last_tokens_per_s": round(self.last_tokens_per_s, 2) if self.last_tokens_per_s else None,
            "prompt_tokens": self.prompt_tokens,
            "output_tokens": self.output_tokens,
            "cold_start_ms": round(self.cold_start_ms) if self.cold_start_ms is not None else None,
        }


class Engine(Protocol):
    metrics: Metrics

    def status(self) -> ModelStatus: ...

    def generate_json(self, system: str, user: str, schema: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]: ...

    def warmup(self) -> None: ...


def parse_json_object(raw: str) -> dict[str, Any]:
    """Parse the model's JSON, tolerating code fences or leading prose."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("\n") + 1 :] if "\n" in text else text
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise EngineError("bad_output", "The model did not return valid structured output.") from None
        try:
            value = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            raise EngineError("bad_output", "The model did not return valid structured output.") from None
    if not isinstance(value, dict):
        raise EngineError("bad_output", "The model did not return a JSON object.")
    return value


class _HttpEngine:
    runtime = "unknown"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = require_loopback_url(settings.runtime_url)
        self.metrics = Metrics()
        self._warm = False
        self._loading = False
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(settings.request_timeout_s, connect=5.0),
            trust_env=False,  # never use HTTP(S)_PROXY for inference traffic
        )

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = self._client.post(path, json=payload)
        except httpx.TimeoutException as exc:
            raise EngineError("timeout", "The local model took too long to respond.") from exc
        except httpx.HTTPError as exc:
            raise EngineError("unreachable", f"Cannot reach the local {self.runtime} runtime at {self.base_url}.") from exc
        if resp.status_code == 404:
            raise EngineError("not_installed", f"Model '{self.settings.model_name}' is not available in {self.runtime}.")
        if resp.status_code >= 400:
            raise EngineError("error", f"The local {self.runtime} runtime returned HTTP {resp.status_code}.")
        return resp.json()

    def warmup(self) -> None:
        """Load the model into memory with a content-free prompt and time it."""
        st = self.status()
        if st.state != "ready" or self._warm:
            return
        self._loading = True
        t0 = time.perf_counter()
        try:
            self.generate_json(
                "Reply with a JSON object.", 'Return {"ok": true}.',
                {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, max_tokens=16,
            )
            self.metrics.cold_start_ms = (time.perf_counter() - t0) * 1000
            self._warm = True
            log.info("model warm-up finished in %.0f ms", self.metrics.cold_start_ms)
        except EngineError as exc:
            log.warning("model warm-up failed: %s", exc.code)
        finally:
            self._loading = False


class OllamaEngine(_HttpEngine):
    runtime = "ollama"

    def status(self) -> ModelStatus:
        name = self.settings.model_name
        try:
            resp = self._client.get("/api/tags", timeout=5.0)
            resp.raise_for_status()
            models = resp.json().get("models", [])
        except (httpx.HTTPError, ValueError):
            return ModelStatus("error", name, self.runtime, detail=(
                f"Ollama is not running at {self.base_url}. Start it with 'ollama serve'."))
        wanted = {name, name if ":" in name else f"{name}:latest"}
        match = next((m for m in models if m.get("name") in wanted or m.get("model") in wanted), None)
        if not match:
            return ModelStatus("not_installed", name, self.runtime, detail=(
                f"Model '{name}' is not installed. Run 'ollama pull {name}' once during setup."))
        details = match.get("details") or {}
        state = "loading" if self._loading else "ready"
        return ModelStatus(state, name, self.runtime, details.get("quantization_level"), details.get("parameter_size"))

    def generate_json(self, system: str, user: str, schema: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]:
        payload = {
            "model": self.settings.model_name,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "format": schema,
            "keep_alive": "30m",
            "options": {
                "temperature": self.settings.temperature,
                "num_ctx": self.settings.num_ctx,
                "num_predict": max_tokens or self.settings.max_output_tokens,
            },
        }
        t0 = time.perf_counter()
        try:
            data = self._post("/api/chat", payload)
        except EngineError:
            self.metrics.failures += 1
            raise
        ms = (time.perf_counter() - t0) * 1000
        eval_count = data.get("eval_count")
        eval_ns = data.get("eval_duration")
        tps = (eval_count / (eval_ns / 1e9)) if eval_count and eval_ns else None
        self.metrics.record(ms, data.get("prompt_eval_count"), eval_count, tps)
        content = (data.get("message") or {}).get("content", "")
        return parse_json_object(content)


class LlamaCppEngine(_HttpEngine):
    runtime = "llama.cpp"

    def status(self) -> ModelStatus:
        name = self.settings.model_name
        try:
            resp = self._client.get("/health", timeout=5.0)
        except httpx.HTTPError:
            return ModelStatus("error", name, self.runtime, detail=(
                f"llama-server is not running at {self.base_url}."))
        if resp.status_code == 503:
            return ModelStatus("loading", name, self.runtime, detail="llama-server is loading the model.")
        if resp.status_code != 200:
            return ModelStatus("error", name, self.runtime, detail=f"llama-server health returned {resp.status_code}.")
        return ModelStatus("loading" if self._loading else "ready", name, self.runtime)

    def generate_json(self, system: str, user: str, schema: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]:
        payload = {
            "model": self.settings.model_name,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": self.settings.temperature,
            "max_tokens": max_tokens or self.settings.max_output_tokens,
            "response_format": {"type": "json_object", "schema": schema},
        }
        t0 = time.perf_counter()
        try:
            data = self._post("/v1/chat/completions", payload)
        except EngineError:
            self.metrics.failures += 1
            raise
        ms = (time.perf_counter() - t0) * 1000
        usage = data.get("usage") or {}
        timings = data.get("timings") or {}
        self.metrics.record(ms, usage.get("prompt_tokens"), usage.get("completion_tokens"), timings.get("predicted_per_second"))
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise EngineError("bad_output", "The model returned an unexpected response.") from exc
        return parse_json_object(content)


def create_engine(settings: Settings) -> Engine:
    if settings.runtime == "llamacpp":
        return LlamaCppEngine(settings)
    return OllamaEngine(settings)
