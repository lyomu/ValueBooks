import { describe, expect, it } from 'vitest';

import { redactQueueReason } from '../src/jobs/queue-diagnostics.js';

describe('redactQueueReason', () => {
  it('removes email addresses and keeps only the first line', () => {
    expect(
      redactQueueReason(
        '550 5.1.1 <jane.doe+books@example.co.ke>: Recipient address rejected\n    at Smtp.send (smtp.js:1:1)',
      ),
    ).toBe('550 5.1.1 <[email]>: Recipient address rejected');
  });

  it('caps long reasons and keeps empty ones empty', () => {
    expect(redactQueueReason('x'.repeat(400))).toHaveLength(300);
    expect(redactQueueReason(undefined)).toBeNull();
    expect(redactQueueReason('')).toBeNull();
  });
});
