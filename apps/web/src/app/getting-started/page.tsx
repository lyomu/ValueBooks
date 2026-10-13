import type { Metadata } from 'next';
import { AppShell } from '../../components/app-shell';
import { GettingStarted } from '../../components/getting-started';
export const metadata: Metadata = { title: 'Getting Started | ValueBooks' };
export default function GettingStartedPage() {
  return (
    <AppShell>
      <GettingStarted />
    </AppShell>
  );
}
