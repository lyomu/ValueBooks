'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FaqAccordion, type FaqItem } from './faq-accordion';
import { Reveal } from './motion';
import { SectionIntro } from './sections';
import {
  BillingToggle,
  ComparisonTable,
  CurrencyDisclaimer,
  PlanCardRow,
  useDisplayCurrency,
  type BillingInterval,
} from './pricing';
import type { Plan } from './pricing-data';

const pricingFaqItems: FaqItem[] = [
  {
    q: 'Do I need a credit card to start my free trial?',
    a: 'No. You can try ValueBooks free for 14 days without entering payment details.',
  },
  {
    q: 'What happens when my trial ends?',
    a: 'You can choose a paid plan to continue using ValueBooks. If you do not subscribe, your existing financial records remain available in read-only mode.',
  },
  {
    q: 'Can I change my plan later?',
    a: 'Yes. You can request a plan change from your billing settings. The effective date and any payment requirements will be shown before you confirm.',
  },
  {
    q: 'Will my data be deleted if I cancel?',
    a: 'No. Canceling a subscription does not automatically delete your business records. Account and organization deletion are handled separately under our data retention and deletion policy.',
  },
  {
    q: 'What payment methods are accepted?',
    a: 'Available payment methods depend on your selected plan, country, and payment provider. Supported options are shown during checkout.',
  },
];

/**
 * Condensed homepage teaser. Cards only ever show each plan's top features — "expanding" into the
 * full picture means following the link to /pricing, not an inline accordion on the card itself.
 */
export function PricingTeaserSection({ plans }: { plans?: Plan[] }) {
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
      <Reveal as="div">
        <PlanCardRow
          interval={interval}
          currencyCode={currencyCode}
          variant="compact"
          plans={plans}
        />
      </Reveal>
      <CurrencyDisclaimer currencyCode={currencyCode} />
      <div className="mk-pricing-section__more">
        <Link className="mk-text-link" href="/pricing">
          Compare all plans in detail <ArrowRight />
        </Link>
      </div>
    </section>
  );
}

/**
 * `plans` carries the live catalog read on the server (phase 7, §4.8). Prices are
 * administrator-editable and reach Paystack immediately, so the page must not advertise the figure
 * compiled into the bundle. Omitting the prop falls back to the approved catalog.
 */
export function PricingPageContent({ plans }: { plans?: Plan[] }) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const currencyCode = useDisplayCurrency();

  return (
    <>
      <section className="mk-pricing-hero">
        <div className="mk-pricing-hero__content">
          <h1>A plan for every stage of growth.</h1>
          <p>
            Start free, then upgrade as your team and transaction volume grow. No contracts, cancel
            anytime.
          </p>
        </div>
        <div className="mk-pricing-hero__toggle">
          <BillingToggle interval={interval} onChange={setInterval} />
        </div>
      </section>
      <section className="mk-pricing-page-section">
        <PlanCardRow
          interval={interval}
          currencyCode={currencyCode}
          variant="full"
          plans={plans}
        />
        <p className="mk-pricing-trial-note">Try ValueBooks free for 14 days. No card required.</p>
        <CurrencyDisclaimer currencyCode={currencyCode} />
      </section>
      <section className="mk-pricing-compare-section">
        <SectionIntro centered kicker="Compare plans" title="Every feature, side by side." />
        <ComparisonTable plans={plans} />
      </section>
      <section className="mk-faq-section">
        <SectionIntro centered title="Pricing questions, answered" />
        <Reveal as="div">
          <FaqAccordion items={pricingFaqItems} />
        </Reveal>
      </section>
    </>
  );
}
