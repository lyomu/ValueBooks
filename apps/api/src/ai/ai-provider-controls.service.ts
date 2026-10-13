import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

export class AiProviderControlError extends Error {
  constructor(readonly code: 'MODEL_USAGE_LIMIT_REACHED' | 'MODEL_USAGE_CONTROL_UNAVAILABLE') {
    super(code);
  }
}

/**
 * Shared, deliberately content-free provider controls. Redis is required before a provider request
 * can leave this process: falling back to process-local accounting would let a tenant bypass its
 * limit by spreading traffic across API instances.
 */
@Injectable()
export class AiProviderControlsService implements OnModuleDestroy {
  private readonly logger = new Logger(AiProviderControlsService.name);
  private readonly client: RedisClientType;

  constructor(private readonly config: ConfigService) {
    this.client = createClient({
      url: config.getOrThrow<string>('REDIS_URL'),
      socket: { connectTimeout: 750, reconnectStrategy: false },
    });
    this.client.on('error', () => undefined);
  }

  async isCircuitOpen(providerKey: string): Promise<boolean> {
    try {
      const client = await this.redis();
      return (await client.get(this.circuitOpenKey(providerKey))) !== null;
    } catch {
      // Do not turn a Redis outage into an egress bypass.
      return true;
    }
  }

  async recordFailure(providerKey: string): Promise<void> {
    try {
      const client = await this.redis();
      const failuresKey = this.circuitFailuresKey(providerKey);
      const failures = await client.incr(failuresKey);
      const openMs = this.config.getOrThrow<number>('AI_CIRCUIT_OPEN_MS');
      if (failures === 1) await client.pExpire(failuresKey, openMs);
      if (failures >= this.config.getOrThrow<number>('AI_CIRCUIT_FAILURE_THRESHOLD')) {
        await client.set(this.circuitOpenKey(providerKey), '1', { PX: openMs });
        await client.del(failuresKey);
        this.logger.warn({
          event: 'ai_provider_circuit_open',
          provider: this.providerHash(providerKey),
        });
      }
    } catch {
      // isCircuitOpen fails closed while coordination is unavailable.
    }
  }

  async recordSuccess(providerKey: string): Promise<void> {
    try {
      const client = await this.redis();
      await client.del([this.circuitFailuresKey(providerKey), this.circuitOpenKey(providerKey)]);
    } catch {
      // A future request will fail closed if Redis remains unavailable.
    }
  }

  async reserveTokens(
    organizationId: string,
    requestBytes: number,
    maxOutputTokens: number,
  ): Promise<void> {
    const estimatedInputTokens = Math.ceil(requestBytes / 4);
    const requestedTokens = estimatedInputTokens + maxOutputTokens;
    const limit = this.config.getOrThrow<number>('AI_ORGANIZATION_DAILY_TOKEN_LIMIT');
    try {
      const client = await this.redis();
      const key = this.usageKey(organizationId);
      const used = await client.incrBy(key, requestedTokens);
      if (used === requestedTokens) await client.expire(key, secondsToUtcMidnight());
      const alertAt = Math.ceil(
        (limit * this.config.getOrThrow<number>('AI_ORGANIZATION_DAILY_ALERT_PERCENT')) / 100,
      );
      if (used >= alertAt && used - requestedTokens < alertAt) {
        this.logger.warn({
          event: 'ai_organization_usage_threshold',
          organizationId,
          usedTokens: used,
          limitTokens: limit,
        });
      }
      if (used > limit) throw new AiProviderControlError('MODEL_USAGE_LIMIT_REACHED');
    } catch (error) {
      if (error instanceof AiProviderControlError) throw error;
      throw new AiProviderControlError('MODEL_USAGE_CONTROL_UNAVAILABLE');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  private async redis(): Promise<RedisClientType> {
    if (!this.client.isOpen) await this.client.connect();
    return this.client;
  }

  private prefix(): string {
    return `${this.config.getOrThrow<string>('QUEUE_PREFIX')}:ai`;
  }

  private providerHash(providerKey: string): string {
    return createHash('sha256').update(providerKey).digest('hex');
  }

  private circuitOpenKey(providerKey: string): string {
    return `${this.prefix()}:circuit:open:${this.providerHash(providerKey)}`;
  }

  private circuitFailuresKey(providerKey: string): string {
    return `${this.prefix()}:circuit:failures:${this.providerHash(providerKey)}`;
  }

  private usageKey(organizationId: string): string {
    return `${this.prefix()}:usage:${organizationId}:${new Date().toISOString().slice(0, 10)}`;
  }
}

function secondsToUtcMidnight(now = new Date()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}
