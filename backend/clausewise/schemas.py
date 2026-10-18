"""API response models. Mirrors docs/api-contract.md; change both together."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Category = Literal[
    "obligation", "right", "deadline", "payment", "penalty", "termination", "renewal", "ambiguity", "concern", "other"
]
Classification = Literal["explicit", "interpretation", "concern", "not_established"]
EvidenceStatus = Literal["verified", "unverified", "none"]
Priority = Literal["high", "medium", "low"]
AnswerType = Literal["answered", "not_in_document", "ambiguous", "needs_professional", "out_of_scope"]


class Passage(BaseModel):
    text: str
    page: int | None
    section: str | None
    char_start: int
    char_end: int
    verified: bool = True


class Finding(BaseModel):
    id: str
    category: Category
    title: str
    explanation: str
    classification: Classification
    priority: Priority
    priority_reason: str
    evidence_status: EvidenceStatus
    source_passages: list[Passage]
    limitations: list[str] = Field(default_factory=list)
    next_step: str | None = None


class GlossaryEntry(BaseModel):
    term: str
    explanation: str
    source_passages: list[Passage]


class Extraction(BaseModel):
    status: Literal["complete", "partial"]
    unreadable_pages: list[int]


class DocumentInfo(BaseModel):
    filename: str
    file_type: Literal["pdf", "txt"]
    size_bytes: int
    page_count: int | None
    char_count: int
    extraction: Extraction


class Summary(BaseModel):
    text: str
    document_type_guess: str | None
    limitations: list[str]


class NotFound(BaseModel):
    topic: str
    note: str


class Warning(BaseModel):
    code: str
    message: str


class Processing(BaseModel):
    model: str
    runtime: str
    duration_ms: int
    model_calls: int
    chunks_total: int
    chunks_analysed: int
    quotes_rejected: int


class AnalysisResponse(BaseModel):
    document_id: str
    document: DocumentInfo
    summary: Summary
    findings: list[Finding]
    glossary: list[GlossaryEntry]
    not_found: list[NotFound]
    warnings: list[Warning]
    processing: Processing
    disclaimer: str


class PageOut(BaseModel):
    page: int | None
    char_start: int
    text: str


class DocumentText(BaseModel):
    document_id: str
    pages: list[PageOut]


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    question: str
    answer: str
    answer_type: AnswerType
    classification: Classification
    source_passages: list[Passage]
    limitations: list[str]
    escalation: str | None
    jurisdiction_note: str | None


class DeleteResponse(BaseModel):
    deleted: bool
    removed: list[str]


class ModelInfo(BaseModel):
    state: Literal["ready", "loading", "not_installed", "error"]
    name: str
    runtime: str
    quantization: str | None
    parameter_size: str | None = None
    detail: str | None


class Limits(BaseModel):
    max_file_bytes: int
    max_pages: int
    accepted_extensions: list[str]
    max_question_chars: int
    ocr_supported: bool


class PrivacyInfo(BaseModel):
    bind_host: str
    telemetry_enabled: bool
    outbound_network_required: bool
    egress_guard_active: bool
    blocked_outbound_attempts: int
    storage: str


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    model: ModelInfo
    limits: Limits
    privacy: PrivacyInfo
