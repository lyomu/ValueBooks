import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { NumberingSettings } from '../../../components/numbering-settings';

export const metadata: Metadata = { title: 'Numbering | ValueBooks' };

export default function NumberingSettingsPage() {
  return (
    <>
      <PageHeader
        title="Numbering"
        description="Configure journal reference prefixes, padding, and reset cadence."
      />
      <NumberingSettings />
    </>
  );
}
