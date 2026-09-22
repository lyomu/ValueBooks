import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  transpilePackages: ['@valuebooks/contracts', '@valuebooks/localization', '@valuebooks/ui'],
  experimental: {
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
