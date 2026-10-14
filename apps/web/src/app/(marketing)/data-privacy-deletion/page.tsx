import type { Metadata } from 'next';

import { DataDeletionDocument } from '../../../components/marketing/legal-document';

export const metadata: Metadata = { title: 'Data Privacy & Deletion | ValueBooks' };

export default function DataPrivacyDeletionPage() { return <DataDeletionDocument />; }
