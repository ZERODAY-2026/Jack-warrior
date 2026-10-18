"""Validated local configuration, read from environment variables.

Every setting has a safe default. The model runtime URL must point at this
machine (loopback); anything else is refused at startup so document content
can never be sent to a remote inference server by misconfiguration.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

PREFIX = "CLAUSEWISE_"


class ConfigError(ValueError):
    pass


def _env(name: str, default: str) -> str:
    return os.environ.get(PREFIX + name, default)


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw = _env(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{PREFIX}{name} must be an integer") from exc
    if value < minimum:
        raise ConfigError(f"{PREFIX}{name} must be >= {minimum}")
    return value


def _env_float(name: str, default: float) -> float:
    raw = _env(name, str(default))
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{PREFIX}{name} must be a number") from exc


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "1" if default else "0").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def is_loopback_host(host: str) -> bool:
    host = host.strip("[]").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def require_loopback_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ConfigError("Model runtime URL must be http://127.0.0.1:<port> or similar")
    if not is_loopback_host(parsed.hostname):
        raise ConfigError(
            "Model runtime URL must be on this machine (127.0.0.1 / localhost / ::1). "
            "Remote inference servers are not allowed because document text would leave the device."
        )
    return url.rstrip("/")


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    allow_non_loopback_bind: bool = False

    # Model runtime: "ollama" (default) or "llamacpp" (llama.cpp llama-server, OpenAI-compatible API)
    runtime: str = "ollama"
    runtime_url: str = "http://127.0.0.1:11434"
    model_name: str = "gemma3n:e2b"
    num_ctx: int = 8192
    temperature: float = 0.1
    max_output_tokens: int = 1024
    request_timeout_s: float = 600.0
    warmup: bool = True

    # Limits
    max_file_bytes: int = 10 * 1024 * 1024
    max_pages: int = 80
    max_chars: int = 400_000
    max_question_chars: int = 500
    # Budget for the per-window clause analysis (characters of document text sent to the model)
    analysis_char_budget: int = 24_000
    window_chars: int = 4_000
    max_findings_per_window: int = 6
    document_ttl_s: int = 3600
    max_documents: int = 20

    # Privacy controls
    egress_guard: bool = True
    cors_origins: tuple[str, ...] = field(
        default=("http://127.0.0.1:5173", "http://localhost:5173")
    )

    @staticmethod
    def from_env() -> "Settings":
        runtime = _env("RUNTIME", "ollama").strip().lower()
        if runtime not in {"ollama", "llamacpp"}:
            raise ConfigError(f"{PREFIX}RUNTIME must be 'ollama' or 'llamacpp'")
        default_url = "http://127.0.0.1:11434" if runtime == "ollama" else "http://127.0.0.1:8080"
        settings = Settings(
            host=_env("HOST", "127.0.0.1"),
            port=_env_int("PORT", 8000),
            allow_non_loopback_bind=_env_bool("ALLOW_NON_LOOPBACK_BIND", False),
            runtime=runtime,
            runtime_url=require_loopback_url(_env("RUNTIME_URL", default_url)),
            model_name=_env("MODEL", "gemma3n:e2b"),
            num_ctx=_env_int("NUM_CTX", 8192, 1024),
            temperature=_env_float("TEMPERATURE", 0.1),
            max_output_tokens=_env_int("MAX_OUTPUT_TOKENS", 1024, 64),
            request_timeout_s=_env_float("REQUEST_TIMEOUT_S", 600.0),
            warmup=_env_bool("WARMUP", True),
            max_file_bytes=_env_int("MAX_FILE_BYTES", 10 * 1024 * 1024),
            max_pages=_env_int("MAX_PAGES", 80),
            max_chars=_env_int("MAX_CHARS", 400_000),
            max_question_chars=_env_int("MAX_QUESTION_CHARS", 500),
            analysis_char_budget=_env_int("ANALYSIS_CHAR_BUDGET", 24_000, 1000),
            window_chars=_env_int("WINDOW_CHARS", 4_000, 500),
            max_findings_per_window=_env_int("MAX_FINDINGS_PER_WINDOW", 6),
            document_ttl_s=_env_int("DOCUMENT_TTL_S", 3600, 60),
            max_documents=_env_int("MAX_DOCUMENTS", 20),
            egress_guard=_env_bool("EGRESS_GUARD", True),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        require_loopback_url(self.runtime_url)
        if not is_loopback_host(self.host) and not self.allow_non_loopback_bind:
            raise ConfigError(
                f"Refusing to bind to {self.host}: the backend only listens on this machine by default. "
                f"Set {PREFIX}ALLOW_NON_LOOPBACK_BIND=1 only if you understand the privacy impact."
            )
