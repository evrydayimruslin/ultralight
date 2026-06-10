import { describe, expect, it } from 'vitest';
import { formatUpdateDate, summarizeUpdateNotes } from './updater';

describe('summarizeUpdateNotes', () => {
  it('returns null for empty notes', () => {
    expect(summarizeUpdateNotes('   ')).toBeNull();
  });

  it('collapses whitespace and preserves short notes', () => {
    expect(summarizeUpdateNotes('Fixes\n\nlogin   retries.')).toBe('Fixes login retries.');
  });

  it('truncates long notes cleanly', () => {
    expect(summarizeUpdateNotes('a'.repeat(230), 32)).toBe(`${'a'.repeat(31)}...`);
  });
});

describe('formatUpdateDate', () => {
  it('returns null for invalid dates', () => {
    expect(formatUpdateDate('not-a-date')).toBeNull();
  });

  it('formats RFC3339 dates for the updater toast', () => {
    expect(formatUpdateDate('2026-04-18T17:04:00Z')).toBe('Apr 18, 2026');
  });
});
