"""Citation validation: every passage shown to the user is copied from the
original extraction, located by offset, never taken from model output.

The model proposes a quote. We look for it in the source text (exact, then
whitespace/quote/case-normalised, then a high-threshold fuzzy match over the
cited chunk). If found, the passage returned is ``doc_text[start:end]``. If
not, the quote is discarded and the finding is marked as having no verified
evidence. A separate support check compares numbers and durations in the
model's explanation against the passage, because an existing quote can still
be attached to a wrong claim.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass

MIN_QUOTE_CHARS = 12
MAX_PASSAGE_CHARS = 700
FUZZY_THRESHOLD = 0.90

_QUOTE_MAP = str.maketrans(
    {
        "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
        "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"',
        "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u00a0": " ", "\u00ad": "",
        "\u2039": "<", "\u203a": ">",  # undo safety.fence_document_text
    }
)


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    method: str  # "exact" | "normalised" | "fuzzy"


def _normalise_with_map(text: str) -> tuple[str, list[int]]:
    """Lower-case, unify quotes/dashes, collapse whitespace and join hyphenated
    line breaks. Returns the normalised string and, for each of its characters,
    the index of the source character it came from."""
    out: list[str] = []
    index: list[int] = []
    i = 0
    n = len(text)
    prev_space = True
    while i < n:
        ch = text[i].translate(_QUOTE_MAP)
        if ch == "-" and i + 1 < n and text[i + 1] == "\n":  # "termi-\nnation"
            i += 2
            while i < n and text[i] in " \t":
                i += 1
            continue
        if not ch:
            i += 1
            continue
        if ch.isspace():
            if not prev_space:
                out.append(" ")
                index.append(i)
            prev_space = True
        else:
            out.append(ch.lower())
            index.append(i)
            prev_space = False
        i += 1
    while out and out[-1] == " ":
        out.pop()
        index.pop()
    return "".join(out), index


def _clean_quote(quote: str) -> str:
    q = quote.strip().strip('"').strip("'").strip()
    q = re.sub(r"^\.{3}|\.{3}$|^…|…$", "", q).strip()
    return q


def locate(quote: str, text: str, hint: tuple[int, int] | None = None) -> Span | None:
    """Find ``quote`` in ``text``. ``hint`` is the (start, end) of the chunk the
    model said it quoted from; it is searched first and used for fuzzy matching."""
    q = _clean_quote(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return None

    regions = [hint, (0, len(text))] if hint else [(0, len(text))]
    for start, end in regions:
        pos = text.find(q, start, end)
        if pos != -1:
            return Span(pos, pos + len(q), "exact")

    norm_text, idx = _normalise_with_map(text)
    norm_q, _ = _normalise_with_map(q)
    if not norm_q:
        return None
    # Handle model quotes with an ellipsis: locate the longest piece.
    pieces = [p.strip() for p in re.split(r"\s*(?:\.\.\.|…)\s*", norm_q) if p.strip()]
    candidates = [norm_q] + (sorted(pieces, key=len, reverse=True) if len(pieces) > 1 else [])
    for cand in candidates:
        if len(cand) < MIN_QUOTE_CHARS:
            continue
        pos = norm_text.find(cand)
        if pos != -1:
            s, e = idx[pos], idx[pos + len(cand) - 1] + 1
            return Span(s, e, "normalised")

    if hint:
        return _fuzzy(norm_q, text, hint)
    return None


def _fuzzy(norm_q: str, text: str, hint: tuple[int, int]) -> Span | None:
    region = text[hint[0] : hint[1]]
    norm_region, idx = _normalise_with_map(region)
    if not norm_region or len(norm_q) > len(norm_region) * 1.2:
        return None
    window = len(norm_q)
    best = (0.0, -1)
    step = max(1, window // 10)
    matcher = difflib.SequenceMatcher(autojunk=False)
    matcher.set_seq2(norm_q)
    for pos in range(0, max(1, len(norm_region) - window + 1), step):
        matcher.set_seq1(norm_region[pos : pos + window])
        if matcher.real_quick_ratio() < FUZZY_THRESHOLD or matcher.quick_ratio() < FUZZY_THRESHOLD:
            continue
        r = matcher.ratio()
        if r > best[0]:
            best = (r, pos)
    if best[0] < FUZZY_THRESHOLD:
        return None
    pos = best[1]
    end = min(len(idx) - 1, pos + window - 1)
    return Span(hint[0] + idx[pos], hint[0] + idx[end] + 1, "fuzzy")


def trim_span(text: str, span: Span) -> tuple[int, int]:
    """Cap very long passages, cutting at a word boundary."""
    start, end = span.start, span.end
    if end - start > MAX_PASSAGE_CHARS:
        cut = text.rfind(" ", start, start + MAX_PASSAGE_CHARS)
        end = cut if cut > start else start + MAX_PASSAGE_CHARS
    return start, end


# --- support checks --------------------------------------------------------

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
    "forty-five": 45, "fifty": 50, "sixty": 60, "ninety": 90, "hundred": 100,
}
_NUM = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?(?![\w])")


def _numbers(text: str) -> set[str]:
    found = {m.group(0).replace(",", "") for m in _NUM.finditer(text)}
    lowered = text.lower()
    for word, value in _NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", lowered):
            found.add(str(value))
    return {n.rstrip("0").rstrip(".") if "." in n else n for n in found}


def unsupported_numbers(claim: str, passages: list[str]) -> set[str]:
    """Numbers stated in the claim that appear in none of the cited passages."""
    claim_nums = _numbers(claim)
    if not claim_nums:
        return set()
    source_nums: set[str] = set()
    for p in passages:
        source_nums |= _numbers(p)
    return claim_nums - source_nums
