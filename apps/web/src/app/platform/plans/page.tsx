import { redirect } from 'next/navigation';

/** Plans & pricing moved under Billing; keep old links and bookmarks working. */
export default function PlatformPlansRoute() {
  redirect('/platform/billing/plans');
}
