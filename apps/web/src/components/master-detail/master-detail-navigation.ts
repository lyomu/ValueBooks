export type MasterDetailNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** Returns the bounded list index for shared master-detail keyboard navigation. */
export function nextMasterDetailIndex(
  currentIndex: number,
  length: number,
  key: MasterDetailNavigationKey,
): number {
  if (length <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return Math.min(Math.max(0, currentIndex + (key === 'ArrowDown' ? 1 : -1)), length - 1);
}
