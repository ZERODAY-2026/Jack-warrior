// Test-only fixtures shaped like docs/api-contract.md. The app never imports this file.
// The text is a short synthetic rental clause written for these tests.
import type { AnalysisResult, AskResponse, DocumentText, DocumentTypeOption, HealthResponse } from '../../src/types/api';

export const PAGE_1 = 'RENTAL AGREEMENT\nThe Tenant shall pay rent of 12,000 on or before the 5th day of each month.\n';
export const PAGE_2 =
  'Either party may terminate this agreement by providing thirty (30) days written notice.\nA reasonable fee may apply for late payment.\n';

export const health = (state: HealthResponse['model']['state'] = 'ready'): HealthResponse => ({
  status: state === 'ready' ? 'ok' : 'degraded',
  version: '0.1.0',
  model: {
    state,
    name: 'gemma-3n-E2B-it',
    runtime: 'llama.cpp',
    quantization: 'Q4_K_M',
    detail: state === 'not_installed' ? 'Model file not found. Run the model setup script.' : null,
    parameter_size: '5B (E2B effective 2B)',
  },
  limits: { max_file_bytes: 1024 * 1024, max_pages: 60, accepted_extensions: ['.pdf', '.docx', '.txt'], max_question_chars: 300, ocr_supported: false, accepts_pasted_text: true },
  privacy: {
    bind_host: '127.0.0.1',
    telemetry_enabled: false,
    outbound_network_required: false,
    egress_guard_active: true,
    blocked_outbound_attempts: 0,
    storage: 'memory_only',
  },
});

const termStart = PAGE_1.length;
const termText = 'Either party may terminate this agreement by providing thirty (30) days written notice.';

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
  { id: 'rental', label: 'Rental or lease agreement' },
  { id: 'employment', label: 'Employment contract or offer letter' },
  { id: 'legal_notice', label: 'Legal or demand notice' },
  { id: 'nda', label: 'Non-disclosure agreement' },
  { id: 'general', label: 'Other legal document' },
];

export const analysis = (
  id = 'd_test1',
  filename = 'lease.txt',
  type: AnalysisResult['document_type'] = {
    id: 'rental',
    label: 'Rental or lease agreement',
    source: 'detected',
    detected_id: 'rental',
    confidence: 'high',
    alternatives: [],
  },
): AnalysisResult => ({
  document_id: id,
  document_type: type,
  document: {
    filename,
    file_type: 'txt',
    size_bytes: 230,
    page_count: 2,
    char_count: PAGE_1.length + PAGE_2.length,
    extraction: { status: 'complete', unreadable_pages: [] },
  },
  summary: {
    text: `Summary for ${filename}: a monthly rental with a 30-day termination notice.`,
    document_type_guess: 'rental agreement',
    limitations: ['Covers the extracted text only.'],
  },
  findings: [
    {
      id: 'f_term',
      category: 'termination',
      title: 'Termination with 30 days notice',
      explanation: 'Either side can end the agreement with 30 days written notice.',
      classification: 'explicit',
      priority: 'high',
      priority_reason: 'Controls how you can leave the agreement.',
      evidence_status: 'verified',
      source_passages: [
        { text: termText, page: 2, section: null, char_start: termStart, char_end: termStart + termText.length, verified: true },
      ],
      limitations: [],
      next_step: null,
      impact: 'You must plan a month ahead if you want to move out.',
    },
    {
      id: 'f_fee',
      category: 'ambiguity',
      title: 'Late fee amount is not defined',
      explanation: 'The document mentions a "reasonable fee" without an amount.',
      classification: 'concern',
      priority: 'medium',
      priority_reason: 'Unclear costs if rent is late.',
      evidence_status: 'verified',
      source_passages: [
        { text: 'A reasonable fee may apply for late payment.', page: 2, section: null, char_start: null, char_end: null, verified: true },
      ],
      limitations: ['What counts as reasonable may depend on local law.'],
      next_step: 'Ask the landlord to state the fee in writing.',
      impact: null,
    },
    {
      id: 'f_deposit',
      category: 'other',
      title: 'Deposit return',
      explanation: 'The deposit return timeline could not be established.',
      classification: 'not_established',
      priority: 'low',
      priority_reason: 'Reference only.',
      evidence_status: 'none',
      source_passages: [],
      limitations: [],
      next_step: null,
      impact: null,
    },
  ],
  glossary: [
    {
      term: 'Written notice',
      explanation: 'A notice given on paper or by a written message, not just verbally.',
      source_passages: [
        { text: termText, page: 2, section: null, char_start: termStart, char_end: termStart + termText.length, verified: true },
      ],
    },
  ],
  not_found: [{ topic: 'Security deposit refund timeline', note: 'Not found in the reviewed text.' }],
  warnings: [],
  processing: {
    model: 'gemma-3n-E2B-it',
    duration_ms: 42000,
    runtime: 'llama.cpp',
    model_calls: 4,
    chunks_total: 3,
    chunks_analysed: 3,
    quotes_rejected: 1,
  },
  disclaimer: 'Informational assistance only. Not legal advice.',
});

export const documentText = (id = 'd_test1'): DocumentText => ({
  document_id: id,
  pages: [
    { page: 1, char_start: 0, text: PAGE_1 },
    { page: 2, char_start: PAGE_1.length, text: PAGE_2 },
  ],
});

export const notInDocument: AskResponse = {
  question: 'Is there a pet policy?',
  answer: 'The document does not say anything about pets.',
  answer_type: 'not_in_document',
  classification: 'not_established',
  source_passages: [],
  limitations: [],
  escalation: null,
  jurisdiction_note: null,
};

export const enforceable: AskResponse = {
  question: 'Is this contract enforceable?',
  answer: 'Whether this agreement is enforceable cannot be decided from the document alone.',
  answer_type: 'needs_professional',
  classification: 'not_established',
  source_passages: [],
  limitations: ['Enforceability depends on facts and law outside the document.'],
  escalation: 'Consult a qualified lawyer in your jurisdiction for an opinion on enforceability.',
  jurisdiction_note: 'Rules on rental agreements differ by state and country.',
};
