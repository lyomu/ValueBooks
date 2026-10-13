import { BookOpenCheck, Building2, FileText, Landmark, Users } from 'lucide-react';
import Link from 'next/link';

const tasks = [
  { title: 'Review chart of accounts', text: 'Confirm the starter accounts ValueBooks uses to organize your books.', href: '/accounts', action: 'Review accounts', icon: BookOpenCheck },
  { title: 'Enter opening balances', text: 'Bring in balances from your previous accounting system.', href: '/opening-balances', action: 'Enter balances', icon: Landmark },
  { title: 'Customize your invoices', text: 'Set document preferences before you send your first invoice.', href: '/settings', action: 'Customize invoices', icon: FileText },
  { title: 'Invite your team', text: 'Give colleagues the right access for their work.', href: '/settings/team', action: 'Invite team', icon: Users },
  { title: 'Add products and services', text: 'Build your catalog for faster invoicing and purchasing.', href: '/catalog/items', action: 'Add items', icon: Building2 },
];
export function GettingStarted() { return <section className="rb-getting-started"><header><p className="rb-page-kicker">Getting Started</p><h1>Welcome to ValueBooks</h1><p>Let&apos;s get your business ready to manage finances confidently.</p></header><div className="rb-getting-started__progress" aria-label="Setup progress"><span style={{ width: '15%' }} /></div><p className="rb-getting-started__count">Complete tasks as you configure your workspace. Optional tasks never block access.</p><div className="rb-getting-started__grid">{tasks.map(({ title, text, href, action, icon: Icon }) => <article key={title}><Icon aria-hidden="true" /><div><h2>{title}</h2><p>{text}</p><Link href={href}>{action}</Link></div></article>)}</div></section>; }
