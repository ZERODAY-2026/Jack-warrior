"""The kinds of document a user can pick or the model can assign.

This is only a list of labels. The model decides which one a document is (see
``Analyzer.classify`` in analysis.py), and the chosen label is passed into the prompts
as context. There is no per-type rule, keyword list or topic checklist: what a
document contains, and what it leaves out, is judged by the model from the text.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DocType:
    id: str
    label: str


TYPES: tuple[DocType, ...] = (
    DocType("rental", "Rental or lease agreement"),
    DocType("employment", "Employment contract or offer letter"),
    DocType("legal_notice", "Legal notice or demand notice"),
    DocType("nda", "Non-disclosure or confidentiality agreement"),
    DocType("freelance", "Freelance or consulting agreement"),
    DocType("service", "Service agreement"),
    DocType("vendor", "Vendor or supply agreement"),
    DocType("partnership", "Partnership agreement"),
    DocType("terms", "Terms and conditions or terms of service"),
    DocType("family", "Divorce, separation or family settlement agreement"),
    DocType("loan", "Loan agreement"),
    DocType("property", "Property sale or lease deed"),
    DocType("power_of_attorney", "Power of attorney"),
    DocType("general", "Other legal document"),
)

BY_ID = {t.id: t for t in TYPES}
GENERAL = BY_ID["general"]


@dataclass(frozen=True)
class Detection:
    type: DocType
    confidence: str  # "high" | "low", as the model reported it
    alternatives: tuple[str, ...]  # other plausible type ids from the model, best first
    method: str  # "model", or "fallback" when the model gave no usable answer
