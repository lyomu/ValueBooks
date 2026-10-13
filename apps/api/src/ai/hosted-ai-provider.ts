import type { ConfigService } from '@nestjs/config';

/**
 * A reviewed hosted-provider adapter. Adding a provider means adding one of these fixed profiles
 * and its legal/egress approval path; an environment variable can select a profile but can never
 * redirect customer data to an arbitrary URL.
 */
export interface HostedAiProvider {
  readonly id: 'DEEPSEEK';
  readonly endpoint: string;
  model(config: ConfigService): string;
  apiKey(config: ConfigService): string | undefined;
}

const DEEPSEEK: HostedAiProvider = {
  id: 'DEEPSEEK',
  endpoint: 'https://api.deepseek.com',
  model: (config) => config.getOrThrow<string>('AI_HOSTED_MODEL'),
  apiKey: (config) => config.get<string>('AI_HOSTED_API_KEY'),
};

const HOSTED_PROVIDERS: Readonly<Record<HostedAiProvider['id'], HostedAiProvider>> = {
  DEEPSEEK,
};

export function hostedProviderFor(config: ConfigService): HostedAiProvider {
  // The config schema admits only registered IDs. The default keeps existing deployments inert.
  const id = (config.get<string>('AI_HOSTED_PROVIDER') ?? 'DEEPSEEK').toUpperCase();
  const provider = HOSTED_PROVIDERS[id as HostedAiProvider['id']];
  if (!provider) throw new Error('Configured hosted AI provider is not registered.');
  return provider;
}
