import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { SecuritySessions } from '../../../components/security-sessions';

export const metadata: Metadata = { title: 'Account security | ValueBooks' };

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        title="Account security"
        description="Manage your password, active sessions, and future verification controls."
      />
      <SecuritySessions />
    </>
  );
}
