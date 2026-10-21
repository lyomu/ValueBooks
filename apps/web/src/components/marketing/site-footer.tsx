import { LockKeyhole } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { appUrl } from '../../lib/site-hosts';

const columns: ReadonlyArray<{ title: string; links: ReadonlyArray<readonly [string, string]> }> = [
  {
    title: 'Product',
    links: [
      ['/product', 'Platform overview'],
      ['/pricing', 'Pricing'],
      ['/invoicing', 'Invoicing'],
      ['/accounting', 'Accounting'],
      ['/ai', 'ValueBooks AI'],
    ],
  },
  {
    title: 'Solutions',
    links: [
      ['/industries', 'Industries'],
      ['/industries/retail', 'Retail'],
      ['/industries/ecommerce', 'E-commerce'],
      ['/industries/agencies-consultants', 'Agencies & consultants'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['/customers', 'Customer stories'],
      ['/security', 'Security'],
      ['/contact', 'Contact sales'],
      [appUrl('/login'), 'Sign in'],
    ],
  },
];
export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer__grid">
        <div className="mk-footer__brand">
          <Link className="mk-brand mk-brand--footer" href="/">
            <Image src="/logo-full-white.png" alt="ValueBooks" height={26} width={129} />
          </Link>
          <p>
            Clearer books, calmer decisions, and a capable AI partner when you need one. Built for
            business owners who want to spend less time untangling admin and more time moving work
            forward.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h3>{column.title}</h3>
            <ul>
              {column.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mk-footer__secure">
          <LockKeyhole aria-hidden="true" />
          <strong>Designed for responsible financial work.</strong>
          <p>
            Data is encrypted in transit and at rest. Security controls grow with your business.
          </p>
          <Link href="/security">Our security approach →</Link>
        </div>
      </div>
      <div className="mk-footer__legal">
        <span>© {new Date().getFullYear()} ValueBooks</span>
        <nav className="mk-footer__legal-links" aria-label="Legal">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms and Conditions</Link>
          <Link href="/accessibility">Accessibility</Link>
          <Link href="/data-privacy-deletion">Data Privacy &amp; Deletion</Link>
        </nav>
      </div>
    </footer>
  );
}
