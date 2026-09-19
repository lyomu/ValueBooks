import type { Metadata } from 'next';

import { PlatformSecurityEvents } from '../../../components/platform-operations';

export const metadata: Metadata = { title: 'Security events | ValueBooks platform' };

export default function PlatformSecurityRoute() {
  return <PlatformSecurityEvents />;
}
