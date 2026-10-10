import { createClient } from 'redis';

const E2E_REDIS_URL = 'redis://127.0.0.1:56780';

/**
 * The API rate-limits logins per account (8 per 15 minutes). The demo owner and demo customer are
 * shared by every spec and every project, so a full run signs each of them in far more than eight
 * times. Every sign-in helper calls this first so a run never trips the limit partway through.
 */
export async function clearAuthRateLimits(): Promise<void> {
  const client = createClient({ url: E2E_REDIS_URL });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({ MATCH: 'auth:*', COUNT: 200 })) {
      const batch = Array.isArray(keys) ? keys : [keys];
      if (batch.length > 0) await client.del(batch);
    }
  } finally {
    await client.quit();
  }
}
