import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import type { ReactNode } from 'react';

import '@valuebooks/ui/tokens.css';
import '@valuebooks/ui/styles.css';
import './styles.css';

/**
 * One typeface for the whole product, public site included, loaded once through next/font so it is
 * self-hosted and does not block rendering the way the stylesheet @import it replaced did.
 */
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-outfit',
});

export const metadata: Metadata = {
  title: 'ValueBooks',
  description:
    'AI invoicing and accounting that keeps small businesses clear, organized, and ready for what is next.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <a className="rb-skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
