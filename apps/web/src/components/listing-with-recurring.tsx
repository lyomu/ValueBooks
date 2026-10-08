'use client';

import { Tabs, TabsList, TabsTrigger } from '@valuebooks/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { hasPermission, useWorkspace } from '../lib/workspace';

/**
 * Pairs a document listing with its recurring templates behind one pair of tabs.
 *
 * Templates are a different record from the documents they generate -- different table, different
 * columns, different permissions -- so this swaps the whole listing rather than filtering one.
 * Only the active side is mounted, so the inactive tab costs no request.
 *
 * The active tab lives in `?tab=`, which is what makes a recurring view linkable: the sidebar used
 * to carry a /recurring-* entry for each of these, and those URLs now redirect here.
 */
export function ListingWithRecurring({
  documentsLabel,
  documents,
  recurring,
  recurringPermission,
  recurringLabel = 'Recurring',
}: {
  documentsLabel: string;
  documents: ReactNode;
  recurring: ReactNode;
  recurringPermission: Parameters<typeof hasPermission>[1];
  recurringLabel?: string;
}) {
  const workspace = useWorkspace({ requireOrganization: true });
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const canViewRecurring = hasPermission(workspace.activeOrganization, recurringPermission);
  const requested = searchParams.get('tab') === 'recurring';
  const tab = requested && canViewRecurring ? 'recurring' : 'documents';

  function selectTab(next: string) {
    // Replace rather than push: flipping a tab is not a step you want to walk back through.
    router.replace(next === 'recurring' ? `${pathname}?tab=recurring` : pathname, {
      scroll: false,
    });
  }

  return (
    <>
      {canViewRecurring ? (
        <Tabs value={tab} onValueChange={selectTab} className="rb-listing-tabs">
          <TabsList aria-label={`${documentsLabel} views`}>
            <TabsTrigger value="documents">{documentsLabel}</TabsTrigger>
            <TabsTrigger value="recurring">{recurringLabel}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {tab === 'recurring' ? recurring : documents}
    </>
  );
}
