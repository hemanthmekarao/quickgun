'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  Calendar,
  Car,
  CreditCard,
  FileText,
  Gem,
  HeartPulse,
  Home,
  LogOut,
  Menu,
  Moon,
  Plane,
  Plug,
  Receipt,
  Repeat,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Sun,
  Users,
  Wallet,
  Wrench,
  X,
  Cpu,
  UserCog,
} from 'lucide-react';
import type { ModuleKey } from '@homeos/shared';
import { api } from '@/lib/api';
import { cx } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Spinner } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: any;
  module?: ModuleKey;
}

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Home },
      { href: '/calendar', label: 'Calendar', icon: Calendar },
      { href: '/assistant', label: 'Assistant', icon: Bot, module: 'assistant' },
      { href: '/notifications', label: 'Notifications', icon: Bell, module: 'notifications' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/finance', label: 'Finance', icon: Wallet, module: 'finance' },
      { href: '/bills', label: 'Bills & utilities', icon: Receipt, module: 'bills' },
      { href: '/payments', label: 'Payments', icon: CreditCard, module: 'payments' },
      { href: '/subscriptions', label: 'Subscriptions', icon: Repeat, module: 'subscriptions' },
      { href: '/shopping', label: 'Shopping', icon: ShoppingCart, module: 'shopping' },
      { href: '/reports', label: 'Reports', icon: BarChart3, module: 'reports' },
    ],
  },
  {
    title: 'Home',
    items: [
      { href: '/properties', label: 'Properties', icon: Building2, module: 'properties' },
      { href: '/maintenance', label: 'Maintenance', icon: Wrench, module: 'maintenance' },
      { href: '/appliances', label: 'Appliances', icon: Plug, module: 'appliances' },
      { href: '/vehicles', label: 'Vehicles', icon: Car, module: 'vehicles' },
      { href: '/smart-home', label: 'Smart home', icon: Cpu, module: 'smarthome' },
    ],
  },
  {
    title: 'People & cover',
    items: [
      { href: '/household', label: 'Household', icon: Users },
      { href: '/staff', label: 'Staff', icon: UserCog, module: 'staff' },
      { href: '/insurance', label: 'Insurance', icon: Shield, module: 'insurance' },
      { href: '/healthcare', label: 'Healthcare', icon: HeartPulse, module: 'healthcare' },
    ],
  },
  {
    title: 'Records',
    items: [
      { href: '/documents', label: 'Documents', icon: FileText, module: 'documents' },
      { href: '/assets', label: 'Assets', icon: Gem, module: 'assets' },
      { href: '/travel', label: 'Travel', icon: Plane, module: 'travel' },
    ],
  },
  { title: 'System', items: [{ href: '/settings', label: 'Settings', icon: Settings }] },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem('homeos.theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    setDark(next);
  };
  return { dark, toggle };
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ['search', term], enabled: term.length >= 2, queryFn: () => api.get('/search', { q: term }) });
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
      <input
        className="field pl-9"
        placeholder="Search everything"
        aria-label="Search everything"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && term.length >= 2 ? (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {results.isLoading ? (
            <p className="px-3 py-2 text-sm text-muted">Searching…</p>
          ) : (results.data?.results ?? []).length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No matches.</p>
          ) : (
            results.data.results.map((r: any) => (
              <button
                key={`${r.resource}-${r.id}`}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  setQ('');
                  router.push(r.href);
                }}
              >
                <span className="min-w-0 truncate">{r.title}</span>
                <span className="shrink-0 text-xs text-muted">{r.type}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-out') router.replace('/login');
  }, [session.status, router]);
  useEffect(() => setNavOpen(false), [pathname]);

  const summary = useQuery({
    queryKey: ['notification-summary', session.household?.id],
    enabled: session.status === 'signed-in' && session.can('notifications'),
    queryFn: () => api.get('/notification-summary'),
    refetchInterval: 120_000,
  });

  if (session.status !== 'signed-in') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label={session.status === 'loading' ? 'Loading your household' : 'Redirecting'} />
      </div>
    );
  }

  if (!session.household) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-sm text-muted">You are not a member of any household.</p>
          <button className="mt-3 text-sm underline" onClick={() => session.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Main">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.module || session.can(i.module));
        if (items.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{group.title}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors', active ? 'bg-subtle font-medium text-ink' : 'text-muted hover:bg-subtle hover:text-ink')}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {item.href === '/notifications' && summary.data?.unread ? (
                        <span className={cx('ml-auto rounded-full px-1.5 text-[11px] font-medium', summary.data.critical ? 'bg-danger text-white' : 'bg-ink text-bg')}>{summary.data.unread}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-bg">
        <Home className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">HomeOS</span>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        {brand}
        {nav}
      </aside>

      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" className="rounded-md p-2 text-muted hover:bg-subtle" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
        <button type="button" className="rounded-md p-1.5 text-muted hover:bg-subtle lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <div className="hidden flex-1 sm:block">
          <GlobalSearch />
        </div>
        <div className="flex flex-1 items-center justify-end gap-1.5 sm:flex-none">
          {session.households.length > 1 ? (
            <select className="field h-9 w-auto max-w-[160px] py-1" value={session.household.id} onChange={(e) => session.switchHousehold(e.target.value)} aria-label="Switch household">
              {session.households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="hidden max-w-[180px] truncate text-sm text-muted md:inline">{session.household.name}</span>
          )}
          <button type="button" className="rounded-md p-2 text-muted hover:bg-subtle hover:text-ink" onClick={theme.toggle} aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link href="/settings/security" className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:bg-subtle hover:text-ink sm:inline" title={session.user?.email}>
            {session.user?.name}
          </Link>
          <button type="button" className="rounded-md p-2 text-muted hover:bg-subtle hover:text-ink" onClick={() => session.signOut()} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
