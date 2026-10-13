'use client';

import type { Contact } from '@valuebooks/contracts';
import {
  Button,
  ForbiddenState,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@valuebooks/ui';
import { FileClock, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { CustomerDialog } from './customer-dialog';
import { EntityDetailView } from './master-detail/entity-detail-view';
import { OperationalListing } from './operational-listing';
import { CustomerDetailPane, CustomerToolbar } from './customer-detail-pane';
import { RecordDetailWorkspace } from './record-detail-workspace';

type ContactResponse = { data: Contact };
type ContactListResponse = { data: Contact[] };

export function CustomersPage({
  initialSelectedCustomerId,
}: {
  initialSelectedCustomerId?: string;
}) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'customers.view');
  const canManage = hasPermission(organization, 'customers.manage');
  const canOverrideCurrency = hasPermission(organization, 'customers.currency_override');
  const canViewStatements = hasPermission(organization, 'sales.statements.view');
  const canViewInvoices = hasPermission(organization, 'sales.invoices.view');
  const canRecordPayment = hasPermission(organization, 'sales.payments.record');
  const canAllocatePayment = hasPermission(organization, 'sales.payments.allocate');
  const canComment = hasPermission(organization, 'collaboration.comments.create');

  const [customers, setCustomers] = useState<Contact[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialSelectedCustomerId ?? null,
  );
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<ContactListResponse>(
        `/organizations/${organizationId}/customers${query}`,
      );
      setCustomers(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Customers could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedCustomerId(initialSelectedCustomerId ?? null);
  }, [initialSelectedCustomerId]);

  async function setStatus(customer: Contact, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setError(null);
    try {
      const action = status === 'ACTIVE' ? 'reactivate' : 'deactivate';
      await apiRequest<ContactResponse>(
        `/organizations/${organizationId}/customers/${customer.id}/${action}`,
        { method: 'POST' },
      );
      setNotice(
        `${customer.displayName} was ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The customer status could not be changed.',
      );
    }
  }

  const columns: readonly DataTableColumn<Contact>[] = [
    {
      key: 'name',
      header: 'Customer',
      value: (customer) => customer.displayName,
      cell: (customer) => (
        <Link href={`/dashboard/customers/${customer.id}`}>{customer.displayName}</Link>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      value: (customer) => customer.email ?? '',
      cell: (customer) => customer.email ?? <span className="rb-table-empty">—</span>,
      hideBelow: 'tablet',
    },
    {
      key: 'currency',
      header: 'Currency',
      value: (customer) => customer.currency,
      cell: (customer) => customer.currency,
    },
    {
      key: 'status',
      header: 'Status',
      value: (customer) => customer.status,
      cell: (customer) => <StatusBadge status={customer.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (customer) =>
        canViewStatements || canManage ? (
          <div className="rb-inline-actions">
            {canViewStatements ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/dashboard/customers/${customer.id}/statement`}>
                  <FileClock aria-hidden="true" /> Statement
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/dashboard/customers/${customer.id}/edit`}>Edit</Link>
                </Button>
                {customer.status === 'ACTIVE' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void setStatus(customer, 'INACTIVE')}
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void setStatus(customer, 'ACTIVE')}
                  >
                    Reactivate
                  </Button>
                )}
              </>
            ) : null}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant customer access." />
    );
  }

  const permissionsFor = () => ({
    canManage,
    canViewStatements,
    canViewInvoices,
    canRecordPayment,
    canAllocatePayment,
    canComment,
  });

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);
  const selectedCustomer = customers?.find((customer) => customer.id === selectedCustomerId);

  return (
    <>
      <CustomerDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setShowCreate(false);
          }
        }}
        organizationId={organizationId}
        baseCurrency={organization?.baseCurrency ?? 'USD'}
        canOverrideCurrency={canOverrideCurrency}
        customer={formTarget}
        onSaved={(customer) => {
          setNotice(`${customer.displayName} was ${formTarget ? 'updated' : 'added'}.`);
          setEditing(null);
          setShowCreate(false);
          void load();
        }}
      />
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}
      {selectedCustomer ? (
        <RecordDetailWorkspace
          variant="compact"
          title="Customers"
          records={customers ?? []}
          selectedId={selectedCustomer.id}
          onSelect={(customer) => {
            setSelectedCustomerId(customer.id);
            router.push(`/dashboard/customers/${customer.id}`);
          }}
          onClose={() => {
            setSelectedCustomerId(null);
            router.push('/dashboard/customers');
          }}
          recordHref={(customer) => `/dashboard/customers/${customer.id}`}
          searchText={(customer) =>
            `${customer.displayName} ${customer.legalName ?? ''} ${customer.email ?? ''} ${customer.phone ?? ''}`
          }
          railHeader={
            <>
              <h1>All Customers</h1>
              {canManage ? (
                <Button
                  size="icon"
                  aria-label="New customer"
                  onClick={() => {
                    setEditing(null);
                    setShowCreate(true);
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
              ) : null}
            </>
          }
          renderRailRecord={(customer) => (
            <>
              <span className="rb-customer-rail__line">
                <strong>{customer.displayName}</strong>
              </span>
              <span className="rb-customer-rail__meta">
                {customer.email ?? customer.phone ?? customer.currency}
              </span>
            </>
          )}
          detailTitle={(customer) => <h1>{customer.displayName}</h1>}
          headerActions={(customer) => (
            <CustomerToolbar
              customer={customer}
              permissions={permissionsFor()}
              onEdit={() => router.push(`/dashboard/customers/${customer.id}/edit`)}
              onSetStatus={(status) => void setStatus(customer, status)}
              onRecordPayment={() => setRecordingPayment(true)}
            />
          )}
          renderDetail={(customer) => (
            <EntityDetailView>
              <CustomerDetailPane
                customer={customer}
                organizationId={organizationId ?? ''}
                permissions={permissionsFor()}
                recordingPayment={recordingPayment}
                onRecordingPaymentChange={setRecordingPayment}
              />
            </EntityDetailView>
          )}
        />
      ) : !customers && !error ? (
        <Skeleton />
      ) : (
        <OperationalListing
          title={
            statusFilter === 'ACTIVE'
              ? 'Active customers'
              : statusFilter === 'INACTIVE'
                ? 'Inactive customers'
                : 'All customers'
          }
          rows={customers ?? []}
          columns={columns}
          searchText={(customer) =>
            `${customer.displayName} ${customer.legalName ?? ''} ${customer.email ?? ''} ${customer.phone ?? ''}`
          }
          filter={
            <Select
              aria-label="Customer status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          }
          primaryAction={
            canManage ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowCreate(true);
                }}
              >
                <Plus aria-hidden="true" /> New
              </Button>
            ) : null
          }
          onRefresh={() => void load()}
          onImport={(file, sourceNamespace) => {
            setNotice(`${file.name} is ready to map under ${sourceNamespace}.`);
          }}
          emptyState={{
            title: 'Every sale starts with a customer',
            description:
              'Create a customer to track their contact details, invoices, and receivables in one place.',
            illustration: 'sales',
            variant: 'onboarding',
            benefits: [
              'Keep customer records and statements together',
              'Issue invoices in the customer’s currency',
            ],
          }}
          noResultsState={{
            title: 'No customers match this view',
            description: 'Clear the search or status filter to see your customers.',
            illustration: 'sales',
            variant: 'no-results',
            action: (
              <Button variant="outline" onClick={() => setStatusFilter('')}>
                Clear filters
              </Button>
            ),
          }}
          onResetFilters={() => setStatusFilter('')}
          empty="No customers match this view."
          onRowClick={(customer) => {
            setSelectedCustomerId(customer.id);
            router.push(`/dashboard/customers/${customer.id}`);
          }}
        />
      )}
    </>
  );
}

export function CustomerEditorPage({ customerId }: { customerId: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'customers.manage');
  const canOverrideCurrency = hasPermission(organization, 'customers.currency_override');
  const [customer, setCustomer] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    void apiRequest<ContactResponse>(`/organizations/${organizationId}/customers/${customerId}`)
      .then((response) => setCustomer(response.data))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Customer could not be loaded.'),
      );
  }, [customerId, organizationId]);

  if (!workspace.loading && organization && !canManage) {
    return (
      <ForbiddenState description="Ask an organization owner or administrator to grant customer management access." />
    );
  }

  return (
    <>
      <PageHeader
        title={customer ? `Edit ${customer.displayName}` : 'Edit customer'}
        description="Update customer details and return to the read-only record."
      />
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {customer ? (
        <CustomerDialog
          open
          onOpenChange={() => router.push(`/dashboard/customers/${customerId}`)}
          organizationId={organizationId}
          baseCurrency={organization?.baseCurrency ?? 'USD'}
          canOverrideCurrency={canOverrideCurrency}
          customer={customer}
          embedded
          onSaved={(saved) => router.replace(`/dashboard/customers/${saved.id}`)}
        />
      ) : !error ? (
        <Skeleton />
      ) : null}
    </>
  );
}
