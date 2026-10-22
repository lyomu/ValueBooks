import type { Metadata } from 'next';

import { PlatformCountryPackVersion } from '../../../../../components/platform-country-packs';

export const metadata: Metadata = { title: 'Country pack version | ValueBooks platform' };

export default async function PlatformCountryPackVersionRoute({
  params,
}: {
  params: Promise<{ code: string; version: string }>;
}) {
  const { code, version } = await params;

  return (
    <PlatformCountryPackVersion
      code={decodeURIComponent(code)}
      version={decodeURIComponent(version)}
    />
  );
}
