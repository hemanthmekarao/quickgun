'use client';

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cx } from '@/lib/format';

/* ---------------- Button ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-ink text-bg hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};
const sizes = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2' };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md', icon }: { href: string; children: ReactNode; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <Link href={href} className={cx('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors', variants[variant], sizes[size])}>
      {icon}
      {children}
    </Link>
  );
}

/* ---------------- Layout primitives ---------------- */

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx('rounded-xl border border-line bg-surface shadow-card', padded && 'p-5', className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <Card>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cx('tabular mt-2 text-2xl font-semibold', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn', tone === 'ok' && 'text-ok')}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

/* ---------------- Badge ---------------- */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';
const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent/10 text-accent',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

const OK = new Set(['PAID', 'ACTIVE', 'COMPLETED', 'APPROVED', 'SUCCEEDED', 'DONE', 'ONLINE', 'RECEIVED', 'SETTLED', 'REIMBURSED', 'OWNED', 'PRESENT', 'RECOVERED', 'EXCELLENT', 'GOOD', 'OK', 'BOOKED', 'REFUNDED']);
const WARN = new Set(['PENDING', 'UNPAID', 'SCHEDULED', 'PARTIALLY_PAID', 'PENDING_REVIEW', 'AWAITING_CONFIRMATION', 'IN_PROGRESS', 'OPEN', 'INVITED', 'TRIAL', 'ON_LEAVE', 'WARNING', 'FAIR', 'HIGH', 'OUTSTANDING', 'UNDER_REVIEW', 'SUBMITTED', 'TO_BE_CLAIMED', 'CLAIMED', 'HALF_DAY', 'MONITOR', 'RECORDED_OFFLINE', 'CREATED', 'QUOTED', 'QUOTE_REQUESTED', 'REFUND_PENDING', 'RETURN_REQUESTED']);
const BAD = new Set(['OVERDUE', 'FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'LAPSED', 'CRITICAL', 'URGENT', 'OFFLINE', 'ABSENT', 'NOT_WORKING', 'POOR', 'DISPUTED', 'OVER', 'REPLACE_SOON', 'LOST', 'EXITED', 'REMOVED']);

export function statusTone(value: string | null | undefined): Tone {
  if (!value) return 'neutral';
  if (OK.has(value)) return 'ok';
  if (WARN.has(value)) return 'warn';
  if (BAD.has(value)) return 'danger';
  return 'neutral';
}

/* ---------------- Feedback ---------------- */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 rounded-full bg-subtle p-3 text-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'warn' | 'danger' | 'ok'; children: ReactNode; title?: string }) {
  const cls = { neutral: 'border-line bg-subtle text-ink', warn: 'border-warn/30 bg-warn/10 text-ink', danger: 'border-danger/30 bg-danger/10 text-ink', ok: 'border-ok/30 bg-ok/10 text-ink' }[tone];
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', cls)} role={tone === 'danger' ? 'alert' : 'note'}>
      {tone === 'warn' || tone === 'danger' ? <AlertTriangle className={cx('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-danger' : 'text-warn')} aria-hidden /> : null}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cx(title && 'mt-0.5', 'text-muted')}>{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as any;
  return (
    <Notice tone="danger" title={e?.status === 403 ? 'Not permitted' : 'Something went wrong'}>
      {String(e?.message ?? 'Please try again.')}
    </Notice>
  );
}

/* ---------------- Modal ---------------- */

export function Modal({ open, onClose, title, description, children, footer, wide }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Form bits ---------------- */

export function Field({ label, children, error, help, required }: { label: string; children: ReactNode; error?: string; help?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : help ? <span className="mt-1 block text-xs text-muted">{help}</span> : null}
    </label>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
