import json
import logging
import socket
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest

from clausewise import privacy
from clausewise.app import create_app
from clausewise.config import ConfigError, Settings, require_loopback_url
from clausewise.gemma_engine import OllamaEngine
from fastapi.testclient import TestClient

from conftest import fixture_bytes, make_client, upload

RENTAL = fixture_bytes("rental_agreement.txt")
SENSITIVE = ["Vikram", "Asha Rao", "Lake View", "18,000", "54,000"]


def test_egress_guard_blocks_dns_and_remote_connect_but_allows_loopback():
    privacy.install_egress_guard()
    with pytest.raises(privacy.EgressBlocked):
        socket.getaddrinfo("example.com", 443)
    s = socket.socket()
    with pytest.raises(privacy.EgressBlocked):
        s.connect(("1.1.1.1", 443))
    s.close()
    with pytest.raises(httpx.ConnectError):
        httpx.get("https://example.com", trust_env=False, timeout=2)
    assert {"example.com", "1.1.1.1"} <= set(privacy.blocked_attempts())
    socket.getaddrinfo("127.0.0.1", 80)  # loopback allowed
    socket.getaddrinfo("localhost", 80)


def test_runtime_url_and_bind_host_must_be_loopback():
    with pytest.raises(ConfigError):
        require_loopback_url("http://api.example.com:11434")
    with pytest.raises(ConfigError):
        require_loopback_url("http://192.168.1.20:11434")
    assert require_loopback_url("http://127.0.0.1:11434/") == "http://127.0.0.1:11434"
    with pytest.raises(ConfigError):
        Settings(host="0.0.0.0").validate()


def test_logs_contain_no_document_content_or_questions(caplog):
    caplog.set_level(logging.DEBUG)
    client, _ = make_client()
    doc_id = upload(client, "Vikram_lease.txt", RENTAL).json()["document_id"]
    client.post(f"/api/documents/{doc_id}/ask", json={"question": "What does Vikram pay for Lake View?"})
    client.delete(f"/api/documents/{doc_id}")
    logged = "\n".join(r.getMessage() for r in caplog.records)
    for s in SENSITIVE:
        assert s not in logged


def test_upload_never_spools_to_disk(monkeypatch):
    created = []
    real = tempfile.TemporaryFile

    def spy(*a, **k):
        created.append(1)
        return real(*a, **k)

    monkeypatch.setattr(tempfile, "TemporaryFile", spy)
    client, _ = make_client()
    big = RENTAL + b"\n\n" + b"9. MISC\nThe parties agree to the schedule.\n" * 60000  # ~2.6 MB, above Starlette's 1 MB default spool
    resp = upload(client, "big.txt", big)
    assert resp.status_code == 200, resp.text
    assert created == []


class _FakeOllama(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def log_message(self, *args):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({"models": [{"name": "gemma3n:e2b", "details": {"quantization_level": "Q4_K_M", "parameter_size": "4.5B"}}]})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _FakeOllama.requests.append(payload)
        if "findings" in payload["format"]["properties"]:
            content = {"findings": []}
        elif "summary" in payload["format"]["properties"]:
            content = {"summary": "An agreement.", "document_type_guess": None, "glossary": []}
        else:
            content = {"ok": True}
        self._send({"message": {"content": json.dumps(content)}, "eval_count": 10, "eval_duration": 1_000_000_000, "prompt_eval_count": 50})


def test_ollama_engine_full_flow_over_loopback_with_guard_and_proxy_env(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _FakeOllama)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:9")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:9")
    monkeypatch.setenv("ALL_PROXY", "http://proxy.invalid:9")
    try:
        settings = Settings(runtime_url=f"http://127.0.0.1:{server.server_port}", warmup=False, egress_guard=True)
        engine = OllamaEngine(settings)
        client = TestClient(create_app(settings, engine))
        health = client.get("/api/health").json()
        assert health["model"]["state"] == "ready" and health["model"]["quantization"] == "Q4_K_M"
        assert health["privacy"]["egress_guard_active"] is True
        resp = upload(client, "rental.txt", RENTAL)
        assert resp.status_code == 200, resp.text
        assert _FakeOllama.requests and all(r["model"] == "gemma3n:e2b" and r["stream"] is False for r in _FakeOllama.requests)
        assert privacy.blocked_attempts() == {}
        assert engine.metrics.calls == len(_FakeOllama.requests)
    finally:
        server.shutdown()
