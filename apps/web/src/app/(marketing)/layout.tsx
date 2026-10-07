import { Hanken_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';

import '@valuebooks/ui/tokens.css';
import './marketing.css';
import './marketing-additions.css';

import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-hanken-grotesk',
});

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`mk-root ${hankenGrotesk.variable}`}>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
