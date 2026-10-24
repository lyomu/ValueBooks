import { describe, expect, it } from 'vitest';

import { formatMinor, minorToDecimal, parseDecimalToMinor } from './money';

describe('parseDecimalToMinor', () => {
  it('converts typed amounts to minor units exactly', () => {
    expect(parseDecimalToMinor('12')).toBe('1200');
    expect(parseDecimalToMinor('12.5')).toBe('1250');
    expect(parseDecimalToMinor(' 0.07 ')).toBe('7');
    // Beyond 2^53: a float round trip would land on ...992.
    expect(parseDecimalToMinor('90071992547409.93')).toBe('9007199254740993');
  });

  it('refuses anything it would otherwise have to guess at', () => {
    for (const value of ['', '12.505', '-1', '1,000', '1e3', '.5', '12.', 'abc']) {
      expect(parseDecimalToMinor(value)).toBeNull();
    }
  });
});

describe('minorToDecimal and formatMinor', () => {
  it('round-trips with the parser and keeps the sign', () => {
    expect(minorToDecimal('9007199254740743')).toBe('90071992547407.43');
    expect(parseDecimalToMinor(minorToDecimal('9007199254740743'))).toBe('9007199254740743');
    expect(minorToDecimal('-250')).toBe('-2.50');
    expect(formatMinor('-250', 'NGN')).toBe('-NGN 2.50');
  });
});
