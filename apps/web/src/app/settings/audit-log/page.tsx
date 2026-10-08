import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { AuditLog } from '../../../components/audit-log';

export const metadata: Metadata = { title: 'Audit log | ValueBooks' };

export default function AuditLogPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A chronological record of security-relevant actions in this organization."
      />
      <AuditLog />
    </>
  );
}
