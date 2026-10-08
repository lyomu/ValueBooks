import { BookOpenCheck, Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

const assurances: ReadonlyArray<string> = [
  'Adaptive password hashing and protected sessions.',
  'Roles and permissions arrive with organization setup.',
  'Accounting configuration follows immediately after access.',
];

function AssurancePanel() {
  return (
    <div className="rb-auth__aside-content">
      <h2>Start with a trustworthy accounting foundation.</h2>
      <p>
        Your workspace begins with secure access, a verifiable audit trail, and organization
        boundaries built into every workflow.
      </p>
      <ul>
        {assurances.map((item) => (
          <li key={item}>
            <Check aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AuthShell({
  title,
  description,
  children,
  /**
   * `split` pairs the form with the assurance panel and is used for sign-in, where the visitor is
   * being persuaded as much as authenticated. Everything else -- sign-up, password recovery,
   * invitations -- is a single centred column so nothing competes with the task in front of them.
   */
  variant = 'centered',
  panel,
}: {
  title: string;
  description: string;
  children: ReactNode;
  variant?: 'split' | 'centered';
  panel?: ReactNode;
}) {
  const main = (
    <section className={`rb-auth__main`} aria-labelledby="auth-title">
      <div className="rb-auth__content">
        <Link className="rb-auth__brand" href="/dashboard" aria-label="ValueBooks home">
          <span className="rb-auth__brand-mark">
            <BookOpenCheck aria-hidden="true" />
          </span>
          <span>
            <strong>ValueBooks</strong>
            <small>Accounting, made operational</small>
          </span>
        </Link>
        <div className="rb-auth__heading">
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
        <p className="rb-auth__legal">
          By continuing, you agree to the ValueBooks terms and privacy policy.
        </p>
      </div>
    </section>
  );

  if (variant === 'centered') {
    return (
      <main className="rb-auth rb-auth--centered" id="main-content">
        {main}
      </main>
    );
  }

  return (
    <main className="rb-auth rb-auth--split" id="main-content">
      <aside className="rb-auth__aside" aria-label="Product assurance">
        {panel ?? <AssurancePanel />}
        <p className="rb-auth__aside-note">
          Built for business owners, finance teams, and advisers.
        </p>
      </aside>
      {main}
    </main>
  );
}
