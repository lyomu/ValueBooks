'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHero, SectionIntro } from './sections';
import {
  BillingToggle,
  ComparisonTable,
  CurrencyDisclaimer,
  PlanCardRow,
  useDisplayCurrency,
  type BillingInterval,
} from './pricing';

/**
 * Condensed homepage teaser. Cards only ever show each plan's top features — "expanding" into the
 * full picture means following the link to /pricing, not an inline accordion on the card itself.
 */
export function PricingTeaserSection() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const currencyCode = useDisplayCurrency();

  return (
    <section className="mk-pricing-section">
      <SectionIntro
        centered
        kicker="Simple pricing"
        title="A plan for every stage of growth."
        text="Start free, then upgrade as your team and transaction volume grow. No contracts, cancel anytime."
      />
      <BillingToggle interval={interval} onChange={setInterval} />
      <PlanCardRow interval={interval} currencyCode={currencyCode} variant="compact" />
      <CurrencyDisclaimer currencyCode={currencyCode} />
      <div className="mk-pricing-section__more">
        <Link className="mk-text-link" href="/pricing">
          Compare all plans in detail <ArrowRight />
        </Link>
      </div>
    </section>
  );
}

export function PricingPageContent() {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const currencyCode = useDisplayCurrency();

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="A plan for every stage of growth."
        copy="Start free, then upgrade as your team and transaction volume grow. No contracts, cancel anytime."
        action={{ label: 'Try ValueBooks free', href: '/signup' }}
        visual="insights"
      />
      <section className="mk-pricing-page-section">
        <BillingToggle interval={interval} onChange={setInterval} />
        <PlanCardRow interval={interval} currencyCode={currencyCode} variant="full" />
        <CurrencyDisclaimer currencyCode={currencyCode} />
      </section>
      <section className="mk-pricing-compare-section">
        <SectionIntro centered kicker="Compare plans" title="Every feature, side by side." />
        <ComparisonTable />
      </section>
    </>
  );
}
