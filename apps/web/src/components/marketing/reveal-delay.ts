const STAGGER_STEP_MS = 70;
const STAGGER_MAX_MS = 420;

/** Delay (ms) for the nth item in a staggered marketing reveal. */
export function revealDelay(index: number) {
  return Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS);
}
