"""A scripted stand-in for Gemma, for tests only.

It lets the pipeline (parsing, retrieval, citation validation, merging, safety
rules, API) be tested deterministically without model weights. It is never used
by the application. Its "judgements" are simple scripts over the excerpts it
receives, so tests that use it check the code around the model, not the
model's understanding. It can be switched into misbehaving modes (fabricated
quotes, wrong numbers, legal conclusions, broken JSON) to prove the backend's
checks catch them.
"""

from __future__ import annotations

import re
from typing import Any

from clausewise.gemma_engine import EngineError, Metrics, ModelStatus

_EXCERPT = re.compile(r'<document_excerpt id="([\w]+)"[^>]*>\n(.*?)\n</document_excerpt>', re.S)
_FINDING = re.compile(r'<finding id="(F\d+)">\n(.*?)\n</finding>', re.S)
_SENT = re.compile(r"[^.\n]+[.]")
_TITLE_TYPES = [("rental", "rental"), ("lease", "rental"), ("employment", "employment"), ("notice", "legal_notice"),
                ("non-disclosure", "nda"), ("service", "service"), ("marital", "family"), ("divorce", "family")]


class ScriptedEngine:
    runtime = "scripted-test-engine"

    def __init__(self, mode: str = "good", state: str = "ready"):
        self.mode = mode
        self.state = state
        self.metrics = Metrics()
        self.calls: list[tuple[str, str]] = []
        self.type_answer: str | None = None  # force the type the stand-in reports
        self.missing: list[dict[str, Any]] = []  # extra "possibly missing" proposals

    def status(self) -> ModelStatus:
        return ModelStatus(self.state, "scripted", self.runtime, detail=None if self.state == "ready" else "not ready")

    def warmup(self) -> None:
        pass

    def generate_json(self, system: str, user: str, schema: dict[str, Any], max_tokens: int | None = None) -> dict[str, Any]:
        self.calls.append((system, user))
        props = schema["properties"]
        if self.mode == "bad_json" or (self.mode == "bad_merge" and "groups" in props):
            raise EngineError("bad_output", "bad")
        if self.mode == "timeout":
            raise EngineError("timeout", "slow")
        excerpts = _EXCERPT.findall(user)
        if "type_id" in props:
            return self._type(excerpts)
        if "findings" in props:
            return {"findings": self._findings(excerpts)}
        if "groups" in props:
            return {"groups": self._groups(_FINDING.findall(user))}
        if "summary" in props:
            return self._summary(excerpts)
        if "checks" in props:
            return self._checks(user, excerpts)
        return self._answer(user, excerpts)

    def _type(self, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        if self.type_answer:
            return {"type_id": self.type_answer, "confidence": "low", "alternatives": ["general"], "reason": "scripted"}
        first = excerpts[0][1].split("\n", 1)[0].lower() if excerpts else ""
        for word, tid in _TITLE_TYPES:
            if word in first:
                return {"type_id": tid, "confidence": "high", "alternatives": [], "reason": "scripted"}
        return {"type_id": "general", "confidence": "low", "alternatives": [], "reason": "scripted"}

    def _findings(self, excerpts: list[tuple[str, str]]) -> list[dict[str, Any]]:
        if self.mode == "empty":
            return []
        if self.mode in {"duplicates", "bad_merge"}:
            return self._duplicate_findings(excerpts)
        out = []
        for cid, text in excerpts:
            sentences = [s.strip() for s in _SENT.findall(text) if len(s.strip()) > 20]
            if not sentences:
                continue
            quote = sentences[0]
            category = "termination" if "terminat" in text.lower() else "payment" if "pay" in text.lower() else "obligation"
            explanation = "This clause sets out what the parties agreed here."
            if self.mode == "fabricate":
                quote = "The Tenant waives all rights to any refund whatsoever under any circumstances."
            if self.mode == "wrong_number":
                explanation = "You must give 90 days notice."
            if self.mode == "legal_conclusion":
                explanation = "This clause is unenforceable. You should not sign this agreement. It concerns notice."
            out.append({
                "category": category, "title": f"Clause in {cid}", "explanation": explanation,
                "impact": "You would owe Rs. 99,999." if self.mode == "wrong_number" else "This sets what you must do under this clause.",
                "classification": "explicit", "quotes": [{"chunk_id": cid, "quote": quote}], "next_step": None, "uncertainty": None,
            })
            for sentence in sentences:
                if "considers reasonable" in sentence:
                    q = "The Landlord may keep the whole deposit for any reason." if self.mode == "fabricate" else sentence
                    out.append({
                        "category": "ambiguity", "title": "Deposit deductions not defined",
                        "explanation": "The Landlord alone decides which deductions are reasonable, and no list or limit is given.",
                        "impact": "Part of the deposit could be kept without a clear basis.", "classification": "concern",
                        "quotes": [{"chunk_id": cid, "quote": q}],
                        "next_step": "Ask the Landlord to list which deductions can be made from the deposit.", "uncertainty": None,
                    })
        return out

    def _duplicate_findings(self, excerpts: list[tuple[str, str]]) -> list[dict[str, Any]]:
        """Mimics a model that reports one penalty issue three times and a separate termination issue."""
        out = []
        for cid, text in excerpts:
            sentences = [s.strip() for s in _SENT.findall(text)]
            pen = [s for s in sentences if "penalty" in s.lower()]
            if len(pen) >= 2:
                out.append({"category": "penalty", "title": "Penalty for any delay", "classification": "concern",
                            "explanation": "The employee pays a fixed penalty for any delay, whatever the reason.",
                            "impact": "A short delay would cost the full penalty.",
                            "quotes": [{"chunk_id": cid, "quote": pen[0] + " " + pen[1]}], "next_step": "Ask whether the penalty can be limited to delays the employee causes."})
                out.append({"category": "penalty", "title": "Penalty amount", "classification": "explicit",
                            "explanation": "A penalty is charged for a delay.", "quotes": [{"chunk_id": cid, "quote": pen[0]}]})
                out.append({"category": "penalty", "title": "Penalty applies regardless of reason", "classification": "concern",
                            "explanation": "No reason for the delay excuses the penalty.", "quotes": [{"chunk_id": cid, "quote": pen[1]}]})
            for s in sentences:
                if "terminate" in s.lower():
                    out.append({"category": "termination", "title": "Termination without notice", "classification": "concern",
                                "explanation": "The employer can end the job at once without warning.",
                                "quotes": [{"chunk_id": cid, "quote": s}], "next_step": "Ask for a notice period to be added."})
        return out

    def _groups(self, findings: list[tuple[str, str]]) -> list[dict[str, Any]]:
        """Scripted stand-in for the model's judgement: titles naming a penalty are the same issue."""
        ids = [fid for fid, body in findings if "penalty" in body.split("\n")[1].lower()]
        if len(ids) < 2:
            return []
        return [{"ids": ids, "keep": ids[0], "title": "Penalty for any delay, whatever the reason",
                 "explanation": "The employee pays a penalty for any delay, and no reason for the delay excuses it."}]

    def _summary(self, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        text = "This appears to be an agreement between the named parties."
        if self.mode == "wrong_number":
            text += " The rent is Rs. 99,999 per month."
        missing = list(self.missing)
        if any("child" in t.lower() for _, t in excerpts):
            missing.append({"topic": "Child support", "why_it_matters": "The agreement names a child but does not say who pays for the child's needs.",
                            "suggested_action": "Ask for the amount and duration of child support to be written into the agreement.",
                            "search_terms": ["child support", "maintenance of the child", "expenses"]})
        return {
            "summary": text,
            "document_type_guess": "agreement",
            "glossary": [
                {"term": "security deposit", "explanation": "Money held by the landlord.", "quote": "security deposit of Rs. 54,000"},
                {"term": "Rent", "explanation": "The monthly payment for the flat.", "quote": "RESIDENTIAL RENTAL AGREEMENT"},
                {"term": "Maintenance", "explanation": "Keeping the flat in good condition.", "quote": "MAINTENANCE"},
                {"term": "indemnity", "explanation": "Not in the document.", "quote": "indemnity clause"},
            ],
            "possibly_missing": missing,
        }

    def _checks(self, user: str, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        """Scripted: a topic is addressed when its exact name appears in a related excerpt."""
        out = []
        for n, topic in re.findall(r"^(\d+)\. (.+?) \(related excerpts", user, re.M):
            hit = next(((cid, s.strip()) for cid, t in excerpts for s in _SENT.findall(t) if topic.lower() in s.lower()), None)
            if hit:
                out.append({"number": int(n), "status": "addressed", "chunk_id": hit[0], "quote": hit[1]})
            else:
                out.append({"number": int(n), "status": "not_addressed", "chunk_id": "", "quote": ""})
        return {"checks": out}

    def _answer(self, user: str, excerpts: list[tuple[str, str]]) -> dict[str, Any]:
        question = user.split("Question:", 1)[1].split("\n", 1)[0].lower()
        words = [w for w in re.findall(r"[a-z]+", question) if len(w) > 3]
        scored = [(sum(w[:5] in s.lower() for w in words), -i, cid, s) for i, (cid, text) in enumerate(excerpts) for s in _SENT.findall(text)]
        scored = [x for x in scored if x[0] > 0]
        for _, _, cid, s in sorted(scored, reverse=True)[:1]:
            quote = s.strip()
            if self.mode == "fabricate":
                quote = "Notice may be given orally at any time."
            answer_type = "needs_professional" if "judge" in question else "answered"
            return {"answer_type": answer_type, "answer": f"The document says: {s.strip()}", "classification": "explicit",
                    "quotes": [{"chunk_id": cid, "quote": quote}], "jurisdiction_dependent": False}
        return {"answer_type": "not_in_document", "answer": "Not addressed.", "classification": "not_established",
                "quotes": [], "jurisdiction_dependent": False}
