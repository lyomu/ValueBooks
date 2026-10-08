import type { Metadata } from 'next';

import { RemindersPage } from '../../../components/reminders-workbench';

export const metadata: Metadata = { title: 'Reminders | ValueBooks' };

export default function RemindersSettingsPage() {
  return <RemindersPage />;
}
