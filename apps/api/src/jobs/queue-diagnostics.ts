import type { Queue } from 'bullmq';

/** One retained failure, without its payload: job data can hold addresses and document content. */
export type QueueFailure = {
  id: string;
  name: string;
  attemptsMade: number;
  failedAt: string | null;
  reason: string | null;
};

const EMAIL_ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_REASON = 300;

/**
 * A failure reason fit for the platform console: email addresses are replaced (SMTP errors quote
 * the recipient) and the text is capped. Stack traces are never returned.
 */
export function redactQueueReason(reason: string | undefined | null): string | null {
  if (!reason) return null;
  const firstLine = reason.split('\n')[0] ?? '';
  const redacted = firstLine.replace(EMAIL_ADDRESS, '[email]');
  return redacted.length > MAX_REASON ? `${redacted.slice(0, MAX_REASON - 1)}…` : redacted;
}

/** When the longest-waiting job was enqueued, or null when nothing is waiting. */
export async function oldestWaitingAt(queue: Queue): Promise<string | null> {
  const [oldest] = await queue.getJobs(['wait'], 0, 0, true);
  return oldest?.timestamp ? new Date(oldest.timestamp).toISOString() : null;
}

/** The most recent retained failures. Exhausted jobs are kept (`removeOnFail: false`). */
export async function recentFailures(queue: Queue, limit = 25): Promise<QueueFailure[]> {
  const jobs = await queue.getJobs(['failed'], 0, limit - 1, false);
  return jobs.map((job) => ({
    id: String(job.id),
    name: job.name,
    attemptsMade: job.attemptsMade,
    failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    reason: redactQueueReason(job.failedReason),
  }));
}
