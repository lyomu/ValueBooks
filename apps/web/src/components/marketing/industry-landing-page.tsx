import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  ReceiptText,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import type { Industry, IndustryAsset } from '../../content/industries';
import { FaqAccordion } from './faq-accordion';
import { PageHero } from './sections';

const benefitIcons = [ReceiptText, BarChart3, ClipboardList, BadgeCheck];

function AssetVisual({
  asset,
  industrySlug,
  className = '',
}: {
  asset: IndustryAsset;
  industrySlug: string;
  className?: string;
}) {
  return (
    <figure className={`mk-industry-photo ${className}`.trim()}>
      <Image
        src={`/images/industries/${industrySlug}/${asset.slot === 'product' ? 'product.png' : `${asset.slot}.jpg`}`}
        alt={asset.alt}
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
      />
    </figure>
  );
}

export function IndustryLandingPage({ industry }: { industry: Industry }) {
  const [primaryAsset, supportingAsset, productAsset] = industry.assets as [
    IndustryAsset,
    IndustryAsset,
    IndustryAsset,
  ];

  return (
    <article className="mk-industry-page">
      <PageHero title={industry.hero.title} copy={industry.hero.description} />

      <section className="mk-industry-section mk-industry-section--introduction">
        <div className="mk-container mk-industry-introduction">
          <div>
            <p className="mk-eyebrow">Built around your work</p>
            <h2>{industry.introduction.heading}</h2>
            {industry.introduction.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <AssetVisual asset={primaryAsset} industrySlug={industry.slug} />
        </div>
      </section>

      <section className="mk-industry-section mk-industry-section--cream">
        <div className="mk-container">
          <div className="mk-industry-heading">
            <p className="mk-eyebrow">The financial work behind the work</p>
            <h2>Common challenges for {industry.name.toLowerCase()} businesses.</h2>
          </div>
          <div className="mk-industry-challenge-grid">
            {industry.challenges.map((challenge) => (
              <article key={challenge.title}>
                <h3>{challenge.title}</h3>
                <p>{challenge.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-industry-section">
        <div className="mk-container">
          <div className="mk-industry-heading is-centered">
            <p className="mk-eyebrow">How ValueBooks helps</p>
            <h2>Bring the financial details into clearer focus.</h2>
          </div>
          <div className="mk-industry-benefit-grid">
            {industry.benefits.map((benefit, index) => {
              const Icon = benefitIcons[index]!;
              return (
                <article key={benefit.title}>
                  <Icon aria-hidden="true" />
                  <h3>{benefit.title}</h3>
                  <p>{benefit.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mk-industry-section mk-industry-section--navy">
        <div className="mk-container mk-industry-feature-layout">
          <div>
            <p className="mk-eyebrow">Relevant ValueBooks features</p>
            <h2>The tools that support your financial workflow.</h2>
            <ul>
              {industry.features.map((feature) => (
                <li key={feature}>
                  <CheckCircle2 aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          <AssetVisual
            asset={productAsset}
            industrySlug={industry.slug}
            className="mk-industry-asset--product"
          />
        </div>
      </section>

      <section className="mk-industry-section mk-industry-section--cream">
        <div className="mk-container mk-industry-workflow">
          <AssetVisual asset={supportingAsset} industrySlug={industry.slug} />
          <div>
            <p className="mk-eyebrow">A practical workflow</p>
            <h2>{industry.workflow.title}</h2>
            <ol>
              {industry.workflow.steps.map((step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mk-industry-section mk-industry-section--outcomes">
        <div className="mk-container mk-industry-outcomes">
          <p className="mk-eyebrow">A more connected financial picture</p>
          <h2>Organized records make the next business decision easier.</h2>
          <p>
            Keep everyday financial activity connected, understand where your money is going, and
            review the information that supports your next step.
          </p>
        </div>
      </section>

      <section className="mk-industry-section mk-industry-section--faq">
        <div className="mk-container mk-industry-faq-layout">
          <div>
            <p className="mk-eyebrow">Questions, answered</p>
            <h2>Frequently asked questions.</h2>
          </div>
          <FaqAccordion items={industry.faqs} />
        </div>
      </section>

      <section className="mk-industry-final-cta">
        <div className="mk-container">
          <h2>Bring more clarity to your business finances.</h2>
          <p>
            Keep your financial work organized with ValueBooks. Start your 14-day free trial and
            explore a simpler way to manage your business.
          </p>
          <Link className="mk-button mk-button--contrast" href="/signup">
            Try ValueBooks Free <ArrowRight aria-hidden="true" />
          </Link>
          <small>14 days free. No card required.</small>
        </div>
      </section>
    </article>
  );
}

export function IndustryDirectoryCard({ industry }: { industry: Industry }) {
  return (
    <Link href={`/industries/${industry.slug}`} className="mk-industry-directory-card">
      <div className="mk-industry-directory-card__image">
        <Image
          src={`/images/industries/${industry.slug}/primary.jpg`}
          alt={industry.assets[0]!.alt}
          fill
          sizes="(max-width: 64rem) 50vw, 33vw"
        />
      </div>
      <div>
        <h2>{industry.name}</h2>
        <p>{industry.shortDescription}</p>
        <span>
          Explore industry <ArrowRight aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}
