"""End-to-end check against a running ClauseWise backend.

Uploads one or more documents, asks questions, verifies that every cited
passage is an exact slice of the extracted text, deletes the documents and
writes a JSON report (timings, counts, answer types, model metrics).

    python scripts/e2e_check.py backend/tests/fixtures/rental_agreement.txt --out evidence/e2e.json
    python scripts/e2e_check.py --all          # every sample document, with its own questions

Questions for each sample come from backend/tests/fixtures/questions.json; the
report puts each answer next to the expected outcome so a person can check it.

The report contains excerpts of the documents you pass in, so use sample or
synthetic documents, not private ones, if you intend to share it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

FIXTURES = Path(__file__).resolve().parent.parent / "backend" / "tests" / "fixtures"
SAMPLES = ["rental_agreement.txt", "employment_contract.txt", "legal_notice.txt", "service_agreement.txt", "nda.txt", "marital_settlement.txt",
           "penalty_and_termination.txt", "injection_notice.txt"]
CONTENT_TYPES = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}

DEFAULT_QUESTIONS = [
    "What is the notice period for ending this agreement?",
    "What happens if a payment is late?",
    "Is this agreement legally enforceable?",
    "Does the agreement say anything about pets?",
    "Should I sign this?",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true", help="run every sample document in backend/tests/fixtures")
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--question", action="append", help="question to ask (repeatable); defaults to a built-in set")
    ap.add_argument("--out", type=Path, default=Path("evidence/e2e.json"))
    ap.add_argument("--timeout", type=float, default=1800)
    args = ap.parse_args()
    files = list(args.files) + ([FIXTURES / n for n in SAMPLES] if args.all else [])
    if not files:
        ap.error("give one or more files, or --all")
    try:
        sample_questions = json.loads((FIXTURES / "questions.json").read_text(encoding="utf-8"))
    except OSError:
        sample_questions = {}

    client = httpx.Client(base_url=args.url, timeout=args.timeout, trust_env=False)
    health = client.get("/api/health").json()
    print(f"model: {health['model']['name']} ({health['model']['runtime']}, {health['model'].get('quantization')}) state={health['model']['state']}")
    if health["model"]["state"] != "ready":
        print("model not ready:", health["model"].get("detail"))
        return 1

    report: dict = {"health": health, "documents": []}
    ok = True
    for path in files:
        if args.question:
            questions = [{"q": q, "expect": None} for q in args.question]
        else:
            questions = sample_questions.get(path.stem) or [{"q": q, "expect": None} for q in DEFAULT_QUESTIONS]
        ctype = CONTENT_TYPES.get(path.suffix.lower(), "text/plain")
        t0 = time.perf_counter()
        resp = client.post("/api/documents", files={"file": (path.name, path.read_bytes(), ctype)})
        elapsed = time.perf_counter() - t0
        if resp.status_code != 200:
            print(f"{path.name}: HTTP {resp.status_code} {resp.json().get('error')}")
            report["documents"].append({"file": path.name, "error": resp.json().get("error")})
            ok = False
            continue
        body = resp.json()
        doc_id = body["document_id"]
        text = "".join(p["text"] for p in client.get(f"/api/documents/{doc_id}/text").json()["pages"])
        mismatches = [
            f["id"] for f in body["findings"] for p in f["source_passages"] if text[p["char_start"] : p["char_end"]] != p["text"]
        ]
        ok &= not mismatches
        concerns = sum(1 for f in body["findings"] if f["classification"] == "concern")
        dt = body.get("document_type", {})
        print(f"{path.name}: type {dt.get('id')} ({dt.get('confidence')}), {len(body['findings'])} findings ({concerns} concerns), "
              f"{body['processing']['model_calls']} model calls, {body['processing']['quotes_rejected']} quotes rejected, "
              f"{elapsed:.1f}s, passage mismatches: {len(mismatches)}")
        for f in body["findings"]:
            print(f"  - [{f['classification']}] {f['title']} ({len(f['source_passages'])} passage(s){', action' if f.get('next_step') else ''})")
        # Two findings citing overlapping text may be the same issue reported twice; a person should look at these.
        spans = [(f["id"], p["char_start"], p["char_end"]) for f in body["findings"] for p in f["source_passages"]]
        overlaps = sorted({(a, b) for a, s1, e1 in spans for b, s2, e2 in spans if a < b and s1 < e2 and s2 < e1})
        if overlaps:
            print("  findings citing overlapping text (check for repeats):", ", ".join(f"{a}/{b}" for a, b in overlaps))
        if body.get("not_found"):
            print("  not addressed:", "; ".join(n["topic"] for n in body["not_found"]))
        answers = []
        for item in questions:
            q = item["q"]
            t1 = time.perf_counter()
            a = client.post(f"/api/documents/{doc_id}/ask", json={"question": q}).json()
            a["_expected"] = item.get("expect")
            a["_seconds"] = round(time.perf_counter() - t1, 2)
            bad = [p for p in a.get("source_passages", []) if text[p["char_start"] : p["char_end"]] != p["text"]]
            ok &= not bad
            print(f"  Q: {q}\n     -> {a.get('answer_type')} ({a['_seconds']}s, {len(a.get('source_passages', []))} passages)"
                  + (f"   expected: {item['expect']}" if item.get("expect") else ""))
            answers.append(a)
        deleted = client.delete(f"/api/documents/{doc_id}").json()
        report["documents"].append({
            "file": path.name, "analysis_seconds": round(elapsed, 2), "analysis": body, "answers": answers,
            "passage_mismatches": mismatches, "overlapping_findings": overlaps, "deleted": deleted,
        })
    report["metrics"] = client.get("/api/metrics").json()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(f"report written to {args.out}; blocked outbound attempts: {report['metrics']['blocked_outbound_attempts']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
