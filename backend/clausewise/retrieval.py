"""Local lexical retrieval (BM25 with a small legal synonym map).

No embeddings and no vector store: for a single contract of a few dozen
chunks, BM25 over clause-sized chunks is fast, deterministic and easy to
inspect. Retrieval scores are also used to decide when the document is
probably silent on a question.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from .chunking import Chunk

_TOKEN = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    "a an the and or of to in on for by with is are was were be been being this that these those it its as at "
    "from shall will may can must not no any all such which who whom what when where how do does did i me my we "
    "our you your he she they them their there here if then than so per into upon under about after before".split()
)

# Words that appear in almost any question about a document and carry no topic.
QUERY_STOPWORDS = frozenset(
    "agreement contract document clause clauses section say says said mention mentions anything something "
    "tell explain mean means there whether about state states stated".split()
)

# Query-side expansion so "end the lease" finds "terminate" and so on.
_SYNONYM_WORDS: dict[str, tuple[str, ...]] = {
    "end": ("terminate", "cancel", "expire"),
    "terminate": ("end", "cancel", "expire", "notice"),
    "cancel": ("terminate",),
    "quit": ("terminate", "resign"),
    "leave": ("terminate", "vacate", "resign"),
    "resign": ("terminate", "notice"),
    "fire": ("terminate", "dismiss"),
    "pay": ("payment", "rent", "fee", "salary", "amount", "due"),
    "payment": ("pay", "rent", "fee", "amount", "due"),
    "rent": ("payment", "pay"),
    "salary": ("pay", "remuneration", "compensation", "wages"),
    "fine": ("penalty", "late", "charge", "interest"),
    "penalty": ("fine", "late", "charge", "interest", "liquidated"),
    "late": ("penalty", "interest", "overdue"),
    "deposit": ("security", "refund"),
    "renew": ("extension", "extend", "term"),
    "notice": ("notify", "written"),
    "deadline": ("date", "within", "days"),
    "law": ("governing", "jurisdiction"),
    "court": ("jurisdiction", "dispute", "arbitration"),
    "dispute": ("arbitration", "court", "jurisdiction"),
    "repair": ("maintenance", "damage"),
    "confidential": ("disclose", "secret"),
    "liable": ("liability", "indemnify", "damages"),
}


def stem(token: str) -> str:
    """Crude prefix stemmer: 'terminate', 'termination', 'terminated' all become 'termi'."""
    return token[:5] if len(token) > 5 else token


def tokenize(text: str) -> list[str]:
    return [stem(t) for t in _TOKEN.findall(text.lower()) if t not in STOPWORDS and len(t) > 1]


SYNONYMS: dict[str, tuple[str, ...]] = {}
for _word, _syns in _SYNONYM_WORDS.items():
    SYNONYMS.setdefault(stem(_word), ())
    SYNONYMS[stem(_word)] += tuple(stem(x) for x in _syns)


_QUERY_STOP_STEMS = frozenset(stem(w) for w in QUERY_STOPWORDS)


def expand_query(tokens: list[str]) -> list[str]:
    out = list(tokens)
    for t in tokens:
        out.extend(SYNONYMS.get(t, ()))
    return out


@dataclass(frozen=True)
class ScoredChunk:
    chunk: Chunk
    score: float
    matched_terms: tuple[str, ...]


class BM25Index:
    def __init__(self, chunks: list[Chunk], k1: float = 1.4, b: float = 0.75):
        self.chunks = chunks
        self.k1, self.b = k1, b
        self.docs = [Counter(tokenize(c.text)) for c in chunks]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.avgdl = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0.0
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(chunks)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query: str, k: int = 4) -> list[ScoredChunk]:
        q_tokens = [t for t in tokenize(query) if t not in _QUERY_STOP_STEMS]
        if not q_tokens or not self.chunks:
            return []
        weights: Counter[str] = Counter()
        for t in q_tokens:
            weights[t] += 1.0
        for t in expand_query(q_tokens):
            if t not in weights:
                weights[t] += 0.4
        results: list[ScoredChunk] = []
        for chunk, doc, dl in zip(self.chunks, self.docs, self.lengths):
            score = 0.0
            matched: list[str] = []
            for term, w in weights.items():
                tf = doc.get(term, 0)
                if not tf:
                    continue
                idf = self.idf[term]
                denom = tf + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1))
                score += w * idf * tf * (self.k1 + 1) / denom
                matched.append(term)
            if score > 0:
                results.append(ScoredChunk(chunk, score, tuple(matched)))
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:k]
