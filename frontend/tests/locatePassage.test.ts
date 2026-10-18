import { describe, expect, it } from 'vitest';
import { locatePassage } from '../src/components/evidence/locatePassage';
import { documentText, PAGE_1, PAGE_2 } from './fixtures/responses';

const doc = documentText();
const quote = 'Either party may terminate this agreement by providing thirty (30) days written notice.';

describe('locatePassage', () => {
  it('uses offsets when they match the quote', () => {
    const r = locatePassage(doc, { text: quote, page: 2, section: null, char_start: PAGE_1.length, char_end: PAGE_1.length + quote.length, verified: true });
    expect(r).toEqual({ pageIndex: 1, start: 0, end: quote.length, method: 'offsets' });
  });
  it('falls back to a unique exact match when offsets are missing or wrong', () => {
    const r = locatePassage(doc, { text: quote, page: 2, section: null, char_start: 3, char_end: 10, verified: true });
    expect(r?.method).toBe('exact_text');
    expect(PAGE_2.slice(r!.start, r!.end)).toBe(quote);
  });
  it('returns null for text that is not in the document', () => {
    expect(locatePassage(doc, { text: 'The landlord pays all utilities.', page: 1, section: null, char_start: null, char_end: null, verified: false })).toBeNull();
  });
});
