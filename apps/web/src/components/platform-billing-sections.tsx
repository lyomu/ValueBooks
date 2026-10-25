'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sections = [
  { href: '/platform/billing/plans', label: 'Plan Catalog' },
  { href: '/platform/billing/subscriptions', label: 'Subscription Management' },
  { href: '/platform/billing/providers', label: 'Billing Configuration' },
] as const;

export function PlatformBillingSections() {
  const path = usePathname();
  return <nav className="rb-platform-billing-sections" aria-label="Billing administration">
    {sections.map((section) => <Link key={section.href} href={section.href}
      aria-current={path === section.href || path.startsWith(`${section.href}/`) ? 'page' : undefined}>
      {section.label}
    </Link>)}
  </nav>;
}
