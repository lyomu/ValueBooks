import type { Metadata } from 'next';

import { AccessibilityDocument } from '../../../components/marketing/legal-document';

export const metadata: Metadata = { title: 'Accessibility Statement | ValueBooks' };

export default function AccessibilityPage() {
  return <AccessibilityDocument />;
}
