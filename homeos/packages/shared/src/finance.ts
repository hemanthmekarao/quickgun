import { daysBetween, isoDate } from './dates';
import type { ExpenseCategory } from './resources';
import { parseDate } from './validate';

/* ------------------------------------------------------------------ */
/* Automatic categorisation (keyword rules; deterministic)             */
/* ------------------------------------------------------------------ */

const CATEGORY_RULES: [ExpenseCategory, RegExp][] = [
  ['FOOD_DELIVERY', /\b(swiggy|zomato|food ?panda|uber ?eats|eatsure|dominos|domino's)\b/i],
  ['GROCERIES', /\b(grocer|bigbasket|big basket|blinkit|zepto|instamart|dmart|d-mart|reliance fresh|more supermarket|kirana|vegetable|milk|supermarket)\b/i],
  ['FUEL', /\b(petrol|diesel|fuel|hpcl|bpcl|iocl|indian ?oil|bharat petroleum|hindustan petroleum|shell|cng)\b/i],
  ['UTILITIES', /\b(electricity|bescom|msedcl|tata power|adani electricity|bses|water bill|water board|bwssb|gas bill|piped gas|lpg|indane|hp gas|bharat ?gas|broadband|airtel|jio|vodafone|vi postpaid|bsnl|act fibernet|dth|tata play|dish ?tv|recharge)\b/i],
  ['SUBSCRIPTIONS', /\b(netflix|prime video|amazon prime|hotstar|disney|spotify|youtube premium|apple music|icloud|google one|dropbox|subscription|membership)\b/i],
  ['HOME_LOAN_EMI', /\b(home loan|housing loan|emi)\b/i],
  ['RENT', /\b(rent|lease payment)\b/i],
  ['STAFF_SALARY', /\b(salary|wages|maid|cook|driver salary|gardener)\b/i],
  ['INSURANCE', /\b(insurance|premium|lic\b|hdfc ergo|icici lombard|star health|policy ?bazaar)\b/i],
  ['HEALTHCARE', /\b(hospital|clinic|pharmacy|chemist|medical|doctor|diagnostic|lab test|apollo|medplus|1mg|pharmeasy|dental)\b/i],
  ['EDUCATION', /\b(school|tuition|college|fees|course|udemy|coursera|books?)\b/i],
  ['VEHICLE', /\b(car service|bike service|service centre|service center|tyre|car wash|parking|toll|fastag|puc)\b/i],
  ['MAINTENANCE', /\b(plumb|electrician|carpenter|painting|pest control|repair|maintenance|urban ?company|society maintenance|amc)\b/i],
  ['TRAVEL', /\b(flight|airline|indigo|air india|vistara|irctc|train|hotel|makemytrip|goibibo|cleartrip|airbnb|uber|ola|cab|taxi)\b/i],
  ['DINING', /\b(restaurant|cafe|coffee|starbucks|dine|bar\b|pub\b|bistro)\b/i],
  ['ENTERTAINMENT', /\b(movie|pvr|inox|bookmyshow|concert|game|gaming)\b/i],
  ['ELECTRONICS', /\b(croma|reliance digital|vijay sales|laptop|mobile phone|iphone|television|electronics)\b/i],
  ['FURNITURE', /\b(furniture|ikea|pepperfry|urban ladder|sofa|mattress)\b/i],
  ['CLOTHING', /\b(clothing|apparel|myntra|ajio|zara|h&m|westside|shoes|footwear|tailor)\b/i],
  ['HOUSEHOLD_SUPPLIES', /\b(detergent|cleaning supplies|household|toiletries|utensil)\b/i],
  ['TAXES', /\b(property tax|income tax|advance tax|tds|gst payment|municipal tax)\b/i],
  ['GIFTS_DONATIONS', /\b(gift|donation|charity|temple)\b/i],
  ['PERSONAL_CARE', /\b(salon|spa|haircut|grooming|gym)\b/i],
  ['SHOPPING', /\b(amazon|flipkart|meesho|nykaa|mall|shopping)\b/i],
];

export function categoriseExpense(description: string, merchant?: string | null): ExpenseCategory {
  const text = `${merchant ?? ''} ${description ?? ''}`;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'OTHER';
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

export interface ExpenseLike {
  id?: string;
  date: Date | string;
  amount: number;
  description?: string | null;
  merchant?: string | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : (parseDate(d) ?? new Date(d));
}

/** Same amount, within one day, and overlapping merchant/description text. */
export function isLikelyDuplicate(a: ExpenseLike, b: ExpenseLike): boolean {
  if (Math.abs(Number(a.amount) - Number(b.amount)) > 0.005) return false;
  if (Math.abs(daysBetween(asDate(a.date), asDate(b.date))) > 1) return false;
  const ta = norm(`${a.merchant ?? ''} ${a.description ?? ''}`);
  const tb = norm(`${b.merchant ?? ''} ${b.description ?? ''}`);
  if (!ta || !tb) return true;
  if (ta === tb || ta.includes(tb) || tb.includes(ta)) return true;
  const wa = new Set(ta.split(' ').filter((w) => w.length > 2));
  const shared = tb.split(' ').filter((w) => w.length > 2 && wa.has(w));
  return shared.length > 0;
}

export function findDuplicates<T extends ExpenseLike>(candidate: ExpenseLike, existing: T[]): T[] {
  return existing.filter((e) => (!candidate.id || e.id !== candidate.id) && isLikelyDuplicate(candidate, e));
}

/** Stable fingerprint of a bank statement line, used to skip re-imported rows. */
export function transactionFingerprint(t: {
  date: Date | string;
  amount: number;
  direction: string;
  description: string;
  reference?: string | null;
}): string {
  return [isoDate(asDate(t.date)), Number(t.amount).toFixed(2), t.direction, norm(t.description), norm(t.reference)].join('|');
}

/* ------------------------------------------------------------------ */
/* Bank statement CSV import                                           */
/* ------------------------------------------------------------------ */

export interface ParsedBankRow {
  date: string;
  description: string;
  amount: number;
  direction: 'DEBIT' | 'CREDIT';
  reference?: string;
  balanceAfter?: number;
}

export interface BankCsvResult {
  rows: ParsedBankRow[];
  errors: { line: number; message: string }[];
}

/** RFC-4180-style CSV parsing (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse the date formats commonly found in Indian bank statements.
 * Ambiguous numeric dates are read day-first (DD/MM/YYYY).
 */
export function parseLooseDate(value: string): string | null {
  const s = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ ,-]+(\d{2,4})$/.exec(s))) {
    d = Number(match[1]);
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return parseDate(iso) ? iso : null;
}

function parseAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const s = value.replace(/[₹,\s]|rs\.?|inr/gi, '').trim();
  if (!s || s === '-') return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || /dr$/i.test(s);
  const n = Number(s.replace(/[()]/g, '').replace(/^-/, '').replace(/(cr|dr)$/i, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function findCol(header: string[], patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = header.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Parse a bank statement CSV. Supports either separate debit/credit columns or a single signed
 * amount column (optionally with a Dr/Cr type column). Rows that cannot be parsed are reported,
 * never guessed.
 */
export function parseBankCsv(text: string): BankCsvResult {
  const table = parseCsv(text);
  const errors: BankCsvResult['errors'] = [];
  const headerIdx = table.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
  if (headerIdx < 0) return { rows: [], errors: [{ line: 1, message: 'No header row with a date column was found' }] };
  const header = table[headerIdx].map((h) => h.trim().toLowerCase());
  const col = {
    date: findCol(header, [/^(txn|transaction|tran)\.? ?date$/, /^date$/, /value date/, /date/]),
    desc: findCol(header, [/narration/, /description/, /particulars/, /remarks/, /details/]),
    debit: findCol(header, [/withdrawal/, /debit/, /^dr\b/]),
    credit: findCol(header, [/deposit/, /credit/, /^cr\b/]),
    amount: findCol(header, [/^amount/, /amount/]),
    type: findCol(header, [/^(dr ?\/ ?cr|cr ?\/ ?dr|type|txn type)$/]),
    ref: findCol(header, [/ref/, /chq|cheque/, /utr/]),
    balance: findCol(header, [/balance/]),
  };
  if (col.date < 0 || col.desc < 0) {
    return { rows: [], errors: [{ line: headerIdx + 1, message: 'Date and description columns are required' }] };
  }
  const hasSplit = col.debit >= 0 || col.credit >= 0;
  if (!hasSplit && col.amount < 0) {
    return { rows: [], errors: [{ line: headerIdx + 1, message: 'No amount, debit or credit column was found' }] };
  }
  const rows: ParsedBankRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const date = parseLooseDate(r[col.date] ?? '');
    if (!date) {
      errors.push({ line, message: `Unrecognised date "${(r[col.date] ?? '').trim()}"` });
      continue;
    }
    let amount: number | null = null;
    let direction: 'DEBIT' | 'CREDIT' | null = null;
    if (hasSplit) {
      const debit = col.debit >= 0 ? parseAmount(r[col.debit]) : null;
      const credit = col.credit >= 0 ? parseAmount(r[col.credit]) : null;
      if (debit && Math.abs(debit) > 0) {
        amount = Math.abs(debit);
        direction = 'DEBIT';
      } else if (credit && Math.abs(credit) > 0) {
        amount = Math.abs(credit);
        direction = 'CREDIT';
      }
    } else {
      const signed = parseAmount(r[col.amount]);
      if (signed !== null && signed !== 0) {
        amount = Math.abs(signed);
        const type = col.type >= 0 ? (r[col.type] ?? '').trim().toLowerCase() : '';
        if (type.startsWith('cr') || type === 'credit') direction = 'CREDIT';
        else if (type.startsWith('dr') || type === 'debit') direction = 'DEBIT';
        else direction = signed < 0 ? 'DEBIT' : 'CREDIT';
      }
    }
    if (amount === null || direction === null) {
      errors.push({ line, message: 'No amount found' });
      continue;
    }
    const row: ParsedBankRow = { date, description: (r[col.desc] ?? '').trim() || 'Transaction', amount, direction };
    const ref = col.ref >= 0 ? (r[col.ref] ?? '').trim() : '';
    if (ref) row.reference = ref;
    const bal = col.balance >= 0 ? parseAmount(r[col.balance]) : null;
    if (bal !== null) row.balanceAfter = bal;
    rows.push(row);
  }
  return { rows, errors };
}

/* ------------------------------------------------------------------ */
/* Ledger posting: which records become an Expense automatically       */
/* ------------------------------------------------------------------ */

export interface LedgerEntry {
  date: Date;
  amount: number;
  kind: 'EXPENSE';
  category: ExpenseCategory;
  description: string;
  merchant?: string | null;
  paymentMethod?: string | null;
  bankAccountId?: string | null;
  propertyId?: string | null;
  memberId?: string | null;
  vendorId?: string | null;
}

const PURCHASE_CATEGORY: Record<string, ExpenseCategory> = {
  GROCERY: 'GROCERIES',
  SUPERMARKET: 'GROCERIES',
  ONLINE: 'SHOPPING',
  RESTAURANT: 'DINING',
  FOOD_DELIVERY: 'FOOD_DELIVERY',
  ELECTRONICS: 'ELECTRONICS',
  FURNITURE: 'FURNITURE',
  CLOTHING: 'CLOTHING',
  HOUSEHOLD_SUPPLIES: 'HOUSEHOLD_SUPPLIES',
  OTHER: 'SHOPPING',
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const date = (v: unknown): Date | null => (v instanceof Date ? v : parseDate(v));

/** Resources whose records are mirrored into the expense ledger. */
export const LEDGER_SOURCES = [
  'bills',
  'salaries',
  'fuel-logs',
  'vehicle-services',
  'work-orders',
  'medical-records',
  'purchases',
  'travel-bookings',
] as const;

/**
 * Returns the expense that should exist for a source record, or null when none should
 * (e.g. an unpaid bill). `related` carries labels the caller has already loaded.
 */
export function ledgerEntryFor(
  resource: string,
  r: Record<string, unknown>,
  related: { providerName?: string; utilityType?: string; propertyId?: string | null; staffName?: string; vehicleName?: string } = {},
): LedgerEntry | null {
  const base = {
    kind: 'EXPENSE' as const,
    paymentMethod: (r.paymentMethod as string) ?? null,
    bankAccountId: (r.bankAccountId as string) ?? null,
  };
  switch (resource) {
    case 'bills': {
      if (r.status !== 'PAID' && r.status !== 'PARTIALLY_PAID') return null;
      const amount = num(r.paidAmount) || (r.status === 'PAID' ? num(r.amount) + num(r.lateFee) : 0);
      const d = date(r.paidDate) ?? date(r.dueDate);
      if (!d || amount <= 0) return null;
      const category: ExpenseCategory =
        related.utilityType === 'PROPERTY_TAX' ? 'TAXES' : related.utilityType === 'SOCIETY_MAINTENANCE' ? 'MAINTENANCE' : 'UTILITIES';
      return {
        ...base,
        date: d,
        amount,
        category,
        description: `Bill payment — ${related.providerName ?? 'utility'}`,
        merchant: related.providerName ?? null,
        propertyId: related.propertyId ?? null,
      };
    }
    case 'salaries': {
      if (r.status !== 'PAID' && r.status !== 'PARTIALLY_PAID') return null;
      const amount = num(r.paidAmount) || (r.status === 'PAID' ? num(r.netAmount) : 0);
      const d = date(r.paidDate) ?? date(r.dueDate);
      if (!d || amount <= 0) return null;
      return {
        ...base,
        date: d,
        amount,
        category: 'STAFF_SALARY',
        description: `Salary ${String(r.month ?? '')} — ${related.staffName ?? 'staff'}`.trim(),
        merchant: related.staffName ?? null,
      };
    }
    case 'fuel-logs': {
      const d = date(r.date);
      if (!d || num(r.totalCost) <= 0) return null;
      return {
        ...base,
        date: d,
        amount: num(r.totalCost),
        category: 'FUEL',
        description: `Fuel — ${related.vehicleName ?? 'vehicle'}`,
        merchant: (r.station as string) ?? null,
      };
    }
    case 'vehicle-services': {
      const d = date(r.date);
      if (!d || num(r.totalCost) <= 0) return null;
      return {
        ...base,
        date: d,
        amount: num(r.totalCost),
        category: 'VEHICLE',
        description: `Vehicle service — ${related.vehicleName ?? 'vehicle'}`,
        merchant: (r.serviceCentre as string) ?? null,
        vendorId: (r.vendorId as string) ?? null,
      };
    }
    case 'work-orders': {
      if (r.status !== 'PAID') return null;
      const amount = num(r.paidAmount) || num(r.invoiceAmount);
      const d = date(r.paidDate) ?? date(r.completedAt);
      if (!d || amount <= 0) return null;
      return {
        ...base,
        date: d,
        amount,
        category: 'MAINTENANCE',
        description: `Maintenance — ${String(r.title ?? 'work order')}`,
        vendorId: (r.vendorId as string) ?? null,
        propertyId: related.propertyId ?? null,
      };
    }
    case 'medical-records': {
      const d = date(r.date);
      if (!d || num(r.amount) <= 0) return null;
      // Deliberately generic: the ledger is visible to finance roles that may not see medical data.
      return { ...base, date: d, amount: num(r.amount), category: 'HEALTHCARE', description: 'Healthcare expense' };
    }
    case 'purchases': {
      const d = date(r.date);
      const refunded = r.returnStatus === 'REFUNDED' ? num(r.refundAmount) : 0;
      const amount = Math.round((num(r.amount) - refunded) * 100) / 100;
      if (!d || amount <= 0) return null;
      return {
        ...base,
        date: d,
        amount,
        category: PURCHASE_CATEGORY[String(r.category)] ?? 'SHOPPING',
        description: String(r.itemName ?? 'Purchase'),
        merchant: (r.merchant as string) ?? null,
        memberId: (r.memberId as string) ?? null,
        propertyId: (r.propertyId as string) ?? null,
        vendorId: (r.vendorId as string) ?? null,
      };
    }
    case 'travel-bookings': {
      const d = date(r.startDate);
      if (!d || r.status === 'CANCELLED' || num(r.amount) <= 0) return null;
      return {
        ...base,
        date: d,
        amount: num(r.amount),
        category: 'TRAVEL',
        description: `Travel — ${String(r.tripName ?? 'booking')}`,
        merchant: (r.provider as string) ?? null,
        memberId: (r.memberId as string) ?? null,
      };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Vehicle analytics                                                   */
/* ------------------------------------------------------------------ */

export interface FuelEntry {
  date: Date | string;
  odometer: number;
  quantity: number;
  totalCost: number;
  fullTank?: boolean | null;
}

export interface MileagePoint {
  date: string;
  distanceKm: number;
  quantity: number;
  kmPerUnit: number;
}

/**
 * Full-tank-to-full-tank mileage. Fuel added in partial fills between two full fills is
 * attributed to the segment that ends at the next full fill.
 */
export function computeMileage(entries: FuelEntry[]): { points: MileagePoint[]; averageKmPerUnit: number | null; costPerKm: number | null } {
  const sorted = [...entries].sort((a, b) => Number(a.odometer) - Number(b.odometer));
  const points: MileagePoint[] = [];
  let lastFull: FuelEntry | null = null;
  let pendingQty = 0;
  let pendingCost = 0;
  let totalDist = 0;
  let totalQty = 0;
  let totalCost = 0;
  for (const e of sorted) {
    const full = e.fullTank !== false;
    if (!lastFull) {
      if (full) lastFull = e;
      continue;
    }
    pendingQty += Number(e.quantity);
    pendingCost += Number(e.totalCost);
    if (full) {
      const dist = Number(e.odometer) - Number(lastFull.odometer);
      if (dist > 0 && pendingQty > 0) {
        points.push({
          date: isoDate(asDate(e.date)),
          distanceKm: dist,
          quantity: pendingQty,
          kmPerUnit: Math.round((dist / pendingQty) * 100) / 100,
        });
        totalDist += dist;
        totalQty += pendingQty;
        totalCost += pendingCost;
      }
      lastFull = e;
      pendingQty = 0;
      pendingCost = 0;
    }
  }
  return {
    points,
    averageKmPerUnit: totalQty > 0 ? Math.round((totalDist / totalQty) * 100) / 100 : null,
    costPerKm: totalDist > 0 ? Math.round((totalCost / totalDist) * 100) / 100 : null,
  };
}

/* ------------------------------------------------------------------ */
/* Appliance replacement recommendation                                */
/* ------------------------------------------------------------------ */

export interface ReplacementAdvice {
  level: 'OK' | 'MONITOR' | 'REPLACE_SOON';
  reasons: string[];
}

export function replacementAdvice(
  a: { purchaseDate?: Date | string | null; purchasePrice?: number | null; expectedLifeYears?: number | null; condition?: string | null },
  repairCostTotal: number,
  today: Date = new Date(),
): ReplacementAdvice {
  const reasons: string[] = [];
  let score = 0;
  const purchased = a.purchaseDate ? asDate(a.purchaseDate) : null;
  if (purchased && a.expectedLifeYears) {
    const age = daysBetween(purchased, today) / 365.25;
    if (age >= a.expectedLifeYears) {
      score += 2;
      reasons.push(`Past its expected life of ${a.expectedLifeYears} years (${age.toFixed(1)} years old)`);
    } else if (age >= a.expectedLifeYears * 0.8) {
      score += 1;
      reasons.push(`Nearing its expected life of ${a.expectedLifeYears} years (${age.toFixed(1)} years old)`);
    }
  }
  if (a.condition === 'NOT_WORKING') {
    score += 2;
    reasons.push('Marked as not working');
  } else if (a.condition === 'POOR') {
    score += 1;
    reasons.push('Condition is poor');
  }
  const price = Number(a.purchasePrice ?? 0);
  if (price > 0 && repairCostTotal >= price * 0.5) {
    score += 2;
    reasons.push('Repair spend has reached 50% or more of the purchase price');
  } else if (price > 0 && repairCostTotal >= price * 0.3) {
    score += 1;
    reasons.push('Repair spend has reached 30% or more of the purchase price');
  }
  return { level: score >= 2 ? 'REPLACE_SOON' : score === 1 ? 'MONITOR' : 'OK', reasons };
}

/* ------------------------------------------------------------------ */
/* Spending anomaly detection                                          */
/* ------------------------------------------------------------------ */

export interface Anomaly {
  category: string;
  current: number;
  average: number;
  ratio: number;
}

/**
 * Flags categories whose spend this month is well above their own trailing average.
 * `history` is the list of previous months' totals for that category (zeros included).
 */
export function detectAnomalies(
  current: Record<string, number>,
  history: Record<string, number[]>,
  opts: { ratio?: number; minAmount?: number } = {},
): Anomaly[] {
  const ratio = opts.ratio ?? 1.5;
  const minAmount = opts.minAmount ?? 1000;
  const out: Anomaly[] = [];
  for (const [category, value] of Object.entries(current)) {
    const past = history[category] ?? [];
    if (past.length < 2) continue;
    const average = past.reduce((s, x) => s + x, 0) / past.length;
    if (average <= 0) continue;
    if (value >= minAmount && value >= average * ratio) {
      out.push({ category, current: value, average: Math.round(average * 100) / 100, ratio: Math.round((value / average) * 100) / 100 });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
