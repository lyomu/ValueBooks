import type { Metadata } from 'next';

import { TermsDocument } from '../../../components/marketing/legal-document';

export const metadata: Metadata = { title: 'Terms of Service | ValueBooks' };

export default function TermsPage() {
  return <TermsDocument />;
}
