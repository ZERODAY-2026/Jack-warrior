// Runtime checks for backend responses. The UI never renders a response that does not
// match the contract: a malformed field becomes a visible error instead of a guess.

import type {
  AnalysisResult,
  AnswerType,
  AskResponse,
  Classification,
  DeleteResponse,
  DocumentText,
  DocumentTypeInfo,
  DocumentTypeOption,
  EvidenceStatus,
  Finding,
  FindingCategory,
  HealthResponse,
  ModelState,
  Passage,
} from '../types/api';

export class MalformedResponseError extends Error {
  constructor(path: string) {
    super(`Unexpected response from the backend at "${path}".`);
    this.name = 'MalformedResponseError';
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MalformedResponseError(path);
  return v as Obj;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new MalformedResponseError(path);
  return v;
}
function strOrNull(v: unknown, path: string): string | null {
  return v === null || v === undefined ? null : str(v, path);
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MalformedResponseError(path);
  return v;
}
function numOrNull(v: unknown, path: string): number | null {
  return v === null || v === undefined ? null : num(v, path);
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new MalformedResponseError(path);
  return v;
}
function boolOrNull(v: unknown, path: string): boolean | null {
  return v === null || v === undefined ? null : bool(v, path);
}
function arr<T>(v: unknown, path: string, item: (x: unknown, p: string) => T, optional = false): T[] {
  if ((v === undefined || v === null) && optional) return [];
  if (!Array.isArray(v)) throw new MalformedResponseError(path);
  return v.map((x, i) => item(x, `${path}[${i}]`));
}
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new MalformedResponseError(path);
  return v as T;
}

const MODEL_STATES = ['ready', 'loading', 'not_installed', 'error'] as const satisfies readonly ModelState[];
const CATEGORIES = [
  'obligation', 'right', 'deadline', 'payment', 'penalty',
  'termination', 'renewal', 'ambiguity', 'concern', 'other',
] as const satisfies readonly FindingCategory[];
const CLASSIFICATIONS = ['explicit', 'interpretation', 'concern', 'not_established'] as const satisfies readonly Classification[];
const EVIDENCE = ['verified', 'unverified', 'none'] as const satisfies readonly EvidenceStatus[];
const ANSWER_TYPES = [
  'answered', 'not_in_document', 'ambiguous', 'needs_professional', 'out_of_scope',
] as const satisfies readonly AnswerType[];

const strings = (v: unknown, p: string) => arr(v, p, str, true);

export function parseHealth(v: unknown): HealthResponse {
  const o = obj(v, 'health');
  const model = obj(o.model, 'health.model');
  const limits = obj(o.limits, 'health.limits');
  const privacy = obj(o.privacy, 'health.privacy');
  return {
    status: oneOf(o.status, 'health.status', ['ok', 'degraded'] as const),
    version: str(o.version ?? 'unknown', 'health.version'),
    model: {
      state: oneOf(model.state, 'health.model.state', MODEL_STATES),
      name: strOrNull(model.name, 'health.model.name'),
      runtime: strOrNull(model.runtime, 'health.model.runtime'),
      quantization: strOrNull(model.quantization, 'health.model.quantization'),
      detail: strOrNull(model.detail, 'health.model.detail'),
      parameter_size: strOrNull(model.parameter_size, 'health.model.parameter_size'),
    },
    limits: {
      max_file_bytes: num(limits.max_file_bytes, 'health.limits.max_file_bytes'),
      max_pages: numOrNull(limits.max_pages, 'health.limits.max_pages'),
      accepted_extensions: arr(limits.accepted_extensions, 'health.limits.accepted_extensions', str),
      max_question_chars: num(limits.max_question_chars, 'health.limits.max_question_chars'),
      ocr_supported: bool(limits.ocr_supported, 'health.limits.ocr_supported'),
      accepts_pasted_text: boolOrNull(limits.accepts_pasted_text, 'health.limits.accepts_pasted_text'),
    },
    privacy: {
      bind_host: str(privacy.bind_host, 'health.privacy.bind_host'),
      telemetry_enabled: bool(privacy.telemetry_enabled, 'health.privacy.telemetry_enabled'),
      outbound_network_required: bool(privacy.outbound_network_required, 'health.privacy.outbound_network_required'),
      egress_guard_active: boolOrNull(privacy.egress_guard_active, 'health.privacy.egress_guard_active'),
      blocked_outbound_attempts: numOrNull(privacy.blocked_outbound_attempts, 'health.privacy.blocked_outbound_attempts'),
      storage: strOrNull(privacy.storage, 'health.privacy.storage'),
    },
  };
}

