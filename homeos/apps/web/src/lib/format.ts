import { humanize } from '@homeos/shared';

export function money(amount: number | null | undefined, currency = 'INR', opts: { compact?: boolean } = {}): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
      style: 'currency',
      currency,
      maximumFractionDigits: opts.compact ? 1 : Number.isInteger(Number(amount)) ? 0 : 2,
      ...(opts.compact ? { notation: 'compact' as const } : {}),
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

/** 'YYYY-MM-DD' or ISO timestamp → "5 Nov 2026". Dates are calendar days, so no timezone shifting. */
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const a = Date.parse(`${todayIso()}T00:00:00Z`);
  const b = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function relativeDay(value: string | null | undefined): string {
  const d = daysUntil(value);
  if (d === null) return '';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function label(value: string | null | undefined): string {
  return value ? humanize(value) : '—';
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
