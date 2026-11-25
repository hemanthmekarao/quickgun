/** Date helpers. All business dates are handled as UTC calendar days. */

import type { Recurrence } from './resources';

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

export function addDays(d: Date, days: number): Date {
  return new Date(startOfDay(d).getTime() + days * DAY_MS);
}

/** Add calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

/** 'YYYY-MM' key for a date. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function nextOccurrence(d: Date, recurrence: Recurrence | string | null | undefined): Date | null {
  switch (recurrence) {
    case 'WEEKLY':
      return addDays(d, 7);
    case 'MONTHLY':
      return addMonths(d, 1);
    case 'BIMONTHLY':
      return addMonths(d, 2);
    case 'QUARTERLY':
      return addMonths(d, 3);
    case 'HALF_YEARLY':
      return addMonths(d, 6);
    case 'YEARLY':
      return addMonths(d, 12);
    default:
      return null;
  }
}

/** Number of billing cycles per year, used for annualised cost. */
export function cyclesPerYear(cycle: string | null | undefined): number {
  switch (cycle) {
    case 'WEEKLY':
      return 52;
    case 'MONTHLY':
      return 12;
    case 'BIMONTHLY':
      return 6;
    case 'QUARTERLY':
      return 4;
    case 'HALF_YEARLY':
      return 2;
    case 'YEARLY':
    case 'SINGLE':
      return 1;
    default:
      return 0;
  }
}

/** The given day-of-month in the month of `ref`, clamped to the month's length. */
export function dayInMonth(ref: Date, day: number): Date {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(Math.max(day, 1), last)));
}
