'use client';

import { OFFICIAL_ENTITLEMENT_KEYS, OFFICIAL_FEATURE_KEYS, type PlatformPlan } from '@valuebooks/contracts';
import { Badge, Button, DataTable, ErrorState, FormField, Input, Label, Select } from '@valuebooks/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { AdminActionDialog } from './admin-action-dialog';
import { Panel } from './platform-organization-detail';
import { PlatformPage } from './platform-shell';

type Value = { key: string; enabled: boolean; limitValue: number | null };
type Version = { id: string; version: number; status: 'DRAFT' | 'PUBLISHED'; reason: string;
  publishedAt: string | null; values: Value[] };
type Preview = { id: string; version: number; values: Value[]; subscribersStayingOnCurrentTerms: number;
  subscribersToPinAtPublish: number; earliestRenewalAt: string | null; missingKeys: string[];
  migration: string };
type Action = 'draft' | 'value' | 'publish' | null;
const KEYS = [...OFFICIAL_ENTITLEMENT_KEYS, ...OFFICIAL_FEATURE_KEYS];

/** Entitlement governance stays on its own screen and uses the shared privileged-action pattern. */
export function PlatformEntitlementVersions({ planId }: { planId: string }) {
  const { session } = usePlatformSession();
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');
  const [plan, setPlan] = useState<PlatformPlan | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action>(null);
  const [key, setKey] = useState<string>(KEYS[0] ?? '');
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState('');

  const load = useCallback(async () => {
    setError(false);
    try {
      const [catalog, history] = await Promise.all([
        apiRequest<{ data: PlatformPlan[] }>('/platform/plans'),
        apiRequest<{ data: Version[] }>(`/platform/plans/${planId}/entitlement-versions`),
      ]);
      const selected = catalog.data.find((row) => row.id === planId);
      if (!selected) throw new Error('Plan not found');
      setPlan(selected);
      setVersions(history.data);
      const draft = history.data.find((row) => row.status === 'DRAFT');
      if (draft && canManage) {
        const response = await apiRequest<{ data: Preview }>(
          `/platform/plans/${planId}/entitlement-versions/${draft.id}/preview`);
        setPreview(response.data);
      } else setPreview(null);
    } catch { setError(true); }
  }, [planId, canManage]);

  useEffect(() => { void load(); }, [load]);

  function selectKey(next: string) {
    setKey(next);
    const value = preview?.values.find((row) => row.key === next);
    setEnabled(value?.enabled ?? true);
    setLimit(value?.limitValue?.toString() ?? '');
  }

  return <PlatformPage title="Entitlement versions" description={plan ? `${plan.name} · ${plan.key}` : undefined}>
    <Link href="/platform/billing/plans">Back to Plans & pricing</Link>
    {notice ? <p className="rb-platform__notice" role="status">{notice}</p> : null}
    {error ? <ErrorState title="Entitlement versions could not be loaded"
      description="The plan and its version history are unavailable." action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} /> : <>
      <Panel title="Version history">
        {canManage && plan && !preview ? <Button variant="secondary" onClick={() => setAction('draft')}>Create entitlement draft</Button> : null}
        <DataTable caption="Entitlement versions" rows={versions ?? []} loading={versions === null}
          emptyTitle="No published versions" emptyDescription="The current plan entitlements are the live projection."
          emptyState={{ variant: 'inline' }} columns={[
            { key: 'version', header: 'Version', cell: (row) => row.version },
            { key: 'status', header: 'Status', cell: (row) => <Badge tone={row.status === 'PUBLISHED' ? 'success' : 'warning'}>{row.status}</Badge> },
            { key: 'published', header: 'Published', cell: (row) => row.publishedAt ?? 'Not published' },
            { key: 'reason', header: 'Reason', cell: (row) => row.reason },
          ]} />
      </Panel>
      {preview ? <Panel title={`Draft v${preview.version} impact`}>
        <p>{preview.subscribersStayingOnCurrentTerms} existing subscriber(s) stay on the sold version; {preview.subscribersToPinAtPublish} will be pinned when this draft is published.</p>
        <p>{preview.migration} Earliest recorded renewal: {preview.earliestRenewalAt ?? 'unknown'}.</p>
        {preview.missingKeys.length ? <p className="rb-platform__alert">Missing keys: {preview.missingKeys.join(', ')}.</p> : <p>No entitlement keys are missing.</p>}
        <DataTable caption="Draft entitlement values" rows={preview.values.map((row) => ({ ...row, id: row.key }))}
          columns={[
            { key: 'key', header: 'Entitlement', cell: (row) => row.key },
            { key: 'included', header: 'Included', cell: (row) => row.enabled ? 'Yes' : 'No' },
            { key: 'limit', header: 'Limit', cell: (row) => row.enabled ? row.limitValue ?? 'Unlimited' : 'Not included' },
          ]} />
        {canManage ? <>
          <Button variant="secondary" onClick={() => { selectKey(KEYS[0] ?? ''); setAction('value'); }}>Edit draft value</Button>
          <Button variant="primary" disabled={preview.missingKeys.length > 0} onClick={() => setAction('publish')}>Review and publish</Button>
        </> : null}
      </Panel> : null}
    </>}
    {plan && action === 'draft' ? <AdminActionDialog open onOpenChange={(open) => { if (!open) setAction(null); }}
      title="Create entitlement draft" confirmLabel="Create draft"
      impact={<p>The current entitlements remain in force. Publication later pins existing subscribers until their next verified renewal.</p>}
      onConfirm={async (reason) => {
        await apiRequest(`/platform/plans/${planId}/entitlement-versions`, { method: 'POST', body: JSON.stringify({ reason }) });
        setNotice('Draft created. Review and edit its values before publication.'); await load();
      }} /> : null}
    {preview && action === 'value' ? <AdminActionDialog open onOpenChange={(open) => { if (!open) setAction(null); }}
      title="Edit draft entitlement" confirmLabel="Save draft value"
      confirmDisabled={enabled && limit !== '' && !/^\d+$/.test(limit)}
      impact={<p>Only draft v{preview.version} changes; subscribers and the live projection keep their current limits.</p>}
      fields={<>
        <FormField><Label htmlFor="version-key">Entitlement</Label><Select id="version-key" value={key}
          onChange={(event) => selectKey(event.target.value)}>{KEYS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></FormField>
        <FormField><Label htmlFor="version-enabled">Included</Label><Input id="version-enabled" type="checkbox" checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)} /></FormField>
        <FormField><Label htmlFor="version-limit">Limit (blank means unlimited)</Label><Input id="version-limit" value={limit}
          onChange={(event) => setLimit(event.target.value)} /></FormField>
      </>}
      onConfirm={async (reason) => {
        await apiRequest(`/platform/plans/${planId}/entitlement-versions/${preview.id}/values`, { method: 'PUT',
          body: JSON.stringify({ key, enabled, limitValue: enabled && limit !== '' ? Number(limit) : null, reason }) });
        setNotice(`Draft v${preview.version} updated.`); await load();
      }} /> : null}
    {plan && preview && action === 'publish' ? <AdminActionDialog open onOpenChange={(open) => { if (!open) setAction(null); }}
      title="Publish entitlement version" confirmLabel="Publish entitlements" confirmationPhrase={plan.key}
      confirmDisabled={preview.missingKeys.length > 0}
      impact={<p>{preview.subscribersStayingOnCurrentTerms} existing subscriber(s) keep their sold entitlements until renewal. New subscriptions use this version immediately.</p>}
      onConfirm={async (reason) => {
        await apiRequest(`/platform/plans/${planId}/entitlement-versions/${preview.id}/publish`, { method: 'POST', body: JSON.stringify({ reason }) });
        setNotice(`Version ${preview.version} published. Existing subscribers remain pinned until renewal.`); await load();
      }} /> : null}
  </PlatformPage>;
}
