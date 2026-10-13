import type { Metadata } from 'next';

import { AppShell } from '../../../../components/app-shell';
import { CreditNoteEditorPage } from '../../../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'Edit credit note | ValueBooks' };

export default async function EditCreditNoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <CreditNoteEditorPage creditNoteId={id} />
    </AppShell>
  );
}