export function parsePassage(v: unknown, path: string): Passage {
  const o = obj(v, path);
  return {
    text: str(o.text, `${path}.text`),
    page: numOrNull(o.page, `${path}.page`),
    section: strOrNull(o.section, `${path}.section`),
    char_start: numOrNull(o.char_start, `${path}.char_start`),
    char_end: numOrNull(o.char_end, `${path}.char_end`),
    verified: bool(o.verified, `${path}.verified`),
  };
}

function parseFinding(v: unknown, path: string): Finding {
  const o = obj(v, path);
  const passages = arr(o.source_passages, `${path}.source_passages`, parsePassage, true);
  let evidence = oneOf(o.evidence_status, `${path}.evidence_status`, EVIDENCE);
  // Never let the UI call evidence "verified" when no passage backs it up.
  if (passages.length === 0) evidence = 'none';
  else if (evidence === 'verified' && passages.some((p) => !p.verified)) evidence = 'unverified';
  return {
    id: str(o.id, `${path}.id`),
    category: oneOf(o.category, `${path}.category`, CATEGORIES),
    title: str(o.title, `${path}.title`),
    explanation: str(o.explanation, `${path}.explanation`),
    classification: oneOf(o.classification, `${path}.classification`, CLASSIFICATIONS),
    evidence_status: evidence,
    source_passages: passages,
    limitations: strings(o.limitations, `${path}.limitations`),
    next_step: strOrNull(o.next_step, `${path}.next_step`),
    impact: strOrNull(o.impact, `${path}.impact`),
  };
}

export function parseAnalysis(v: unknown): AnalysisResult {
  const o = obj(v, 'analysis');
  const doc = obj(o.document, 'analysis.document');
  const extraction = obj(doc.extraction, 'analysis.document.extraction');
  const summary = obj(o.summary, 'analysis.summary');
  const processing = o.processing === undefined ? {} : obj(o.processing, 'analysis.processing');
  const findings = arr(o.findings, 'analysis.findings', parseFinding);
  const ids = new Set<string>();
  for (const f of findings) {
    if (ids.has(f.id)) throw new MalformedResponseError(`analysis.findings (duplicate id)`);
    ids.add(f.id);
  }
  return {
    document_id: str(o.document_id, 'analysis.document_id'),
    document_type: o.document_type === undefined || o.document_type === null ? null : parseTypeInfo(o.document_type),
    document: {
      filename: str(doc.filename, 'analysis.document.filename'),
      file_type: oneOf(doc.file_type, 'analysis.document.file_type', ['pdf', 'txt', 'docx'] as const),
      size_bytes: num(doc.size_bytes, 'analysis.document.size_bytes'),
      page_count: numOrNull(doc.page_count, 'analysis.document.page_count'),
      char_count: num(doc.char_count, 'analysis.document.char_count'),
      extraction: {
        status: oneOf(extraction.status, 'analysis.document.extraction.status', ['complete', 'partial'] as const),
        unreadable_pages: arr(extraction.unreadable_pages, 'analysis.document.extraction.unreadable_pages', num, true),
      },
    },
    summary: {
      text: str(summary.text, 'analysis.summary.text'),
      document_type_guess: strOrNull(summary.document_type_guess, 'analysis.summary.document_type_guess'),
      limitations: strings(summary.limitations, 'analysis.summary.limitations'),
    },
    findings,
    glossary: arr(o.glossary, 'analysis.glossary', (x, p) => {
      const g = obj(x, p);
      return {
        term: str(g.term, `${p}.term`),
        explanation: str(g.explanation, `${p}.explanation`),
        source_passages: arr(g.source_passages, `${p}.source_passages`, parsePassage, true),
      };
    }, true),
    not_found: arr(o.not_found, 'analysis.not_found', (x, p) => {
      const n = obj(x, p);
      return { topic: str(n.topic, `${p}.topic`), note: str(n.note ?? 'Not found in the reviewed text.', `${p}.note`) };
    }, true),
    warnings: arr(o.warnings, 'analysis.warnings', (x, p) => {
      const w = obj(x, p);
      return { code: str(w.code, `${p}.code`), message: str(w.message, `${p}.message`) };
    }, true),
    processing: {
      model: strOrNull(processing.model, 'analysis.processing.model'),
      duration_ms: numOrNull(processing.duration_ms, 'analysis.processing.duration_ms'),
      runtime: strOrNull(processing.runtime, 'analysis.processing.runtime'),
      model_calls: numOrNull(processing.model_calls, 'analysis.processing.model_calls'),
      chunks_total: numOrNull(processing.chunks_total, 'analysis.processing.chunks_total'),
      chunks_analysed: numOrNull(processing.chunks_analysed, 'analysis.processing.chunks_analysed'),
      quotes_rejected: numOrNull(processing.quotes_rejected, 'analysis.processing.quotes_rejected'),
    },
    disclaimer: str(o.disclaimer ?? 'Informational assistance only. Not legal advice.', 'analysis.disclaimer'),
  };
}

