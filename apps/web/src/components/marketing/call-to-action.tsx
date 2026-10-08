import Link from 'next/link';

/**
 * The single closing moment of every marketing page: one saturated brand band, one headline, one
 * button. It is rendered by the marketing layout rather than by each page, so the public site
 * cannot drift into the stacked, near-duplicate calls to action it used to end with.
 */
export function CallToAction({
  kicker = 'Ready when you are',
  title = 'Make room for the work that moves your business forward.',
  action = { href: '/signup', label: 'Get started' },
}: {
  kicker?: string;
  title?: string;
  action?: { href: string; label: string };
} = {}) {
  return (
    <section className="mk-cta">
      <p className="mk-kicker">{kicker}</p>
      <h2>{title}</h2>
      <Link className="mk-button mk-button--contrast" href={action.href}>
        {action.label}
      </Link>
    </section>
  );
}
