"""Deterministic checks for wording that a reader may want to question.

A small edge model reliably extracts what a clause says but often misses what
it leaves open. These rules are a backstop: they flag generic phrasing patterns
(one party decides alone, action without notice, a daily charge with no stated
limit, terms left to be agreed). They never decide that a clause is unfair or
invalid; they point at the sentence and say why it may be worth asking about.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    key: str
    category: str  # "ambiguity" or "concern"
    title: str
    explanation: str
    next_step: str
    pattern: re.Pattern[str]
    requires: re.Pattern[str] | None = None  # the sentence must also match this
    unless: re.Pattern[str] | None = None  # sentence-level exception


RULES: list[Rule] = [
    Rule(
        "one_party_decides",
        "ambiguity",
        "Left to one party's judgement",
        "This wording lets one party decide the outcome or amount, and the text gives no standard or limit for that decision.",
        "Ask the other party to state in writing how this will be decided, or to set a limit.",
        re.compile(
            r"\b(?:sole|absolute|own)\s+discretion\b|\bas\s+(?:it|he|she|they|the \w+)\s+(?:deems?|thinks?|sees?|considers?)\s+fit\b|"
            r"\b(?:considers?|deems?|thinks?|determines?|judges?)\s+(?:to be\s+)?(?:reasonable|appropriate|necessary|fit|proper|suitable)\b",
            re.I,
        ),
    ),
    Rule(
        "without_notice",
        "concern",
        "Action allowed without notice",
        "This wording allows an action without any advance notice, or at any time.",
        "Ask whether a notice period or a chance to fix a problem first can be added.",
        re.compile(r"\bwithout\s+(?:any\s+)?(?:prior\s+|advance\s+|further\s+)?notice\b|\bat\s+any\s+time\b", re.I),
    ),
    Rule(
        "uncapped_daily_charge",
        "concern",
        "Daily charge with no stated limit",
        "This charge grows for every day it applies, and the sentence does not state a maximum.",
        "Ask whether there is a maximum amount for this charge.",
        re.compile(r"\b(?:for\s+each|per|every)\s+(?:calendar\s+|working\s+)?day\b", re.I),
        requires=re.compile(r"\b(?:fee|fine|penalty|charge|interest|damages)\b", re.I),
        unless=re.compile(r"\bmaximum\b|\bcap(?:ped)?\b|\bnot\s+(?:to\s+)?exceed|\bup\s+to\b|\blimited\s+to\b|\bat\s+most\b", re.I),
    ),
    Rule(
        "terms_to_be_agreed",
        "ambiguity",
        "Terms left to be agreed later",
        "This wording leaves the terms to be agreed in the future, so the document itself does not say what they will be.",
        "Ask for the terms to be written down before relying on this clause.",
        re.compile(r"\b(?:terms?|conditions?|amount|rate|price)\s+(?:to\s+be|yet\s+to\s+be|that\s+will\s+be)\s+(?:agreed|decided|determined|fixed)\b", re.I),
    ),
    Rule(
        "automatic_renewal",
        "concern",
        "Renews automatically",
        "This agreement continues for a further period on its own unless someone acts before a deadline.",
        "Note the date by which notice must be given if you do not want it to renew.",
        re.compile(r"\brenew(?:s|ed)?\s+automatically\b|\bautomatic(?:ally)?\s+renew|\bauto[- ]renew", re.I),
    ),
]


@dataclass(frozen=True)
class Match:
    rule: Rule
    start: int  # sentence span in the source text
    end: int


# A full stop that ends a sentence: not after a common abbreviation ("Rs.", "No.")
# and followed by whitespace, or the end of a line.
_ABBREV = r"(?<!\bRs)(?<!\bNo)(?<!\bMr)(?<!\bMs)(?<!\bDr)(?<!\bSt)(?<!\bvs)(?<!\bie)(?<!\beg)(?<!\bCo)(?<!\bLtd)(?<!\bInc)(?<!\bcl)"
_BOUNDARY = re.compile(r"\n|" + _ABBREV + r"\.(?=\s|$)")


def sentence_span(text: str, start: int, end: int) -> tuple[int, int]:
    """The sentence (or line) around [start, end), as source offsets."""
    s = 0
    for b in _BOUNDARY.finditer(text, 0, start):
        s = b.end()
    nxt = _BOUNDARY.search(text, end)
    e = len(text) if nxt is None else (nxt.end() if text[nxt.start()] == "." else nxt.start())
    while s < start and text[s].isspace():
        s += 1
    return s, e


def find(text: str) -> list[Match]:
    out: list[Match] = []
    seen: set[tuple[str, int]] = set()
    for rule in RULES:
        for m in rule.pattern.finditer(text):
            s, e = sentence_span(text, m.start(), m.end())
            if rule.requires and not rule.requires.search(text[s:e]):
                continue
            if rule.unless and rule.unless.search(text[s:e]):
                continue
            if (rule.key, s) in seen:
                continue
            seen.add((rule.key, s))
            out.append(Match(rule, s, e))
    out.sort(key=lambda m: m.start)
    return out
