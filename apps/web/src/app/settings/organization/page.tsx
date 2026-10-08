import { PageHeader } from '@valuebooks/ui';
import type { Metadata } from 'next';

import { OrganizationSettings } from '../../../components/organization-settings';

export const metadata: Metadata = { title: 'Organization profile | ValueBooks' };

export default function OrganizationSettingsPage() {
  return (
    <>
      <PageHeader
        title="Organization profile"
        description="Legal identity, jurisdiction, accounting basis, and tax defaults."
      />
      <OrganizationSettings />
    </>
  );
}
