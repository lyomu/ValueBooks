import type { Metadata } from 'next';
import Link from 'next/link';

import { BrandLogo } from '../../components/brand-logo';
import { OnboardingWizard } from '../../components/onboarding-wizard';

export const metadata: Metadata = { title: 'Set up your organization | ValueBooks' };

export default function OnboardingPage() {
  return (
    <main className="rb-onboarding-page" id="main-content">
      <header className="rb-onboarding-page__header">
        <Link className="rb-onboarding-page__brand" href="/dashboard" aria-label="ValueBooks home">
          <BrandLogo height={30} priority />
          <small>Organization setup</small>
        </Link>
        <p>Your answers become the accounting foundation for this organization.</p>
      </header>

      <OnboardingWizard />
    </main>
  );
}
