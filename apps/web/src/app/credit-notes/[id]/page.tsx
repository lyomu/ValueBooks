import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { CreditNotesPage } from '../../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'Credit note | ValueBooks' };

export default async function CreditNoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <CreditNotesPage initialSelectedCreditNoteId={id} />
    </AppShell>
  );
}
