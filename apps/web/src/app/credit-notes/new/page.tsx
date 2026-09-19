import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { CreditNoteEditorPage } from '../../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'New credit note | ValueBooks' };

export default function NewCreditNoteRoute() {
  return (
    <AppShell>
      <CreditNoteEditorPage />
    </AppShell>
  );
}
