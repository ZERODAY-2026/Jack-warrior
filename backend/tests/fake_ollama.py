"""Ollama-compatible HTTP server backed by ScriptedEngine, for testing the
offline harness (scripts/offline_check.sh) where no Gemma weights exist.
Results from it say nothing about model quality.

    OLLAMA_SERVE_CMD="python tests/fake_ollama.py" scripts/offline_check.sh
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1]))

from scripted_engine import ScriptedEngine  # noqa: E402

ENGINE = ScriptedEngine()


class Handler(BaseHTTPRequestHandler):
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
        self._send({"models": [{"name": "gemma3n:e2b", "details": {"quantization_level": "FAKE", "parameter_size": "n/a"}}]})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        system, user = payload["messages"][0]["content"], payload["messages"][1]["content"]
        schema = payload["format"]
        if "ok" in schema.get("properties", {}):
            out = {"ok": True}
        else:
            out = ENGINE.generate_json(system, user, schema)
        self._send({"message": {"content": json.dumps(out)}, "eval_count": 1, "eval_duration": 1_000_000})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 11434), Handler).serve_forever()
