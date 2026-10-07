import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  FeatureGrid,
  FinalCta,
  IndustriesGrid,
  MarketingCopy,
  MarketingKicker,
  SectionIntro,
  SecurityStrip,
  StatBand,
  TestimonialGrid,
  TrustNote,
} from '../../components/marketing/sections';
import { Photo } from '../../components/marketing/photo';

export default function MarketingHomePage() {
  return (
    <>
      <section className="mk-home-hero mk-home-hero--spotlight">
        <div className="mk-home-hero__inner">
          <div className="mk-home-hero__copy">
            <h1>
              See what matters. <em>Move with clarity.</em>
            </h1>
            <MarketingCopy>
              Invoices, expenses, accounting, and practical next steps—kept together in one calm,
              capable workspace. Keep invoices and cash flow in view, turn financial activity into
              clear next steps, and stay in control of every decision.
            </MarketingCopy>
            <div className="mk-hero-actions">
              <Link className="mk-button mk-button--hero" href="/signup">
                Try ValueBooks free
              </Link>
              <Link className="mk-text-link mk-text-link--on-dark" href="/product">
                Explore the platform <ArrowRight />
              </Link>
            </div>
            <TrustNote />
          </div>
          <div className="mk-home-hero__visual">
            <Photo
              src="/marketing/hero-owner.jpg"
              alt="A business owner confidently reviewing their finances"
              ratio="4 / 5"
              className="mk-hero-photo"
            />
            <div className="mk-hero-copilot" aria-label="Illustrative ValueBooks AI insight">
              <div className="mk-hero-copilot__head">
                <b>ValueBooks AI</b>
                <span>Live context</span>
              </div>
              <p>Three invoices need a closer look.</p>
              <ul>
                <li>
                  <span>Due this week</span>
                  <strong>KES 94,300</strong>
                </li>
                <li>
                  <span>Suggested next step</span>
                  <strong>Review follow-ups</strong>
                </li>
              </ul>
              <Link href="/ai">
                Ask about your business <ArrowRight />
              </Link>
            </div>
            <div className="mk-floating-note">
              <span>
                <b>AI insight</b>
                <small>Context, not guesswork</small>
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="mk-logo-strip">
        <span>Trusted workflows for teams who care about the details</span>
        <div>
          <b>STUDIO MAVUNO</b>
          <b>NORTHLINE</b>
          <b>THE DAILY TABLE</b>
          <b>COMMON GROUND</b>
          <b>VERDE</b>
        </div>
      </section>
      <StatBand
        items={[
          { number: '10 hrs', label: 'saved weekly on finance admin' },
          { number: '3.2 days', label: 'faster invoice follow-up' },
          { number: '99.99%', label: 'target availability for core services' },
          { number: '140+', label: 'currencies ready to work with' },
        ]}
      />
      <FeatureGrid />
      <section className="mk-ai-section">
        <div>
          <SectionIntro
            kicker="ValueBooks AI"
            title="AI that works the books, without working around you."
            text="Ask a financial question, draft the next document, or surface activity that deserves a closer look. Turn a short prompt into an invoice-ready starting point, bring consistency to spending and bank activity, and catch unusual movement before it becomes a problem. You stay in control."
          />
          <Link className="mk-text-link" href="/ai">
            Meet ValueBooks AI <ArrowRight />
          </Link>
        </div>
        <Photo
          id="photo-1551836022-d5d88e9218df"
          alt="A business owner reviewing financial activity"
          ratio="6 / 5"
        />
      </section>
      <section className="mk-alternating">
        <Photo
          id="photo-1556761175-4b46a572b786"
          alt="A small business owner preparing an invoice"
          ratio="6 / 5"
        />
        <div>
          <SectionIntro
            kicker="Get paid"
            title="Send invoices that are a pleasure to receive."
            text="Create professional invoices and quotes from ready-made templates, automate recurring billing with thoughtful reminders, and keep credit notes and payments tracked. A customer portal gives clients shared visibility into what's outstanding."
          />
          <Link className="mk-text-link" href="/invoicing">
            Explore invoicing <ArrowRight />
          </Link>
        </div>
      </section>
      <section className="mk-alternating mk-alternating--reverse">
        <div>
          <SectionIntro
            kicker="Keep the books moving"
            title="Know what happened, then know what to do next."
            text="Keep banking, expenses, journals, accounts, and reporting close enough to act on—without turning your workday into a reconciliation marathon. Manage your chart of accounts and journal workflows, import and match bank activity, and keep financial periods, audit history, and permissions under control, with reports that stay connected to the detail."
          />
          <Link className="mk-text-link" href="/accounting">
            Explore accounting <ArrowRight />
          </Link>
        </div>
        <Photo
          id="photo-1554224155-6726b3ff858f"
          alt="A business owner reviewing bank reconciliation"
          ratio="6 / 5"
        />
      </section>
      <section className="mk-personas">
        <Photo id="photo-1552664730-d307ca884978" alt="Business owners meeting" ratio="21 / 9" />
        <div className="mk-personas__heading">
          <MarketingKicker>Your way of working</MarketingKicker>
          <h2>One financial home. Different kinds of momentum.</h2>
        </div>
        <div className="mk-personas__list">
          {[
            ['Freelancers', 'Keep clients, invoices, and spending in one clear place.'],
            ['Retail teams', 'Stay closer to cash flow and daily operations.'],
            ['Growing businesses', 'Give the whole team the right financial view.'],
          ].map(([title, text]) => (
            <Link href="/industries" key={title}>
              <h3>{title}</h3>
              <MarketingCopy>{text}</MarketingCopy>
              <span>Learn more →</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="mk-industries-section">
        <SectionIntro
          centered
          kicker="Built around your work"
          title="Accounting that makes sense in your world."
          text="Start with the things your business already needs to keep moving."
        />
        <IndustriesGrid />
      </section>
      <section className="mk-testimonial-section">
        <SectionIntro
          centered
          kicker="A calmer way forward"
          title="What changes when the numbers are clear."
        />
        <TestimonialGrid />
      </section>
      <SecurityStrip />
      <FinalCta title="A clearer view of the business starts today." />
    </>
  );
}
