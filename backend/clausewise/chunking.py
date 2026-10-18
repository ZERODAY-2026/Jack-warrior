"""Deterministic, source-preserving chunking.

Chunks are spans of the canonical document text (``char_start``/``char_end``),
never rewritten copies, so a chunk's text is always ``doc.text[start:end]``.
Paragraphs are merged up to a target size and long paragraphs are split at
sentence boundaries. The most recent heading seen is carried as ``section``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .document_parser import ExtractedDocument

TARGET_CHARS = 900
MAX_CHARS = 1500

_PARA_BREAK = re.compile(r"\n[ \t]*\n+")
_SENTENCE_END = re.compile(r"(?<=[.;:!?])\s+(?=[A-Z0-9(\"'])")
_HEADING = re.compile(
    r"^\s*(?:"
    r"(?:clause|section|article|schedule|annexure|part)\s+[0-9IVXLC]+[A-Za-z]?(?:\.\d+)*\b[^\n]{0,80}"
    r"|\d{1,2}(?:\.\d{1,2})*[.)]?\s+[A-Z][^\n]{0,80}"
    r"|[A-Z][A-Z0-9 ,&'/-]{3,60}"
    r")\s*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Chunk:
    id: str
    char_start: int
    char_end: int
    text: str
    page: int | None
    section: str | None


def _heading_of(paragraph: str) -> str | None:
    first_line = paragraph.strip().split("\n", 1)[0].strip()
    if not first_line or len(first_line) > 90:
        return None
    match = _HEADING.match(first_line)
    if not match:
        return None
    # An all-caps-style match must actually be upper case to count as a heading.
    if first_line.upper() != first_line and not re.match(r"^\s*(clause|section|article|schedule|annexure|part|\d)", first_line, re.I):
        return None
    return first_line.rstrip(" .:")[:80]


def _paragraph_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    pos = 0
    for m in _PARA_BREAK.finditer(text):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    # Trim surrounding whitespace while keeping exact offsets
    out = []
    for s, e in spans:
        seg = text[s:e]
        lead = len(seg) - len(seg.lstrip())
        trail = len(seg) - len(seg.rstrip())
        if e - trail > s + lead:
            out.append((s + lead, e - trail))
    return out


def _split_long(text: str, start: int, end: int) -> list[tuple[int, int]]:
    if end - start <= MAX_CHARS:
        return [(start, end)]
    pieces: list[tuple[int, int]] = []
    cur = start
    seg = text[start:end]
    boundaries = [start + m.start() for m in _SENTENCE_END.finditer(seg)] + [end]
    last_cut = start
    for b in boundaries:
        if b - last_cut > TARGET_CHARS and cur > last_cut:
            pieces.append((last_cut, cur))
            last_cut = cur
        cur = b
    pieces.append((last_cut, end))
    # Hard split anything still too long (e.g. no punctuation)
    final: list[tuple[int, int]] = []
    for s, e in pieces:
        while e - s > MAX_CHARS:
            cut = text.rfind(" ", s, s + MAX_CHARS)
            cut = cut if cut > s + TARGET_CHARS // 2 else s + MAX_CHARS
            final.append((s, cut))
            s = cut
            while s < e and text[s].isspace():
                s += 1
        if e > s:
            final.append((s, e))
    return final


def chunk_document(doc: ExtractedDocument) -> list[Chunk]:
    text = doc.text
    paragraphs = _paragraph_spans(text)
    chunks: list[Chunk] = []
    section: str | None = None
    buf_start: int | None = None
    buf_end = 0
    buf_section: str | None = None

    def flush() -> None:
        nonlocal buf_start
        if buf_start is None:
            return
        for s, e in _split_long(text, buf_start, buf_end):
            chunks.append(
                Chunk(
                    id=f"c{len(chunks) + 1:03d}",
                    char_start=s,
                    char_end=e,
                    text=text[s:e],
                    page=doc.page_for_offset(s),
                    section=buf_section,
                )
            )
        buf_start = None

    for s, e in paragraphs:
        heading = _heading_of(text[s:e])
        page_changed = buf_start is not None and doc.page_for_offset(s) != doc.page_for_offset(buf_start)
        if heading:
            flush()
            section = heading
        elif buf_start is not None and (e - buf_start > TARGET_CHARS or page_changed):
            flush()
        if buf_start is None:
            buf_start, buf_section = s, section
        buf_end = e
    flush()
    return chunks
