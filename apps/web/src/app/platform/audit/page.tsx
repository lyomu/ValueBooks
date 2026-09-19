import type { Metadata } from 'next';

import { PlatformAudit } from '../../../components/platform-operations';

export const metadata: Metadata = { title: 'Platform audit | ValueBooks platform' };

export default function PlatformAuditRoute() {
  return <PlatformAudit />;
}