function parseTypeInfo(v: unknown): DocumentTypeInfo {
  const t = obj(v, 'analysis.document_type');
  return {
    id: str(t.id, 'analysis.document_type.id'),
    label: str(t.label, 'analysis.document_type.label'),
    source: oneOf(t.source, 'analysis.document_type.source', ['detected', 'user'] as const),
    detected_id: str(t.detected_id ?? t.id, 'analysis.document_type.detected_id'),
    confidence: oneOf(t.confidence, 'analysis.document_type.confidence', ['high', 'low'] as const),
    alternatives: strings(t.alternatives, 'analysis.document_type.alternatives'),
    method: strOrNull(t.method, 'analysis.document_type.method'),
  };
}

export function parseDocumentTypes(v: unknown): DocumentTypeOption[] {
  return arr(v, 'document_types', (x, p) => {
    const o = obj(x, p);
    return { id: str(o.id, `${p}.id`), label: str(o.label, `${p}.label`) };
  });
}

export function parseAsk(v: unknown): AskResponse {
  const o = obj(v, 'ask');
  return {
    question: str(o.question, 'ask.question'),
    answer: str(o.answer, 'ask.answer'),
    answer_type: oneOf(o.answer_type, 'ask.answer_type', ANSWER_TYPES),
    classification: oneOf(o.classification, 'ask.classification', CLASSIFICATIONS),
    source_passages: arr(o.source_passages, 'ask.source_passages', parsePassage, true),
    limitations: strings(o.limitations, 'ask.limitations'),
    escalation: strOrNull(o.escalation, 'ask.escalation'),
    jurisdiction_note: strOrNull(o.jurisdiction_note, 'ask.jurisdiction_note'),
  };
}

export function parseDocumentText(v: unknown): DocumentText {
  const o = obj(v, 'text');
  return {
    document_id: str(o.document_id, 'text.document_id'),
    pages: arr(o.pages, 'text.pages', (x, p) => {
      const pg = obj(x, p);
      return {
        page: numOrNull(pg.page, `${p}.page`),
        char_start: num(pg.char_start, `${p}.char_start`),
        text: str(pg.text, `${p}.text`),
      };
    }),
  };
}

export function parseDelete(v: unknown): DeleteResponse {
  const o = obj(v, 'delete');
  return { deleted: bool(o.deleted, 'delete.deleted'), removed: strings(o.removed, 'delete.removed') };
}
