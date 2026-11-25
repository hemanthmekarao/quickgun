'use client';

import { cx } from '@/lib/format';

const PALETTE = ['#2b4ae0', '#0f9d76', '#d97706', '#c2410c', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f', '#64748b'];

export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length];
}

/** Vertical bars with value labels on hover. Accessible as a list for screen readers. */
export function BarChart({ data, format, height = 160, highlightLast }: { data: { label: string; value: number; secondary?: number }[]; format: (n: number) => string; height?: number; highlightLast?: boolean }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted">No data yet.</p>;
  return (
    <div>
      <ul className="flex items-end gap-1.5" style={{ height }} aria-label="Bar chart">
        {data.map((d, i) => (
          <li key={d.label + i} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5" title={`${d.label}: ${format(d.value)}`}>
            {d.secondary !== undefined ? (
              <span className="w-1/2 max-w-[14px] rounded-t bg-line" style={{ height: `${Math.max(d.secondary > 0 ? 2 : 0, (d.secondary / max) * 100)}%` }} aria-hidden />
            ) : null}
            <span
              className={cx('w-full max-w-[28px] rounded-t transition-opacity group-hover:opacity-80', highlightLast && i === data.length - 1 ? 'bg-accent' : 'bg-ink/80')}
              style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (Math.max(d.value, 0) / max) * 100)}%` }}
            />
            <span className="sr-only">
              {d.label}: {format(d.value)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1.5">
        {data.map((d, i) => (
          <span key={d.label + i} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut with legend. Negative or zero slices are ignored. */
export function Donut({ data, format, size = 132 }: { data: { label: string; value: number }[]; format: (n: number) => string; size?: number }) {
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <p className="py-8 text-center text-sm text-muted">No spending recorded for this period.</p>;
  const r = 15.9155; // circumference = 100
  let offset = 25;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <svg width={size} height={size} viewBox="0 0 42 42" role="img" aria-label="Breakdown chart" className="shrink-0">
        <circle cx="21" cy="21" r={r} fill="none" stroke="rgb(var(--subtle))" strokeWidth="5" />
        {slices.map((d, i) => {
          const pct = (d.value / total) * 100;
          const el = <circle key={d.label} cx="21" cy="21" r={r} fill="none" stroke={colorAt(i)} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} />;
          offset = (offset - pct + 100) % 100;
          return el;
        })}
      </svg>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {slices.slice(0, 7).map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorAt(i) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted">{d.label}</span>
            <span className="tabular shrink-0 font-medium">{format(d.value)}</span>
            <span className="tabular w-10 shrink-0 text-right text-xs text-muted">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
        {slices.length > 7 ? <li className="text-xs text-muted">+ {slices.length - 7} more</li> : null}
      </ul>
    </div>
  );
}

export function Progress({ percent, tone }: { percent: number; tone?: 'ok' | 'warn' | 'danger' }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-ok')} style={{ width: `${p}%` }} />
    </div>
  );
}
