import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ReportLibraryPage } from '../../components/reports-workbench';

export const metadata: Metadata = { title: 'Reports | ValueBooks' };

export default function ReportsRoute() {
  return (
    <AppShell>
      <ReportLibraryPage />
    </AppShell>
  );
}
