import type { Metadata } from 'next';

import { PrivacyDocument } from '../../../components/marketing/legal-document';

export const metadata: Metadata = { title: 'Privacy Policy & Data Deletion | ValueBooks' };

export default function PrivacyPage() {
  return <PrivacyDocument />;
}
