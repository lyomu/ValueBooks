import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ScheduledReportsPage } from '../../../components/scheduled-reports-workbench';

export const metadata: Metadata = { title: 'Scheduled reports | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <ScheduledReportsPage />
    </AppShell>
  );
}
