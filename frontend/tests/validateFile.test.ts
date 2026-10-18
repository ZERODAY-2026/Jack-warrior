import { describe, expect, it } from 'vitest';
import { checkFile, formatBytes } from '../src/utils/validateFile';

const rules = { maxBytes: 100, acceptedExtensions: ['.pdf', '.txt'] };

describe('checkFile', () => {
  it('accepts a TXT and a PDF within limits', () => {
    expect(checkFile(new File(['abc'], 'a.txt', { type: 'text/plain' }), rules)).toEqual({ ok: true });
    expect(checkFile(new File(['%PDF'], 'b.PDF', { type: 'application/pdf' }), rules)).toEqual({ ok: true });
  });
  it('rejects unsupported extensions', () => {
    const r = checkFile(new File(['x'], 'contract.docx'), rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not supported/);
  });
  it('rejects a renamed file whose type does not match', () => {
    const r = checkFile(new File(['x'], 'fake.pdf', { type: 'image/png' }), rules);
    expect(r.ok).toBe(false);
  });
  it('rejects empty and oversized files', () => {
    expect(checkFile(new File([], 'empty.txt', { type: 'text/plain' }), rules).ok).toBe(false);
    const big = checkFile(new File(['x'.repeat(101)], 'big.txt', { type: 'text/plain' }), rules);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toMatch(/limit is 100 B/);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});
