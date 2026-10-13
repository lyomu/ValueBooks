import type { Metadata } from 'next';
import { AppShell } from '../../../../components/app-shell';
import { QuoteEditorPage } from '../../../../components/quotes-workbench';

export const metadata: Metadata = { title: 'Edit quote | ValueBooks' };
export default async function EditQuoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <QuoteEditorPage quoteId={id} />
    </AppShell>
  );
}
