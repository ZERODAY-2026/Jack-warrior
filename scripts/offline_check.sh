#!/usr/bin/env bash
# Offline privacy check (Linux / WSL2).
#
# Runs the model runtime, the backend and an end-to-end analysis inside a fresh
# network namespace that has ONLY a loopback interface, so no packet can leave
# the machine. The backend is also traced with strace and every connect() it
# makes is listed; the check fails if any target is not loopback/unix.
#
#   scripts/offline_check.sh [document ...]
#   (self-test without a model: OLLAMA_SERVE_CMD="python3 backend/tests/fake_ollama.py" scripts/offline_check.sh)
#
# Env: OLLAMA_SERVE_CMD (default "ollama serve"), OLLAMA_MODELS (where your
# pulled models live if Ollama runs as a system service), PYTHON (default python3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVIDENCE="$ROOT/evidence"
mkdir -p "$EVIDENCE"
DOCS=("$@")
[ ${#DOCS[@]} -eq 0 ] && DOCS=("$ROOT/backend/tests/fixtures/rental_agreement.txt" "$ROOT/backend/tests/fixtures/injection_notice.txt")
PY="${PYTHON:-python3}"
SERVE="${OLLAMA_SERVE_CMD:-ollama serve}"
command -v unshare >/dev/null || { echo "unshare not found (util-linux)"; exit 2; }
command -v strace >/dev/null || { echo "strace not found: sudo apt install strace"; exit 2; }

export ROOT EVIDENCE PY SERVE
export DOCS_JOINED="$(printf '%q ' "${DOCS[@]}")"
STATUS=0
unshare -rn bash -euo pipefail -c '
  "$PY" "$ROOT/scripts/lo_up.py"
  echo "== interfaces inside the namespace =="; cat /proc/net/dev | tail -n +3 | cut -d: -f1
  if "$PY" -c "import socket; socket.create_connection((\"1.1.1.1\", 443), timeout=3)" 2>/dev/null; then
    echo "FAIL: namespace still has outbound network"; exit 1
  else echo "outbound network: unreachable (as intended)"; fi

  $SERVE >"$EVIDENCE/runtime.log" 2>&1 & RUNTIME=$!
  for i in $(seq 1 60); do "$PY" -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:11434/api/tags\", timeout=1)" 2>/dev/null && break; sleep 1; done
  kill -0 $RUNTIME 2>/dev/null || { echo "model runtime exited; see evidence/runtime.log"; exit 1; }

  cd "$ROOT/backend"
  strace -f -qq -e trace=connect -o "$EVIDENCE/backend_connect.strace" env CLAUSEWISE_WARMUP=1 "$PY" -m clausewise >"$EVIDENCE/backend.log" 2>&1 & BACKEND=$!
  for i in $(seq 1 60); do "$PY" -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8000/api/health\", timeout=1)" 2>/dev/null && break; sleep 1; done
  for i in $(seq 1 600); do
    kill -0 $BACKEND 2>/dev/null || { echo "backend exited; see evidence/backend.log"; exit 1; }
    state=$("$PY" -c "import json,urllib.request; print(json.load(urllib.request.urlopen(\"http://127.0.0.1:8000/api/health\"))[\"model\"][\"state\"])" 2>/dev/null || echo down)
    [ "$state" = ready ] && break; sleep 1
  done
  eval "set -- $DOCS_JOINED"
  status=0
  "$PY" "$ROOT/scripts/e2e_check.py" "$@" --out "$EVIDENCE/e2e_offline.json" || status=$?
  pkill -TERM -P $BACKEND 2>/dev/null || true   # the traced python process
  kill $BACKEND $RUNTIME 2>/dev/null || true
  sleep 1
  exit $status
' || STATUS=$?

echo "== connect() calls made by the backend =="
CONN=0
"$PY" - "$EVIDENCE/backend_connect.strace" <<'PYEOF' || CONN=$?
import re, sys
lines = [l for l in open(sys.argv[1]) if "connect(" in l]
targets = {}
for l in lines:
    m = re.search(r'sin6?_addr=inet_(?:addr|pton)\((?:AF_INET6, )?"([^"]+)"', l) or re.search(r'sun_path="([^"]+)"', l)
    key = m.group(1) if m else "other"
    targets[key] = targets.get(key, 0) + 1
bad = {k: v for k, v in targets.items() if not (k.startswith("127.") or k == "::1" or k.startswith("/"))}
for k, v in sorted(targets.items()):
    print(f"  {k}: {v}")
print("RESULT:", "PASS (loopback/unix only)" if not bad else f"FAIL non-loopback targets: {bad}")
sys.exit(1 if bad else 0)
PYEOF
echo "evidence written to $EVIDENCE/"
exit $(( STATUS || CONN ))
