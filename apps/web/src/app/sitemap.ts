import type { MetadataRoute } from 'next';

import { industries } from '../content/industries';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const toUrl = (path: string) => new URL(path, baseUrl).toString();

  return [
    { url: toUrl('/industries'), changeFrequency: 'weekly', priority: 0.8 },
    ...industries.map((industry) => ({
      url: toUrl(`/industries/${industry.slug}`),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
