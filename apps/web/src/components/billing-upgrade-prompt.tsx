'use client';

import { Button, Dialog, DialogContent } from '@valuebooks/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const labels: Record<string, string> = {
  'customers.active.max': 'active customer', 'invoices.issued.max': 'monthly invoice',
  'seats.max': 'team seat', 'projects.enabled': 'active project', 'expenses.max': 'monthly expense',
  'bills.enabled': 'monthly bill', 'purchase_orders.enabled': 'monthly purchase order',
  'warehouses.enabled': 'warehouse', 'ai_insights.max': 'AI insight request',
};

export function BillingUpgradePrompt() {
  const [limit, setLimit] = useState<{ feature: string; currentUsage: number; limit: number } | null>(null);
  useEffect(() => {
    const onLimit = (event: Event) => {
      const detail = (event as CustomEvent<{ feature: string; currentUsage: number; limit: number }>).detail;
      if (detail?.feature) setLimit(detail);
    };
    window.addEventListener('valuebooks:billing-limit', onLimit);
    return () => window.removeEventListener('valuebooks:billing-limit', onLimit);
  }, []);
  const label = limit ? labels[limit.feature] ?? 'plan' : 'plan';
  const unavailableProject = limit?.feature === 'projects.enabled' && limit.limit === 0;
  return <Dialog open={Boolean(limit)} onOpenChange={(open) => { if (!open) setLimit(null); }}>
    <DialogContent title={unavailableProject ? 'Projects are available on Professional' : `You've reached your ${label} limit`} description={unavailableProject ? 'Upgrade to Professional to manage projects, track related expenses, and review project profitability.' : limit ? `Your plan allows ${limit.limit} ${label}${limit.limit === 1 ? '' : 's'}. Current usage: ${limit.currentUsage}. Existing records remain available.` : ''}>
      <div className="rb-trial-actions">
        <Button asChild><Link href="/settings/billing" onClick={() => setLimit(null)}>View plans</Link></Button>
        <Button variant="outline" onClick={() => setLimit(null)}>Maybe later</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
