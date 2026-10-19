'use client';

import {
  ArrowRight,
  Bot,
  ChartColumnIncreasing,
  Check,
  LockKeyhole,
  ReceiptText,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DashboardMockup, InvoiceMockup } from './mockups';
import { Reveal } from './motion';
import { revealDelay } from './reveal-delay';
import { Photo } from './photo';

export { Photo };

/** Shared public-site typography primitives. Marketing body copy never falls below the readable
 * 16px baseline; hierarchy comes from weight, spacing, and headings rather than tiny text. */
export function MarketingKicker({ children }: { children: ReactNode }) {
  return <p className="mk-kicker">{children}</p>;
}

export function MarketingCopy({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`mk-copy ${className}`.trim()}>{children}</p>;
}

/** The single heading treatment for public-site sections. */
export function MarketingSectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mk-landing-section-heading">{children}</h2>;
}

export function PageHero({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="mk-page-hero">
      <div className="mk-page-hero__content">
        <h1>{title}</h1>
        <MarketingCopy>{copy}</MarketingCopy>
      </div>
    </section>
  );
}

export function SectionIntro({
  kicker,
  title,
  text,
  action,
  centered = false,
}: {
  kicker?: string;
  title: ReactNode;
  text?: string;
  action?: ReactNode;
  centered?: boolean;
}) {
  return (
    <Reveal as="div" className={centered ? 'mk-section-intro is-centered' : 'mk-section-intro'}>
      {kicker ? <MarketingKicker>{kicker}</MarketingKicker> : null}
      <MarketingSectionHeading>{title}</MarketingSectionHeading>
      {text || action ? (
        <div className="mk-description-cta">
          {text ? <MarketingCopy>{text}</MarketingCopy> : null}
          {action}
        </div>
      ) : null}
    </Reveal>
  );
}
export function FeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mk-feature-list">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
export function StatBand({ items }: { items: { number: string; label: string }[] }) {
  return (
    <section className="mk-stat-band">
      {items.map((item) => (
        <div key={item.label}>
          <strong>{item.number}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </section>
  );
}
const moreFeatureLinks = [
  { href: '/product', label: 'Expenses & reporting' },
  { href: '/customers', label: 'Customers' },
  { href: '/industries', label: 'Industries' },
  { href: '/contact', label: 'Talk to our team' },
];
export function FeatureGrid() {
  return (
    <section className="mk-feature-grid">
      <SectionIntro
        centered
        kicker="Built for how you work"
        title={<>Everything your business needs, in one place.</>}
      />
      <div className="mk-feature-grid__row mk-feature-grid__row--top">
        <Reveal as="article" variant="up" className="mk-feature-card mk-feature-card--cream">
          <div className="mk-feature-card__copy">
            <h3>Invoicing</h3>
            <p>
              Create and send professional invoices, track what&apos;s outstanding, and send
              reminders automatically.
            </p>
            <Link className="mk-text-link" href="/invoicing">
              Learn about Invoicing <ArrowRight />
            </Link>
          </div>
          <div className="mk-feature-card__visual">
            <div className="mk-feature-card__visual-scale">
              <InvoiceMockup />
            </div>
          </div>
        </Reveal>
        <Reveal
          as="article"
          variant="up"
          delay={revealDelay(1)}
          className="mk-feature-card mk-feature-card--blue"
        >
          <div className="mk-feature-card__copy">
            <h3>Accounting</h3>
            <p>
              Journals, reconciliation, and reports that stay accurate without extra bookkeeping
              work.
            </p>
            <Link className="mk-text-link" href="/accounting">
              Learn about Accounting <ArrowRight />
            </Link>
          </div>
          <div className="mk-feature-card__visual">
            <div className="mk-feature-card__visual-scale">
              <DashboardMockup />
            </div>
          </div>
        </Reveal>
      </div>
      <div className="mk-feature-grid__row mk-feature-grid__row--bottom">
        <Reveal as="article" variant="up" className="mk-feature-card mk-feature-card--grey">
          <span className="mk-feature-card__icon">
            <Bot aria-hidden="true" />
          </span>
          <h3>ValueBooks AI</h3>
          <p>Get clear, evidence-backed answers grounded in your own financial data.</p>
          <Link className="mk-text-link" href="/ai">
            Learn about AI <ArrowRight />
          </Link>
        </Reveal>
        <Reveal
          as="article"
          variant="up"
          delay={revealDelay(1)}
          className="mk-feature-card mk-feature-card--navy"
        >
          <span className="mk-feature-card__icon">
            <LockKeyhole aria-hidden="true" />
          </span>
          <h3>Security</h3>
          <p>Role-based access, audit trails, and responsible safeguards by default.</p>
          <Link className="mk-text-link mk-text-link--on-dark" href="/security">
            Learn about Security <ArrowRight />
          </Link>
        </Reveal>
        <Reveal
          as="article"
          variant="up"
          delay={revealDelay(2)}
          className="mk-feature-card mk-feature-card--gold"
        >
          <h3>More features</h3>
          <ul className="mk-feature-card__links">
            {moreFeatureLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>
                  {link.label} <ArrowRight />
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
const industryPhotos: Record<string, string> = {
  retail: 'photo-1441986300917-64674bd600d8',
  ecommerce: 'photo-1472851294608-062f824d29cc',
  agencies: 'photo-1522071820081-009f0129c71c',
  restaurants: 'photo-1517248135467-4c7edcad34c4',
  construction: 'photo-1541888946425-d81bb19240f5',
  'professional-services': 'photo-1600880292203-757bb62b4baf',
};
export function IndustriesGrid() {
  const entries: ReadonlyArray<readonly [string, string]> = [
    ['retail', 'Retail'],
    ['ecommerce', 'E-commerce'],
    ['agencies', 'Agencies & consultants'],
    ['restaurants', 'Restaurants & hospitality'],
    ['construction', 'Construction & trades'],
    ['professional-services', 'Professional services'],
  ];
  return (
    <div className="mk-industries-grid">
      {entries.map(([slug, title], index) => (
        <Reveal
          as={Link}
          href={`/industries/${slug}`}
          delay={revealDelay(index)}
          className="mk-industry-card"
          key={slug}
        >
          <Photo id={industryPhotos[slug] ?? ''} alt={`${title} business`} ratio="16 / 9" />
          <div>
            <h3>{title}</h3>
            <span>
              Explore solutions <ArrowRight />
            </span>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
const businessBenefits = [
  {
    title: 'Stay on Top of Every Transaction',
    description:
      'Keep invoices, expenses, and payments organized, so you always know where your money is going.',
    Icon: ReceiptText,
  },
  {
    title: 'Understand Your Financial Position',
    description:
      'Turn everyday financial activity into clear reports that help you make informed decisions.',
    Icon: ChartColumnIncreasing,
  },
  {
    title: 'Spend Less Time on Manual Work',
    description:
      'Simplify recurring tasks, keep records connected, and focus more energy on growing your business.',
    Icon: Workflow,
  },
];
export function BusinessValueGrid() {
  return (
    <div className="mk-business-value-grid">
      {businessBenefits.map(({ Icon, title, description }, index) => (
        <Reveal
          as="article"
          delay={revealDelay(index)}
          className="mk-business-value-card"
          key={title}
        >
          <Icon aria-hidden="true" />
          <h3>{title}</h3>
          <p>{description}</p>
        </Reveal>
      ))}
    </div>
  );
}
export function TrustNote() {
  return (
    <div className="mk-trust-note">
      <LockKeyhole aria-hidden="true" /> Your information is handled with responsible safeguards.
    </div>
  );
}
