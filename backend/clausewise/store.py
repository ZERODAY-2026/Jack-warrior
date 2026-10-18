"""In-memory document store.

Nothing is persisted: uploaded bytes are parsed in memory and dropped, and the
extracted text, chunks, analysis and question history live only in this
process until deleted, expired (TTL) or evicted, or the backend stops.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field

from .analysis import DocContext
from .schemas import AnalysisResponse, AskResponse

REMOVED_ITEMS = ["uploaded_file", "extracted_text", "chunks", "analysis", "qa_history"]


@dataclass
class DocumentRecord:
    id: str
    ctx: DocContext
    created: float = field(default_factory=time.monotonic)
    analysis: AnalysisResponse | None = None
    qa_history: list[AskResponse] = field(default_factory=list)


class DocumentStore:
    def __init__(self, ttl_s: int, max_documents: int):
        self.ttl_s = ttl_s
        self.max_documents = max_documents
        self._docs: dict[str, DocumentRecord] = {}
        self._lock = threading.Lock()

    @staticmethod
    def new_id() -> str:
        return "d_" + secrets.token_hex(12)

    def _purge(self) -> None:
        now = time.monotonic()
        for doc_id in [k for k, v in self._docs.items() if now - v.created > self.ttl_s]:
            self._drop(doc_id)

    def _drop(self, doc_id: str) -> None:
        rec = self._docs.pop(doc_id, None)
        if rec is not None:
            rec.qa_history.clear()
            rec.analysis = None

    def put(self, record: DocumentRecord) -> None:
        with self._lock:
            self._purge()
            while len(self._docs) >= self.max_documents:
                oldest = min(self._docs.values(), key=lambda r: r.created)
                self._drop(oldest.id)
            self._docs[record.id] = record

    def get(self, doc_id: str) -> DocumentRecord | None:
        with self._lock:
            self._purge()
            return self._docs.get(doc_id)

    def delete(self, doc_id: str) -> bool:
        with self._lock:
            existed = doc_id in self._docs
            self._drop(doc_id)
            return existed

    def clear(self) -> int:
        with self._lock:
            n = len(self._docs)
            for doc_id in list(self._docs):
                self._drop(doc_id)
            return n

    def __len__(self) -> int:
        with self._lock:
            return len(self._docs)
