import type { AnswerType, Classification, EvidenceStatus, FindingCategory, Priority } from '../types/api';

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  obligation: 'Obligation',
  right: 'Right',
  deadline: 'Deadline',
  payment: 'Payment',
  penalty: 'Penalty',
  termination: 'Termination',
  renewal: 'Renewal',
  ambiguity: 'Ambiguity',
  concern: 'Concern',
  other: 'Other',
};

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  explicit: 'Stated in document',
  interpretation: 'Interpretation',
  concern: 'Possible concern',
  not_established: 'Not established',
};

export const CLASSIFICATION_HELP: Record<Classification, string> = {
  explicit: 'The document says this directly. Check the quoted passage.',
  interpretation: 'A plain-language reading of the quoted wording. It may not be the only reading.',
  concern: 'Something worth reviewing or clarifying. This is not a legal conclusion.',
  not_established: 'The available text does not establish this.',
};

// The backend's priority is its risk level for the clause (contract v0.4), always with a reason.
export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
};

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  verified: 'Quote matched in document',
  unverified: 'Quote not verified',
  none: 'No supporting passage found',
};

export const ANSWER_LABEL: Record<AnswerType, string> = {
  answered: 'Answered from the document',
  not_in_document: 'Document does not specify this',
  ambiguous: 'Unclear in the document',
  needs_professional: 'Needs a qualified professional',
  out_of_scope: 'Outside what this tool can answer',
};

export function passageLocation(p: { page: number | null; section: string | null }): string {
  const parts: string[] = [];
  if (p.page !== null) parts.push(`Page ${p.page}`);
  if (p.section) parts.push(p.section);
  return parts.length ? parts.join(' · ') : 'Location not available';
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
