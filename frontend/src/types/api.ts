// TypeScript mirror of docs/api-contract.md. Change the contract first, then this file.

export type ModelState = 'ready' | 'loading' | 'not_installed' | 'error';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  model: {
    state: ModelState;
    name: string | null;
    runtime: string | null;
    quantization: string | null;
    detail: string | null;
    parameter_size: string | null;
  };
  limits: {
    max_file_bytes: number;
    max_pages: number | null;
    accepted_extensions: string[];
    max_question_chars: number;
    ocr_supported: boolean;
  };
  privacy: {
    bind_host: string;
    telemetry_enabled: boolean;
    outbound_network_required: boolean;
    egress_guard_active: boolean | null;
    blocked_outbound_attempts: number | null;
    storage: string | null;
  };
}

export type FindingCategory =
  | 'obligation'
  | 'right'
  | 'deadline'
  | 'payment'
  | 'penalty'
  | 'termination'
  | 'renewal'
  | 'ambiguity'
  | 'concern'
  | 'other';

export type Classification = 'explicit' | 'interpretation' | 'concern' | 'not_established';
export type Priority = 'high' | 'medium' | 'low';
export type EvidenceStatus = 'verified' | 'unverified' | 'none';

export interface Passage {
  text: string;
  page: number | null;
  section: string | null;
  char_start: number | null;
  char_end: number | null;
  verified: boolean;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  title: string;
  explanation: string;
  classification: Classification;
  priority: Priority;
  priority_reason: string;
  evidence_status: EvidenceStatus;
  source_passages: Passage[];
  limitations: string[];
  next_step: string | null;
}

export interface NotFoundTopic {
  topic: string;
  note: string;
}

export interface GlossaryTerm {
  term: string;
  explanation: string;
  source_passages: Passage[];
}

export interface ApiWarning {
  code: string;
  message: string;
}

export interface AnalysisResult {
  document_id: string;
  document: {
    filename: string;
    file_type: 'pdf' | 'txt';
    size_bytes: number;
    page_count: number | null;
    char_count: number;
    extraction: { status: 'complete' | 'partial'; unreadable_pages: number[] };
  };
  summary: {
    text: string;
    document_type_guess: string | null;
    limitations: string[];
  };
  findings: Finding[];
  glossary: GlossaryTerm[];
  not_found: NotFoundTopic[];
  warnings: ApiWarning[];
  processing: {
    model: string | null;
    duration_ms: number | null;
    runtime: string | null;
    model_calls: number | null;
    chunks_total: number | null;
    chunks_analysed: number | null;
    quotes_rejected: number | null;
  };
  disclaimer: string;
}

export interface DocumentText {
  document_id: string;
  pages: { page: number | null; char_start: number; text: string }[];
}

export type AnswerType =
  | 'answered'
  | 'not_in_document'
  | 'ambiguous'
  | 'needs_professional'
  | 'out_of_scope';

export interface AskResponse {
  question: string;
  answer: string;
  answer_type: AnswerType;
  classification: Classification;
  source_passages: Passage[];
  limitations: string[];
  escalation: string | null;
  jurisdiction_note: string | null;
}

export interface DeleteResponse {
  deleted: boolean;
  removed: string[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
