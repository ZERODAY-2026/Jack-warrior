"""Legal-scope boundaries, question triage, output screening and
prompt-injection detection.

These are deterministic checks applied around the model, so safety does not
depend on the model choosing to behave.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DISCLAIMER = (
    "Informational assistance only, generated on this device from the text of your document. "
    "This is not legal advice and cannot decide whether anything is legally valid or enforceable. "
    "For decisions, consult a qualified lawyer."
)

ESCALATION_LEGAL_JUDGMENT = (
    "This question needs legal judgment about how the law applies to your document and situation. "
    "A qualified lawyer licensed where the agreement applies can answer it; bring the passages shown here."
)
ESCALATION_ADVICE = (
    "Deciding what you should do is a decision for you, ideally with a qualified lawyer who knows your situation. "
    "The passages shown here are what the document itself says."
)
JURISDICTION_NOTE = (
    "The answer may depend on the law that governs this agreement (for example the country or state), "
    "which can override or limit what the document says. This tool does not apply any law."
)


@dataclass(frozen=True)
class QuestionTriage:
    kind: str  # "document" | "legal_judgment" | "advice"
    jurisdiction_dependent: bool


_LEGAL_JUDGMENT = re.compile(
    r"\b(enforceab\w*|unenforceab\w*|(?:legally\s+)?(?:valid|invalid|void|voidable|binding)\b|"
    r"(?:il)?legal(?:ly)?\b(?!\s+(?:notice|document|term|terms))|lawful|unlawful|"
    r"against the law|allowed (?:by|under) (?:the )?law|"
    r"can (?:i|they|he|she|we) sue|sue (?:me|them|him|her)|take (?:me|them|him|her) to court|"
    r"win (?:the|a|my) case|in court|breach of contract|liable for|"
    r"hold up in court|stand up in court)",
    re.IGNORECASE,
)
_ADVICE = re.compile(
    r"\b(should i|shall i|do i have to sign|is it safe to sign|safe to sign|"
    r"what (?:should|do) i do|advise me|your (?:legal )?advice|recommend (?:that )?i|"
    r"am i (?:legally )?(?:obliged|obligated|required|bound) to)\b",
    re.IGNORECASE,
)
# "Do I have to pay this?" asks whether to comply, not what the document says. Matched only as the
# whole question, so "How many days do I have to pay?" stays a document question.
_COMPLY = re.compile(
    r"\s*(?:so |but |really )?(?:do|must) i (?:really |actually )?(?:(?:have|need) to )?"
    r"(?:pay|comply|reply|respond|accept|agree|obey|follow)(?: with)?(?: (?:this|it|that|them|these|the \w+))?\s*\??\s*",
    re.IGNORECASE,
)
_JURISDICTION = re.compile(
    r"\b(law|laws|legal|statute|act\b|court|jurisdiction|state|country|india|indian|tenant rights|"
    r"rent control|labour|labor|consumer protection|regulation)\b",
    re.IGNORECASE,
)


def triage_question(question: str) -> QuestionTriage:
    if _LEGAL_JUDGMENT.search(question):
        kind = "legal_judgment"
    elif _ADVICE.search(question) or _COMPLY.fullmatch(question):
        kind = "advice"
    else:
        kind = "document"
    return QuestionTriage(kind=kind, jurisdiction_dependent=bool(_JURISDICTION.search(question)) or kind == "legal_judgment")


# --- output screening ------------------------------------------------------

_CONCLUSION = re.compile(
    r"\b(?:is|are|would be|will be|seems|appears to be|looks)\s+(?:not\s+)?(?:legally\s+)?"
    r"(?:enforceable|unenforceable|illegal|invalid|void|voidable|unlawful|lawful|legally binding|"
    r"legally valid|not valid)\b"
    r"|\byou (?:should|must|should not|shouldn't|must not) (?:sign|not sign|accept|reject|refuse)\b"
    r"|\b(?:you will|you'll) (?:win|lose)\b"
    r"|\bthis (?:is|constitutes) legal advice\b"
    r"|\bas your (?:lawyer|attorney|advocate)\b",
    re.IGNORECASE,
)
_SENTENCES = re.compile(r"(?<=[.!?])\s+")


def screen_output(text: str) -> tuple[str, bool]:
    """Remove sentences that state legal conclusions or give directives.
    Returns (screened_text, changed)."""
    if not text or not _CONCLUSION.search(text):
        return text, False
    kept = [s for s in _SENTENCES.split(text) if not _CONCLUSION.search(s)]
    return " ".join(kept).strip(), True


SCREENED_LIMITATION = (
    "A statement about legal validity or what you should do was removed, because this tool cannot decide that."
)


# --- prompt injection --------------------------------------------------------

_INJECTION = re.compile(
    r"(ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)?\s*"
    r"(?:instructions?|prompts?|rules?|directions?)"
    r"|\b(?:system|developer)\s+prompt\b"
    r"|\byou are (?:now|no longer)\b"
    r"|\bnew instructions?\s*:"
    r"|\b(?:reveal|print|show|output)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|secrets?|api keys?)"
    r"|\b(?:send|upload|post|transmit|email|forward)\s+(?:this|the)\s+(?:document|contract|agreement|text|file)\s+to\b"
    r"|\b(?:invent|fabricate|make up)\s+(?:a|an|the|any)?\s*(?:clause|citation|quote|answer)"
    r"|\bignore\s+(?:the\s+)?citation"
    r"|\b(?:as an ai|dear (?:ai|assistant|model|chatbot|llm))\b",
    re.IGNORECASE,
)


def find_injection_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _INJECTION.finditer(text)]


def fence_document_text(text: str) -> str:
    """Neutralise anything that could close our excerpt delimiters."""
    return text.replace("<", "‹").replace(">", "›")


INJECTION_LIMITATION = (
    "Found by a fixed security check for text addressed to an AI system, not by the model. It flags the wording only."
)
