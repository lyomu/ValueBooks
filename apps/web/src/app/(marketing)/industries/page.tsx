import type { Metadata } from 'next';

import { IndustryDirectoryCard } from '../../../components/marketing/industry-landing-page';
import { industries } from '../../../content/industries';
import { Reveal } from '../../../components/marketing/motion';
import { PageHero } from '../../../components/marketing/sections';

export const metadata: Metadata = {
  title: 'Industries | ValueBooks',
  description:
    'ValueBooks helps businesses across industries keep financial records organized and make more informed decisions.',
  alternates: { canonical: '/industries' },
};

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        title="Built for the way your business works."
        copy="From independent professionals to growing organizations, ValueBooks helps businesses across industries keep financial records organized and make more informed decisions."
      />
      <section className="mk-industry-directory">
        <div className="mk-container">
          <Reveal as="div" className="mk-industry-heading is-centered">
            <p className="mk-eyebrow">Find your industry</p>
            <h1>Tools that meet the financial work where it happens.</h1>
          </Reveal>
          <div className="mk-industry-directory__grid">
            {industries.map((industry, index) => (
              <IndustryDirectoryCard industry={industry} index={index} key={industry.slug} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
