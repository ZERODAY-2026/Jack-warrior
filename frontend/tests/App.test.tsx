import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { analysis, DOCUMENT_TYPES, documentText, enforceable, health, notInDocument } from './fixtures/responses';
import { deferred, json, mockBackend, textFile } from './helpers';

const user = () => userEvent.setup({ applyAccept: false });

async function uploadAndAnalyze(u: ReturnType<typeof user>, file = textFile()) {
  await screen.findByRole('button', { name: /model ready/i });
  await u.upload(screen.getByTestId('file-input'), file);
  await u.click(screen.getByRole('button', { name: /analyse document/i }));
}

describe('App workflow', () => {
  it('runs the full flow: upload, summary, evidence, source, question, remove', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json(analysis()),
      'GET /api/documents/d_test1/text': () => json(documentText()),
      'POST /api/documents/d_test1/ask': () => json(notInDocument),
      'DELETE /api/documents/d_test1': () => json({ deleted: true, removed: ['uploaded_file', 'extracted_text'] }),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);

    expect(await screen.findByRole('heading', { level: 1, name: 'lease.txt' })).toBeInTheDocument();
    expect(screen.getByText(/Summary for lease.txt/)).toBeInTheDocument();
    expect(screen.getByText('Security deposit refund timeline')).toBeInTheDocument();

    // Select a finding: the evidence panel shows the document's own words.
    await u.click(screen.getByRole('button', { name: /Termination with 30 days notice/ }));
    const evidence = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(evidence).getByText(/Either party may terminate this agreement/, { selector: 'blockquote' })).toBeInTheDocument();
    expect(within(evidence).getByText('Stated in document')).toBeInTheDocument();
    expect(within(evidence).getByText('Page 2')).toBeInTheDocument();

    // Glossary terms open their passage in the evidence panel too.
    await u.click(screen.getByRole('button', { name: /Written notice/ }));
    expect(within(evidence).getByText('Term explained')).toBeInTheDocument();
    expect(screen.getByText(/1 quote proposed by the model did not match the document/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Termination with 30 days notice/ }));

    // Open the passage in the source viewer: it is highlighted in context.
    await u.click(within(evidence).getByRole('button', { name: /view in document/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Source in document' });
    await waitFor(() => expect(dialog.querySelector('mark')?.textContent).toMatch(/^Either party may terminate/));
    await u.click(within(dialog).getByRole('button', { name: /close source view/i }));

    // A finding without evidence says so instead of inventing a quote.
    await u.click(screen.getByRole('tab', { name: /findings/i }));
    expect(screen.getByText(/Showing 3 of 3 findings/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Deposit return/ }));
    expect(within(evidence).getByText(/No supporting passage found\. Treat this finding/)).toBeInTheDocument();

    // Ask a question the document does not answer.
    await u.click(screen.getByRole('tab', { name: /ask a question/i }));
    await u.type(screen.getByLabelText(/ask about this document/i), 'Is there a pet policy?');
    await u.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText('Document does not specify this')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/ask'))!.init!.body as string)).toEqual({ question: 'Is there a pet policy?' });

    // Remove: backend deletion is confirmed before the app says so.
    await u.click(screen.getByRole('button', { name: /remove document/i }));
    expect(await screen.findByText(/local backend confirmed it deleted its copy/)).toBeInTheDocument();
    expect(screen.queryByText(/Summary for lease.txt/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);

    // Nothing persisted in browser storage, nothing logged.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('shows the backend privacy guard in the privacy panel', async () => {
    mockBackend({ 'GET /api/health': () => json(health()) });
    const u = user();
    render(<App />);
    await u.click(await screen.findByRole('button', { name: /model ready/i }));
    const dialog = screen.getByRole('dialog', { name: /privacy and local processing/i });
    expect(within(dialog).getByText('Outbound network guard').nextSibling).toHaveTextContent('Active');
    expect(within(dialog).getByText('In memory only')).toBeInTheDocument();
    expect(within(dialog).getByText(/not proof that nothing/)).toBeInTheDocument();
  });

  it('shows a clear state when the backend is not running and blocks analysis', async () => {
    mockBackend({});
    const u = user();
    render(<App />);
    expect(await screen.findByText('Local backend not connected', { selector: '.callout__title' })).toBeInTheDocument();
    await u.upload(screen.getByTestId('file-input'), textFile());
    expect(screen.getByRole('button', { name: /analyse document/i })).toBeDisabled();
    expect(screen.getByText('Start the local backend to analyse documents.')).toBeInTheDocument();
  });

  it('explains when the model is not installed', async () => {
    mockBackend({ 'GET /api/health': () => json(health('not_installed')) });
    const u = user();
    render(<App />);
    expect(await screen.findByRole('button', { name: /local model not installed/i })).toBeInTheDocument();
    await u.upload(screen.getByTestId('file-input'), textFile());
    expect(screen.getByRole('button', { name: /analyse document/i })).toBeDisabled();
    expect(screen.getAllByText(/Run the model setup script/).length).toBeGreaterThan(0);
  });

  it('rejects unsupported and oversized files before upload', async () => {
    const { calls } = mockBackend({ 'GET /api/health': () => json(health()) });
    const u = user();
    render(<App />);
    await screen.findByRole('button', { name: /model ready/i });
    await u.upload(screen.getByTestId('file-input'), new File(['x'], 'contract.doc'));
    expect(screen.getByRole('alert')).toHaveTextContent(/not supported.*saved as \.docx/);
    await u.upload(screen.getByTestId('file-input'), new File(['x'.repeat(2 * 1024 * 1024)], 'big.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/limit is 1.0 MB/);
    expect(calls.some((c) => c.url === '/api/documents')).toBe(false);
  });

  it('shows backend extraction errors and offers a different file, not a pointless retry', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () =>
        json({ error: { code: 'no_extractable_text', message: 'This PDF has no text layer. Scanned PDFs are not supported.' } }, 400),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    const alert = await screen.findByText('Analysis failed');
    expect(alert.closest('.callout')).toHaveTextContent(/no text layer/);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /choose a different file/i }));
    expect(screen.getByRole('button', { name: /choose document/i })).toBeInTheDocument();
  });

  it('offers a retry when the model times out', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json({ error: { code: 'timeout', message: 'The local model took too long.' } }, 504),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeEnabled();
  });

  it('prevents duplicate submissions while analysing', async () => {
    const pending = deferred<Response>();
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => pending.promise,
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    expect(await screen.findByText(/Analysing “lease.txt” on this computer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /analyse document/i })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/api/documents')).toHaveLength(1);
    pending.resolve(json(analysis()));
    expect(await screen.findByRole('heading', { level: 1, name: 'lease.txt' })).toBeInTheDocument();
  });

  it('drops a result that arrives after the user cancelled, and deletes it on the backend', async () => {
    const pending = deferred<Response>();
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': (init) =>
        new Promise((resolve, reject) => {
          // Simulate a backend that ignores the abort and still answers.
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          void pending.promise.then(resolve);
        }),
      'DELETE /api/documents/d_late': () => json({ deleted: true, removed: [] }),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    await u.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(await screen.findByText(/Analysis cancelled/)).toBeInTheDocument();
    pending.resolve(json(analysis('d_late')));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { level: 1, name: 'lease.txt' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyse document/i })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('shows escalation and jurisdiction notes for an enforceability question', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json(analysis()),
      'POST /api/documents/d_test1/ask': () => json(enforceable),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    await u.click(await screen.findByRole('tab', { name: /ask a question/i }));
    await u.click(screen.getByRole('button', { name: 'Is this contract enforceable?' }));
    await u.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText('Needs a qualified professional')).toBeInTheDocument();
    expect(screen.getByText(/Consult a qualified lawyer in your jurisdiction/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /show details/i }));
    const evidence = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(evidence).getByText(/Rules on rental agreements differ/)).toBeInTheDocument();
    expect(within(evidence).getByText(/No supporting passage found\. Treat this answer/)).toBeInTheDocument();
  });

  it('says honestly when backend deletion could not be confirmed', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json(analysis()),
      'DELETE /api/documents/d_test1': () => json({ error: { code: 'document_not_found', message: 'Unknown document.' } }, 404),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    await u.click(await screen.findByRole('button', { name: /remove document/i }));
    expect(await screen.findByText(/backend could not confirm deletion: Unknown document\./)).toBeInTheDocument();
  });

  it('shows a malformed-response error instead of partial results', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json({ document_id: 'x', findings: 'nope' }),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    expect(await screen.findByText(/does not understand/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});

describe('Word files and pasted text', () => {
  it('uploads a .docx file and shows it as a Word document', async () => {
    const a = analysis('d_docx', 'lease.docx');
    a.document.file_type = 'docx';
    a.document.page_count = null;
    mockBackend({ 'GET /api/health': () => json(health()), 'POST /api/documents': () => json(a) });
    const u = user();
    render(<App />);
    await screen.findByRole('button', { name: /model ready/i });
    expect(screen.getByText(/Drop a PDF, Word \(\.docx\) or TXT file here/)).toBeInTheDocument();
    await u.upload(
      screen.getByTestId('file-input'),
      new File(['PK'], 'lease.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    );
    expect(screen.getByText(/Word document ·/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /analyse document/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'lease.docx' })).toBeInTheDocument();
    expect(screen.getByText(/DOCX ·/)).toBeInTheDocument();
  });

  it('shows the backend message for a password-protected Word file', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () =>
        json({ error: { code: 'encrypted_document', message: 'This document is password-protected.' } }, 400),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u, new File(['PK'], 'locked.docx', { type: '' }));
    expect(await screen.findByText('This document is password-protected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose a different file/i })).toBeInTheDocument();
  });

  it('analyses pasted text via POST /api/documents/text with the title', async () => {
    const a = analysis('d_paste', 'Clause 7');
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents/text': () => json(a),
    });
    const u = user();
    render(<App />);
    await screen.findByRole('button', { name: /model ready/i });
    await u.click(screen.getByRole('button', { name: /paste text/i }));
    const analyseBtn = screen.getByRole('button', { name: /analyse text/i });
    // Submitting nothing explains what is missing instead of calling the backend.
    await u.click(analyseBtn);
    expect(screen.getByRole('alert')).toHaveTextContent('Paste some text from the document first.');
    expect(calls.some((c) => c.url === '/api/documents/text')).toBe(false);
    await u.type(screen.getByLabelText(/name \(optional\)/i), 'Clause 7');
    await u.type(screen.getByRole('textbox', { name: 'Document text' }), 'Either party may terminate with 30 days notice.');
    await u.click(analyseBtn);
    expect(await screen.findByRole('heading', { level: 1, name: 'Clause 7' })).toBeInTheDocument();
    expect(screen.getByText(/^Pasted text ·/)).toBeInTheDocument();
    const call = calls.find((c) => c.url === '/api/documents/text')!;
    expect(JSON.parse(call.init!.body as string)).toEqual({
      text: 'Either party may terminate with 30 days notice.',
      title: 'Clause 7',
    });
    expect((call.init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('keeps pasted text available to retry after a timeout', async () => {
    let n = 0;
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents/text': () =>
        ++n === 1 ? json({ error: { code: 'timeout', message: 'The local model took too long.' } }, 504) : json(analysis('d_p2', 'Pasted text')),
    });
    const u = user();
    render(<App />);
    await screen.findByRole('button', { name: /model ready/i });
    await u.click(screen.getByRole('button', { name: /paste text/i }));
    await u.type(screen.getByRole('textbox', { name: 'Document text' }), 'Rent is due on the 5th.');
    await u.click(screen.getByRole('button', { name: /analyse text/i }));
    expect(await screen.findByText('The local model took too long.')).toBeInTheDocument();
    expect(screen.getByText(/Pasted text · 23 characters/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pasted text' })).toBeInTheDocument();
  });

  it('hides the paste option for a backend that does not support it', async () => {
    const h = health();
    h.limits.accepts_pasted_text = null;
    mockBackend({ 'GET /api/health': () => json(h) });
    render(<App />);
    await screen.findByRole('button', { name: /model ready/i });
    expect(screen.queryByRole('button', { name: /paste text/i })).not.toBeInTheDocument();
  });
});

describe('Document types (contract v0.4)', () => {
  it('sends the chosen type with an upload and shows what the analysis assumed', async () => {
    const chosen = analysis('d_t1', 'nda.txt', {
      id: 'nda', label: 'Non-disclosure agreement', source: 'user', detected_id: 'general', confidence: 'high', alternatives: [], method: 'user',
    });
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'GET /api/document-types': () => json(DOCUMENT_TYPES),
      'POST /api/documents': () => json(chosen),
    });
    const u = user();
    render(<App />);
    const picker = await screen.findByRole('combobox', { name: 'Document type' });
    expect(picker).toHaveValue('auto');
    await u.selectOptions(picker, 'nda');
    await uploadAndAnalyze(u);
    expect(await screen.findByRole('heading', { level: 1, name: 'nda.txt' })).toBeInTheDocument();
    const body = calls.find((c) => c.url === '/api/documents')!.init!.body as FormData;
    expect(body.get('document_type')).toBe('nda');
    expect(screen.getByText('Non-disclosure agreement', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Chosen by you\. Detected type: Other legal document\./)).toBeInTheDocument();
  });

  it('does not send a type when left on auto-detect, for pasted text too', async () => {
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'GET /api/document-types': () => json(DOCUMENT_TYPES),
      'POST /api/documents/text': () => json(analysis('d_t2', 'Pasted text')),
    });
    const u = user();
    render(<App />);
    await screen.findByRole('combobox', { name: 'Document type' });
    await u.click(screen.getByRole('button', { name: /paste text/i }));
    await u.type(screen.getByRole('textbox', { name: 'Document text' }), 'The employee shall give one month notice.');
    await u.click(screen.getByRole('button', { name: /analyse text/i }));
    await screen.findByRole('heading', { level: 1, name: 'Pasted text' });
    const sent = JSON.parse(calls.find((c) => c.url === '/api/documents/text')!.init!.body as string);
    expect(sent).toEqual({ text: 'The employee shall give one month notice.' });
  });

  it('asks the user to confirm a low-confidence type and re-analyses as the chosen one', async () => {
    const unsure = analysis('d_t3', 'letter.txt', {
      id: 'rental', label: 'Rental or lease agreement', source: 'detected', detected_id: 'rental', confidence: 'low', alternatives: ['legal_notice'], method: 'model',
    });
    const again = analysis('d_t3', 'letter.txt', {
      id: 'legal_notice', label: 'Legal or demand notice', source: 'user', detected_id: 'rental', confidence: 'high', alternatives: [], method: 'user',
    });
    again.summary.text = 'A demand notice asking for unpaid rent within 15 days.';
    const done = deferred<Response>();
    const { calls } = mockBackend({
      'GET /api/health': () => json(health()),
      'GET /api/document-types': () => json(DOCUMENT_TYPES),
      'POST /api/documents': () => json(unsure),
      'POST /api/documents/d_t3/reanalyse': () => done.promise,
    });
    const u = user();
    render(<App />);
    await screen.findByRole('combobox', { name: 'Document type' });
    await uploadAndAnalyze(u);
    await screen.findByRole('heading', { level: 1, name: 'letter.txt' });
    expect(screen.getByText(/it could also be Legal or demand notice/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Termination with 30 days notice/ }));

    await u.selectOptions(screen.getByRole('combobox', { name: 'Analyse as' }), 'legal_notice');
    await u.click(screen.getByRole('button', { name: /analyse again/i }));
    expect(await screen.findByText(/again as: Legal or demand notice/)).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/reanalyse'))!.init!.body as string)).toEqual({ document_type: 'legal_notice' });

    done.resolve(json(again));
    expect(await screen.findByText('A demand notice asking for unpaid rent within 15 days.')).toBeInTheDocument();
    expect(screen.getByText('Legal or demand notice', { selector: 'strong' })).toBeInTheDocument();
    // The earlier selection belonged to the old findings, so the evidence panel starts empty.
    await waitFor(() =>
      expect(within(screen.getByRole('complementary', { name: 'Evidence' })).getByText(/Select a finding/)).toBeInTheDocument(),
    );
  });

  it('keeps the earlier results when re-analysis fails', async () => {
    mockBackend({
      'GET /api/health': () => json(health()),
      'GET /api/document-types': () => json(DOCUMENT_TYPES),
      'POST /api/documents': () => json(analysis()),
      'POST /api/documents/d_test1/reanalyse': () => json({ error: { code: 'analysis_failed', message: 'The model stopped.' } }, 500),
    });
    const u = user();
    render(<App />);
    await screen.findByRole('combobox', { name: 'Document type' });
    await uploadAndAnalyze(u);
    await screen.findByRole('heading', { level: 1, name: 'lease.txt' });
    await u.click(screen.getByRole('button', { name: 'Change type' }));
    await u.selectOptions(screen.getByRole('combobox', { name: 'Analyse as' }), 'employment');
    await u.click(screen.getByRole('button', { name: /analyse again/i }));
    expect(await screen.findByText(/Could not analyse it again: The model stopped\./)).toBeInTheDocument();
    expect(screen.getByText(/Summary for lease.txt/)).toBeInTheDocument();
  });

  it('shows each finding as evidence, explanation, why it matters and suggested action, with no risk level', async () => {
    const a = analysis();
    // Two passages merged into one finding: both are shown.
    a.findings[1]!.source_passages.push({
      text: 'The Tenant shall pay rent of 12,000 on or before the 5th day of each month.', page: 1, section: null, char_start: null, char_end: null, verified: true,
    });
    mockBackend({
      'GET /api/health': () => json(health()),
      'POST /api/documents': () => json(a),
    });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    await screen.findByRole('heading', { level: 1, name: 'lease.txt' });
    expect(screen.queryByRole('combobox', { name: 'Document type' })).not.toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Termination with 30 days notice/ }));
    const evidence = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(evidence).getByText('Evidence from the document')).toBeInTheDocument();
    expect(within(evidence).getByText('Explanation in plain language')).toBeInTheDocument();
    expect(within(evidence).getByText('You must plan a month ahead if you want to move out.')).toBeInTheDocument();

    await u.click(screen.getByRole('tab', { name: /findings/i }));
    expect(screen.getByText(/in document order/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /risk/i })).not.toBeInTheDocument();
    const card = screen.getByRole('button', { name: /Late fee amount/ });
    expect(within(card).getByText('2 passages')).toBeInTheDocument();
    expect(within(card).getByText(/The Tenant shall pay rent of 12,000/)).toBeInTheDocument();
    await u.click(card);
    expect(within(evidence).getAllByRole('blockquote')).toHaveLength(2);
    expect(within(evidence).getByText(/Ask the landlord to state the fee in writing/)).toBeInTheDocument();
    expect(within(evidence).queryByText('Why it matters')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/risk/i);
  });

  it('opens the type picker when the type could not be detected', async () => {
    const a = analysis('d_fb', 'scan.txt', {
      id: 'general', label: 'Other legal document', source: 'detected', detected_id: 'general', confidence: 'high', alternatives: [], method: 'fallback',
    });
    mockBackend({
      'GET /api/health': () => json(health()),
      'GET /api/document-types': () => json(DOCUMENT_TYPES),
      'POST /api/documents': () => json(a),
    });
    const u = user();
    render(<App />);
    await screen.findByRole('combobox', { name: 'Document type' });
    await uploadAndAnalyze(u);
    await screen.findByRole('heading', { level: 1, name: 'scan.txt' });
    expect(screen.getByText(/could not be detected/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Analyse as' })).toBeInTheDocument();
  });

  it('explains a topic the document does not address instead of calling it unsupported', async () => {
    const a = analysis();
    a.findings.push({
      id: 'f_absent', category: 'concern', title: 'Not addressed: Pets', explanation: 'Rental agreements often cover pets; this one does not mention them.',
      classification: 'not_established',
      evidence_status: 'none', source_passages: [], limitations: [], next_step: 'Ask the landlord whether pets are allowed.', impact: null,
    });
    mockBackend({ 'GET /api/health': () => json(health()), 'POST /api/documents': () => json(a) });
    const u = user();
    render(<App />);
    await uploadAndAnalyze(u);
    await screen.findByRole('heading', { level: 1, name: 'lease.txt' });
    await u.click(screen.getByRole('tab', { name: /findings/i }));
    expect(screen.getByText('Not found in the document')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: /Not addressed: Pets/ }));
    const evidence = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(evidence).getByText(/not found anywhere in the document/)).toBeInTheDocument();
    expect(within(evidence).queryByText(/Treat this finding with extra caution/)).not.toBeInTheDocument();
  });
});
