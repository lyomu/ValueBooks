import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ProjectProfitabilityPage } from '../../components/projects-workbench';

export const metadata: Metadata = { title: 'Project profitability | ValueBooks' };

export default function Page() {
  return (
    <AppShell>
      <ProjectProfitabilityPage />
    </AppShell>
  );
}
