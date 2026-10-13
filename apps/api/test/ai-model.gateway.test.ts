import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiModelGateway, type AiGatewayException } from '../src/ai/ai-model.gateway';
import type { AiProviderControlsService } from '../src/ai/ai-provider-controls.service';
import type { HostedAiEgressApprovalService } from '../src/platform/hosted-ai-egress-approval.service';

const ORGANIZATION_ID = 'org-1';

function fakeHostedEgressApprovals(isEnabled = false): HostedAiEgressApprovalService {
  return {
    isEnabled: vi.fn().mockResolvedValue(isEnabled),
  } as unknown as HostedAiEgressApprovalService;
}

type FakeProviderControls = AiProviderControlsService & {
  readonly testIsCircuitOpen: ReturnType<typeof vi.fn>;
  readonly testReserveTokens: ReturnType<typeof vi.fn>;
};

function fakeProviderControls(): FakeProviderControls {
  const testIsCircuitOpen = vi.fn().mockResolvedValue(false);
  const testReserveTokens = vi.fn().mockResolvedValue(undefined);
  return {
    isCircuitOpen: testIsCircuitOpen,
    recordFailure: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    reserveTokens: testReserveTokens,
    testIsCircuitOpen,
    testReserveTokens,
  } as unknown as FakeProviderControls;
}

const evidence = {
  reportKey: 'financial.general-ledger',
  filters: { from: '2026-01-01', to: '2026-12-31' },
  baseCurrency: 'KES',
  totals: { debitMinor: '12500', creditMinor: '12500' },
  rows: [
    {
      id: 'journal-line-1',
      cells: { description: 'Fixture entry', debitMinor: '12500', creditMinor: '0' },
      source: { entityType: 'JournalEntry', entityId: 'journal-1' },
    },
  ],
} as const;

const hostedEvidence = {
  ...evidence,
  reportKey: 'financial.profit-loss',
  filters: { from: '2026-01-01', projectId: 'project-private-id' },
  rows: [
    {
      id: 'journal-line-private-id',
      cells: { account: 'Customer Smith', description: 'secret free-text', amountMinor: '12500' },
      source: { entityType: 'JournalEntry', entityId: 'journal-private-id' },
    },
  ],
} as const;

