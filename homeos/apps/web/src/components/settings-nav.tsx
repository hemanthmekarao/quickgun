'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/format';
import { useSession } from '@/lib/session';

export function SettingsNav() {
  const pathname = usePathname();
  const session = useSession();
  const items = [
    { href: '/settings', label: 'Household & privacy' },
    { href: '/settings/users', label: 'Users & roles' },
    ...(session.can('settings') ? [{ href: '/settings/integrations', label: 'Integrations' }] : []),
    { href: '/settings/security', label: 'Security' },
  ];
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={pathname === i.href ? 'page' : undefined} className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', pathname === i.href ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
