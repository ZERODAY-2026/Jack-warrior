import { describe, expect, it } from 'vitest';
import { checkFile, checkText, formatBytes } from '../src/utils/validateFile';

const rules = { maxBytes: 100, acceptedExtensions: ['.pdf', '.docx', '.txt'] };

describe('checkFile', () => {
  it('accepts a TXT and a PDF within limits', () => {
    expect(checkFile(new File(['abc'], 'a.txt', { type: 'text/plain' }), rules)).toEqual({ ok: true });
    expect(checkFile(new File(['%PDF'], 'b.PDF', { type: 'application/pdf' }), rules)).toEqual({ ok: true });
  });
  it('accepts .docx with the types browsers actually report', () => {
    for (const type of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', '']) {
      expect(checkFile(new File(['PK'], 'lease.docx', { type }), rules)).toEqual({ ok: true });
    }
  });
  it('explains that old .doc files must be converted', () => {
    const r = checkFile(new File(['x'], 'old.doc'), rules);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/saved as \.docx/);
  });
  it('rejects unsupported extensions', () => {
    const r = checkFile(new File(['x'], 'contract.odt'), rules);
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

describe('checkText', () => {
  it('rejects blank and oversized pasted text', () => {
    expect(checkText('   \n', rules).ok).toBe(false);
    expect(checkText('a'.repeat(101), rules).ok).toBe(false);
    expect(checkText('The Tenant shall pay rent.', rules)).toEqual({ ok: true });
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});
