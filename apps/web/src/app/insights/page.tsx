import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InsightsPage } from '../../components/insights-workbench';

export const metadata: Metadata = { title: 'Insights | ValueBooks' };

export default function InsightsRoute() {
  return (
    <AppShell>
      <InsightsPage />
    </AppShell>
  );
}
