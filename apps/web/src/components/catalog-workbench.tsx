'use client';

import type { Item } from '@valuebooks/contracts';
import {
  Button,
  ForbiddenState,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@valuebooks/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { ItemDialog } from './item-dialog';
import { OperationalListing } from './operational-listing';

type ItemListResponse = { data: Item[] };

export function ItemsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'catalog.view');
  const canManage = hasPermission(organization, 'catalog.manage');
  const currency = organization?.baseCurrency ?? 'KES';

  const [items, setItems] = useState<Item[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<ItemListResponse>(
        `/organizations/${organizationId}/catalog/items${query}`,
      );
      setItems(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Items could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(item: Item, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setError(null);
    try {
      const action = status === 'ACTIVE' ? 'reactivate' : 'deactivate';
      await apiRequest(`/organizations/${organizationId}/catalog/items/${item.id}/${action}`, {
        method: 'POST',
      });
      setNotice(`${item.name} was ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The item status could not be changed.',
      );
    }
  }

  const columns: readonly DataTableColumn<Item>[] = [
    {
      key: 'name',
      header: 'Item',
      value: (item) => item.name,
      cell: (item) => <>{item.name}{item.sku ? <span> {item.sku}</span> : null}</>,
    },
    { key: 'type', header: 'Type', value: (item) => item.itemType, cell: (item) => item.itemType },
    {
      key: 'inventory',
      header: 'Inventory',
      value: (item) => item.inventoryTracked ? 'Tracked' : 'Not tracked',
      cell: (item) =>
        item.inventoryTracked ? (
          <div>
            <span>Tracked</span>
            <span className="rb-table-secondary">
              Reorder at {item.reorderThreshold ?? 'not set'}
            </span>
          </div>
        ) : (
          'Not tracked'
        ),
    },
    {
      key: 'price',
      header: 'Price',
      value: (item) => item.prices[0]?.unitPriceMinor ?? '',
      cell: (item) =>
        item.prices[0]
          ? `${item.prices[0].currency} ${(Number(item.prices[0].unitPriceMinor) / 100).toFixed(2)}`
          : '—',
    },
    { key: 'status', header: 'Status', value: (item) => item.status, cell: (item) => <StatusBadge status={item.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (item) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
              Edit
            </Button>
            {item.status === 'ACTIVE' ? (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(item, 'INACTIVE')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(item, 'ACTIVE')}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant catalog access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <ItemDialog
        open={formOpen}
        onOpenChange={(open) => { if (!open) { setEditing(null); setShowCreate(false); } }}
        organizationId={organizationId}
        currency={currency}
        item={formTarget}
        onSaved={(savedItem) => { setNotice(`${savedItem.name} was ${formTarget ? 'updated' : 'added'}.`); setEditing(null); setShowCreate(false); void load(); }}
      />
      {error ? <div className="rb-auth-error" role="alert">{error}</div> : null}
      {notice ? <div className="rb-auth-notice" role="status">{notice}</div> : null}
      {!items && !error ? <Skeleton /> : <OperationalListing
        title={statusFilter === 'ACTIVE' ? 'Active items & services' : statusFilter === 'INACTIVE' ? 'Inactive items & services' : 'All items & services'}
        rows={items ?? []}
        columns={columns}
        searchText={(item) => `${item.name} ${item.sku ?? ''} ${item.itemType}`}
        filter={<Select aria-label="Item status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>}
        primaryAction={canManage ? <Button onClick={() => { setEditing(null); setShowCreate(true); }}><Plus aria-hidden="true" /> New</Button> : null}
        onRefresh={() => void load()}
        onImport={async (file, sourceNamespace) => { setNotice(`${file.name} is ready to map under ${sourceNamespace}.`); }}
        emptyState={{ title: 'Build your product and service catalog', description: 'Add the goods and services you sell so invoices and quotes stay consistent.', illustration: 'inventory', variant: 'onboarding', benefits: ['Reuse prices and tax defaults', 'Track stock on goods when needed'] }}
        noResultsState={{ title: 'No items or services match this view', description: 'Clear the search or status filter to see your catalog.', illustration: 'inventory', variant: 'no-results', action: <Button variant="outline" onClick={() => setStatusFilter('')}>Clear filters</Button> }}
        onResetFilters={() => setStatusFilter('')}
        empty="No items or services match this view."
      />}
    </>
  );

}
