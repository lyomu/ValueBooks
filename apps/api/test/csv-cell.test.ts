import { describe, expect, it } from 'vitest';

import { escapeCsvCell } from '../src/common/csv-cell.js';

describe('escapeCsvCell', () => {
  it('passes safe primitive values through unchanged', () => {
    expect(escapeCsvCell('Acme Retail')).toBe('Acme Retail');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(42n)).toBe('42');
    expect(escapeCsvCell(true)).toBe('true');
  });

  it('renders null and undefined as an empty cell', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('RFC 4180-quotes a value containing a comma, quote, or newline', () => {
    expect(escapeCsvCell('Smith, John')).toBe('"Smith, John"');
    expect(escapeCsvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('prefixes a leading formula-trigger character with a single quote', () => {
    // The payload also contains embedded quotes, so it is RFC 4180-wrapped on top of the prefix.
    expect(escapeCsvCell('=cmd|"/c calc"!A1')).toBe('"\'=cmd|""/c calc""!A1"');
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-1-1')).toBe("'-1-1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('\tmalicious')).toBe("'\tmalicious");
  });

  it('does not treat a mid-string formula character as dangerous', () => {
    expect(escapeCsvCell('Invoice #42 = paid')).toBe('Invoice #42 = paid');
  });

  it('both prefixes and RFC 4180-quotes when a formula-triggering value also needs quoting', () => {
    expect(escapeCsvCell('=A1,"B1"')).toBe('"\'=A1,""B1"""');
  });

  it('stringifies an unrecognized value shape rather than throwing', () => {
    // JSON.stringify's own quotes trigger RFC 4180 wrapping too.
    expect(escapeCsvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
