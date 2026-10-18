import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { analysis, documentText, enforceable, health, notInDocument } from './fixtures/responses';
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
    await u.upload(screen.getByTestId('file-input'), new File(['x'], 'contract.docx'));
    expect(screen.getByRole('alert')).toHaveTextContent(/not supported/);
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
