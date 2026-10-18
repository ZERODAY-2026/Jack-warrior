"""A scripted stand-in for Gemma, for tests only.

It lets the pipeline (parsing, retrieval, citation validation, safety rules,
API) be tested deterministically without model weights. It is never used by
the application. It answers from the excerpts it receives and can be switched
into misbehaving modes (fabricated quotes, wrong numbers, legal conclusions,
broken JSON) to prove the backend's checks catch them.
"""

from __future__ import annotations

import re
from typing import Any

from clausewise.gemma_engine import EngineError, Metrics, ModelStatus

_EXCERPT = re.compile(r'<document_excerpt id="(c\d+)"[^>]*>\n(.*?)\n</document_excerpt>', re.S)
_SENT = re.compile(r"[^.\n]+[.]")


class ScriptedEngine:
    runtime = "scripted-test-engine"

    def __init__(self, mode: str = "good", state: str = "ready"):
        self.mode = mode
        self.state = state
        self.metrics = Metrics()
        self.calls: list[tuple[str, str]] = []

    def status(self) -> ModelStatus:
        return ModelStatus(self.state, "scripted", self.runtime, detail=None if self.state == "ready" else "not ready")

    def warmup(self) -> None:
        pass

    def generate_json(self, system: str, user: str, schema: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]:
        self.calls.append((system, user))
        if self.mode == "bad_json":
            raise EngineError("bad_output", "bad")
        if self.mode == "timeout":
            raise EngineError("timeout", "slow")
        excerpts = _EXCERPT.findall(user)
        if "findings" in schema["properties"]:
            return {"findings": self._findings(excerpts)}
        if "summary" in schema["properties"]:
            return self._summary(excerpts)
        return self._answer(user, excerpts)

    def _findings(self, excerpts: list[tuple[str, str]]) -> list[dict[str, Any]]:
        out = []
        for cid, text in excerpts:
            sentences = [s.strip() for s in _SENT.findall(text) if len(s.strip()) > 20]
            if not sentences:
                continue
            quote = sentences[0]
            category = "termination" if "terminat" in text.lower() else "payment" if "pay" in text.lower() else "obligation"
            explanation = "The document says this: " + quote
            if self.mode == "fabricate":
                quote = "The Tenant waives all rights to any refund whatsoever under any circumstances."
            if self.mode == "wrong_number":
                explanation = "You must give 90 days notice."
            if self.mode == "legal_conclusion":
                explanation = "This clause is unenforceable. You should not sign this agreement. It concerns notice."
            out.append({
                "chunk_id": cid, "category": category, "title": f"Clause in {cid}", "explanation": explanation,
                "classification": "explicit", "quote": quote, "priority": "high", "priority_reason": "Affects the reader.",
                "next_step": None,
            })
        return out

    def _summary(self, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        text = "This appears to be an agreement between the named parties."
        if self.mode == "wrong_number":
            text += " The rent is Rs. 99,999 per month."
        return {
            "summary": text,
            "document_type_guess": "agreement",
            "glossary": [
                {"term": "security deposit", "explanation": "Money held by the landlord.", "quote": "security deposit of Rs. 54,000"},
                {"term": "indemnity", "explanation": "Not in the document.", "quote": "indemnity clause"},
            ],
        }

    def _answer(self, user: str, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        question = user.split("Question:", 1)[1].split("\n", 1)[0].lower()
        words = [w for w in re.findall(r"[a-z]+", question) if len(w) > 3]
        for cid, text in excerpts:
            for s in _SENT.findall(text):
                if any(w[:5] in s.lower() for w in words):
                    quote = s.strip()
                    if self.mode == "fabricate":
                        quote = "Notice may be given orally at any time."
                    return {"answer_type": "answered", "answer": f"The document says: {s.strip()}", "classification": "explicit",
                            "quotes": [{"chunk_id": cid, "quote": quote}], "jurisdiction_dependent": False}
        return {"answer_type": "not_in_document", "answer": "Not addressed.", "classification": "not_established",
                "quotes": [], "jurisdiction_dependent": False}
