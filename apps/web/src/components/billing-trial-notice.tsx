'use client';

import { Button, Dialog, DialogContent } from '@valuebooks/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';

type TrialState = { subscription: { status: string; trialEndsAt: string | null } | null };
const DISMISS_HOURS = 4;

/** Kept in the shared application shell so the final-day reminder survives route changes. */
export function BillingTrialNotice({ organizationId }: { organizationId: string | null }) {
  const [trial, setTrial] = useState<TrialState['subscription']>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void apiRequest<{ data: TrialState }>(`/organizations/${organizationId}/billing`)
      .then(({ data }) => {
        if (cancelled) return;
        setTrial(data.subscription);
        if (data.subscription?.status !== 'TRIALING' || !data.subscription.trialEndsAt) return;
        const remaining = new Date(data.subscription.trialEndsAt).getTime() - Date.now();
        if (remaining <= 0 || remaining > 86_400_000) return;
        const key = `valuebooks:trial-reminder:${organizationId}`;
        const dismissedUntil = Number(window.sessionStorage.getItem(key) ?? 0);
        if (dismissedUntil > Date.now() || document.activeElement?.closest('form')) return;
        setShowModal(true);
      })
      .catch(() => { /* Billing settings contains the explicit recoverable error. */ });
    return () => { cancelled = true; };
  }, [organizationId]);

  if (!trial) return null;
  const expired = trial.status === 'TRIAL_EXPIRED' ||
    (trial.status === 'TRIALING' && trial.trialEndsAt && new Date(trial.trialEndsAt).getTime() <= Date.now());
  if (!expired && (trial.status !== 'TRIALING' || !trial.trialEndsAt ||
    new Date(trial.trialEndsAt).getTime() - Date.now() > 86_400_000)) return null;
  const expiry = trial.trialEndsAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(trial.trialEndsAt)) : null;

  function dismiss() {
    if (organizationId) window.sessionStorage.setItem(`valuebooks:trial-reminder:${organizationId}`, String(Date.now() + DISMISS_HOURS * 3_600_000));
    setShowModal(false);
  }

  return (
    <>
      <div className="rb-trial-banner" role="status">
        <span>{expired ? 'Your ValueBooks trial has ended. Your records remain available in read-only mode.' : `Your ValueBooks trial ends ${expiry}.`}</span>
        <Link href="/settings/billing">{expired ? 'Choose a plan' : 'View subscription plans'}</Link>
      </div>
      {!expired ? (
        <Dialog open={showModal} onOpenChange={(open) => { if (!open) dismiss(); }}>
          <DialogContent title="Your ValueBooks trial ends tomorrow" description="Your free trial is almost over. Choose a plan to continue using ValueBooks without interruption. Your existing business records will remain available even if you decide not to subscribe today.">
            <p className="rb-security-note">Trial ends {expiry}.</p>
            <div className="rb-trial-actions">
              <Button asChild><Link href="/settings/billing">View Subscription Plans</Link></Button>
              <Button variant="outline" onClick={dismiss}>Remind Me Later</Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