describe('AiModelGateway', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is disabled by default and does not make a provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AiModelGateway(
      new ConfigService({ AI_MODE: 'off' }),
      fakeHostedEgressApprovals(),
      fakeProviderControls(),
    );

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_DISABLED',
    } satisfies Partial<AiGatewayException>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI_MODE=hosted_limited with the egress flag unset still behaves as disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AiModelGateway(
      new ConfigService({
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
        AI_HOSTED_API_KEY: 'hosted-api-key',
        AI_REQUEST_TIMEOUT_MS: 1_000,
      }),
      fakeHostedEgressApprovals(false),
      fakeProviderControls(),
    );

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_DISABLED',
    } satisfies Partial<AiGatewayException>);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(gateway.isHostedEgressEnabled(ORGANIZATION_ID)).resolves.toBe(false);
  });

  it('AI_MODE=hosted_limited with the egress flag enabled calls the hosted DeepSeek endpoint', async () => {
    const content = JSON.stringify({
      summary: 'The supplied entry supports the reported activity.',
      citationIds: ['row-1'],
      abstained: false,
    });
    let requestUrl: string | undefined;
    let requestBody: string | undefined;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      requestUrl = input;
      requestBody = typeof init?.body === 'string' ? init.body : undefined;
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AiModelGateway(
      new ConfigService({
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
        AI_HOSTED_API_KEY: 'hosted-api-key',
        AI_REQUEST_TIMEOUT_MS: 1_000,
      }),
      fakeHostedEgressApprovals(true),
      fakeProviderControls(),
    );

    const result = await gateway.explain('Explain this report.', hostedEvidence, ORGANIZATION_ID);

    expect(result).toMatchObject({ citationIds: ['journal-line-private-id'] });
    expect(requestUrl).toBe('https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(requestBody ?? '{}') as unknown as {
      messages?: { content?: string }[];
    };
    const sentEvidence = (
      JSON.parse(payload.messages?.[1]?.content ?? '{}') as unknown as {
        evidence?: { rows: unknown; filters: unknown };
      }
    ).evidence as { rows: unknown; filters: unknown };
    expect(sentEvidence.rows).toEqual([
      { id: 'row-1', cells: { amountMinor: '12500' }, source: null },
    ]);
    expect(sentEvidence.filters).toEqual({ from: '2026-01-01' });
    expect(requestBody).not.toContain('Customer Smith');
    expect(requestBody).not.toContain('secret free-text');
    expect(requestBody).not.toContain('journal-private-id');
    expect(requestBody).not.toContain('project-private-id');
    await expect(gateway.isHostedEgressEnabled(ORGANIZATION_ID)).resolves.toBe(true);
  });

  it('uses the private OpenAI-compatible endpoint without exposing tools', async () => {
    const content = JSON.stringify({
      summary: 'The supplied entry supports the reported activity.',
      citationIds: ['journal-line-1'],
      abstained: false,
    });
    let requestBody: string | undefined;
    let requestUrl: string | undefined;
    let authorizationHeader: string | undefined;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      requestUrl = input;
      requestBody = typeof init?.body === 'string' ? init.body : undefined;
      authorizationHeader = new Headers(init?.headers).get('authorization') ?? undefined;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 21, completion_tokens: 13 },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AiModelGateway(
      new ConfigService({
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'http://deepseek.private.test/v1',
        AI_PRIVATE_MODEL: 'deepseek-local',
        AI_PRIVATE_API_KEY: 'private-api-key',
        AI_REQUEST_TIMEOUT_MS: 1_000,
        AI_MAX_CONTEXT_ROWS: 25,
      }),
      fakeHostedEgressApprovals(),
      fakeProviderControls(),
    );

    const result = await gateway.explain('Explain this report.', evidence, ORGANIZATION_ID);

    expect(result).toMatchObject({
      summary: 'The supplied entry supports the reported activity.',
      citationIds: ['journal-line-1'],
      inputTokens: 21,
      outputTokens: 13,
    });
    expect(gateway.maxContextRows()).toBe(25);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestUrl).toBe('http://deepseek.private.test/v1/chat/completions');
    expect(authorizationHeader).toBe('Bearer private-api-key');
    expect(requestBody).toContain('"model":"deepseek-local"');
    expect(requestBody).toContain('"temperature":0');
    expect(requestBody).toContain('"max_tokens":500');
    expect(requestBody).not.toContain('"tools"');
    expect(requestBody).toContain('untrusted data');
  });

  it('rejects malformed provider output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
          status: 200,
        }),
      ),
    );
    const gateway = new AiModelGateway(
      new ConfigService({
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'http://deepseek.private.test/v1',
        AI_PRIVATE_MODEL: 'deepseek-local',
        AI_REQUEST_TIMEOUT_MS: 1_000,
      }),
      fakeHostedEgressApprovals(),
      fakeProviderControls(),
    );

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_RESPONSE_INVALID',
    } satisfies Partial<AiGatewayException>);
  });

  it('retries a transient provider failure once before accepting a response', async () => {
    const content = JSON.stringify({
      summary: 'The supplied entry supports the reported activity.',
      citationIds: ['journal-line-1'],
      abstained: false,
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('private endpoint unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = privateGateway({ AI_MAX_RETRIES: 1 });

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).resolves.toMatchObject({
      citationIds: ['journal-line-1'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the shared circuit after bounded transient failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const controls = fakeProviderControls();
    controls.testIsCircuitOpen
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const gateway = privateGateway(
      { AI_MAX_RETRIES: 0, AI_CIRCUIT_FAILURE_THRESHOLD: 2 },
      controls,
    );

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_HTTP_FAILURE',
    } satisfies Partial<AiGatewayException>);
    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_HTTP_FAILURE',
    } satisfies Partial<AiGatewayException>);
    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_CIRCUIT_OPEN',
    } satisfies Partial<AiGatewayException>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized serialized request before it reaches the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controls = fakeProviderControls();
    const gateway = privateGateway({ AI_MAX_REQUEST_BYTES: 10 }, controls);

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_REQUEST_TOO_LARGE',
    } satisfies Partial<AiGatewayException>);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(controls.testReserveTokens).not.toHaveBeenCalled();
  });

  it('blocks a hosted report key that has not been approved for limited egress', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new AiModelGateway(
      new ConfigService({
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
        AI_REQUEST_TIMEOUT_MS: 1_000,
      }),
      fakeHostedEgressApprovals(true),
      fakeProviderControls(),
    );

    await expect(
      gateway.explain('Explain this report.', evidence, ORGANIZATION_ID),
    ).rejects.toMatchObject({
      failureCode: 'MODEL_HOSTED_REPORT_NOT_APPROVED',
    } satisfies Partial<AiGatewayException>);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function privateGateway(
  overrides: Record<string, unknown> = {},
  controls = fakeProviderControls(),
): AiModelGateway {
  return new AiModelGateway(
    new ConfigService({
      AI_MODE: 'private',
      AI_PRIVATE_ENDPOINT: 'http://deepseek.private.test/v1',
      AI_PRIVATE_MODEL: 'deepseek-local',
      AI_REQUEST_TIMEOUT_MS: 1_000,
      AI_MAX_CONTEXT_ROWS: 25,
      AI_MAX_RETRIES: 0,
      AI_CIRCUIT_FAILURE_THRESHOLD: 3,
      AI_CIRCUIT_OPEN_MS: 1_000,
      AI_MAX_REQUEST_BYTES: 48_000,
      AI_MAX_OUTPUT_TOKENS: 500,
      AI_ORGANIZATION_DAILY_TOKEN_LIMIT: 50_000,
      AI_ORGANIZATION_DAILY_ALERT_PERCENT: 80,
      ...overrides,
    }),
    fakeHostedEgressApprovals(),
    controls,
  );
}
