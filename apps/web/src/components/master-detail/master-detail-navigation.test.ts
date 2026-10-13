import { describe, expect, it } from 'vitest';

import { nextMasterDetailIndex } from './master-detail-navigation';

describe('master-detail keyboard navigation', () => {
  it('moves to the adjacent record and stays within the list bounds', () => {
    expect(nextMasterDetailIndex(1, 3, 'ArrowDown')).toBe(2);
    expect(nextMasterDetailIndex(1, 3, 'ArrowUp')).toBe(0);
    expect(nextMasterDetailIndex(0, 3, 'ArrowUp')).toBe(0);
    expect(nextMasterDetailIndex(2, 3, 'ArrowDown')).toBe(2);
  });

  it('supports Home, End, and an empty result set', () => {
    expect(nextMasterDetailIndex(1, 3, 'Home')).toBe(0);
    expect(nextMasterDetailIndex(1, 3, 'End')).toBe(2);
    expect(nextMasterDetailIndex(0, 0, 'Home')).toBe(-1);
  });
});
