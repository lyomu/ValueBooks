import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { IndustryLandingPage } from '../../../../components/marketing/industry-landing-page';
import { industryBySlug, industries } from '../../../../content/industries';

export function generateStaticParams() {
  return industries.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const industry = industryBySlug[slug];
  if (!industry) return {};

  const canonical = `/industries/${industry.slug}`;
  return {
    title: industry.seoTitle,
    description: industry.metaDescription,
    alternates: { canonical },
    openGraph: { title: industry.seoTitle, description: industry.metaDescription, url: canonical },
  };
}

export default async function IndustryDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = industryBySlug[slug];
  if (!industry) notFound();

  return <IndustryLandingPage industry={industry} />;
}
