import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PlatformOrganizations } from '../../../components/platform-organizations';

export const metadata: Metadata = { title: 'Organizations | ValueBooks platform' };

export default function PlatformOrganizationsRoute() {
  // The listing reads its initial filters from the query string (overview drilldowns link here
  // with one already chosen), so it needs a suspense boundary.
  return (
    <Suspense>
      <PlatformOrganizations />
    </Suspense>
  );
}
