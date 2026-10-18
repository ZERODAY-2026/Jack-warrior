import { describe, expect, it } from 'vitest';
import { api, ApiError } from '../src/services/api';
import { analysis, health } from './fixtures/responses';
import { json, mockBackend, textFile } from './helpers';

describe('api client', () => {
  it('parses a valid health response', async () => {
    mockBackend({ 'GET /api/health': () => json(health()) });
    const h = await api.health();
    expect(h.model.state).toBe('ready');
  });

  it('uploads as multipart without setting Content-Type by hand', async () => {
    const { calls } = mockBackend({ 'POST /api/documents': () => json(analysis()) });
    await api.analyze(textFile());
    const init = calls[0]!.init!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('turns the error envelope into an ApiError with the backend message', async () => {
    mockBackend({
      'POST /api/documents': () =>
        json({ error: { code: 'encrypted_pdf', message: 'This PDF is password-protected.' } }, 400),
    });
    await expect(api.analyze(textFile('x.pdf'))).rejects.toMatchObject({
      code: 'encrypted_pdf',
      message: 'This PDF is password-protected.',
      status: 400,
    });
  });

  it('reports an unreachable backend', async () => {
    mockBackend({});
    await expect(api.health()).rejects.toMatchObject({ code: 'backend_unreachable' });
  });

  it('treats an empty proxy 502 as backend unreachable', async () => {
    mockBackend({ 'GET /api/health': () => new Response('', { status: 502 }) });
    await expect(api.health()).rejects.toMatchObject({ code: 'backend_unreachable' });
  });

  it('rejects malformed responses instead of rendering them', async () => {
    const bad = analysis() as unknown as Record<string, unknown>;
    (bad.findings as Record<string, unknown>[])[0]!.classification = 'definitely_true';
    mockBackend({ 'POST /api/documents': () => json(bad) });
    const err = await api.analyze(textFile()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('malformed_response');
  });

  it('rejects non-JSON success bodies', async () => {
    mockBackend({ 'GET /api/health': () => new Response('<html>oops</html>', { status: 200 }) });
    await expect(api.health()).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('downgrades evidence to "none" when a finding has no passages', async () => {
    const a = analysis();
    a.findings[0]!.source_passages = [];
    mockBackend({ 'POST /api/documents': () => json(a) });
    const res = await api.analyze(textFile());
    expect(res.findings[0]!.evidence_status).toBe('none');
  });

  it('downgrades "verified" when any passage is unverified', async () => {
    const a = analysis();
    a.findings[0]!.source_passages[0]!.verified = false;
    mockBackend({ 'POST /api/documents': () => json(a) });
    const res = await api.analyze(textFile());
    expect(res.findings[0]!.evidence_status).toBe('unverified');
  });

  it('accepts a v0.1 response without the v0.2 additive fields', async () => {
    const a = analysis() as unknown as Record<string, unknown>;
    delete a.glossary;
    a.processing = { model: 'm', duration_ms: 1 };
    mockBackend({ 'POST /api/documents': () => json(a) });
    const res = await api.analyze(textFile());
    expect(res.glossary).toEqual([]);
    expect(res.processing.quotes_rejected).toBeNull();
  });

  it('encodes document ids in paths', async () => {
    const { calls } = mockBackend({
      'DELETE /api/documents/a%2Fb': () => json({ deleted: true, removed: [] }),
    });
    await api.deleteDocument('a/b');
    expect(calls[0]!.url).toBe('/api/documents/a%2Fb');
  });
});
