import { daysBetween, isoDate } from './dates';
import type { ModuleKey } from './roles';
import type { NotificationChannel, ReminderEventType } from './resources';
import { parseDate } from './validate';

/**
 * Declarative list of every dated obligation in the system. The reminder scanner, the
 * calendar and the dashboard all read from this list so they can never disagree.
 */
export interface DatedSource {
  resource: string;
  dateField: string;
  eventType: ReminderEventType;
  module: ModuleKey;
  /** Short label of the kind of event, used in titles. */
  label: string;
  /** Records that should still produce an event. */
  active: (r: Record<string, unknown>) => boolean;
  title: (r: Record<string, unknown>, refs: Record<string, string>) => string;
  /** Field carrying an amount to show with the event, if any. */
  amountField?: string;
  /** Web route for the record. */
  href: (r: Record<string, unknown>) => string;
}

const always = () => true;
const statusIs = (...allowed: string[]) => (r: Record<string, unknown>) => allowed.includes(String(r.status));
const name = (r: Record<string, unknown>, key = 'name') => String(r[key] ?? '').trim();

export const DATED_SOURCES: DatedSource[] = [
  {
    resource: 'bills',
    dateField: 'dueDate',
    eventType: 'BILL_DUE',
    module: 'bills',
    label: 'Bill due',
    active: statusIs('UNPAID', 'SCHEDULED', 'PARTIALLY_PAID', 'DISPUTED'),
    title: (_r, refs) => `${refs.providerId ?? 'Bill'} bill due`,
    amountField: 'amount',
    href: () => '/bills',
  },
  {
    resource: 'insurance-policies',
    dateField: 'expiryDate',
    eventType: 'INSURANCE_RENEWAL',
    module: 'insurance',
    label: 'Insurance renewal',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} renewal`,
    amountField: 'premiumAmount',
    href: () => '/insurance',
  },
  {
    resource: 'insurance-policies',
    dateField: 'nextPremiumDueDate',
    eventType: 'INSURANCE_PREMIUM',
    module: 'insurance',
    label: 'Insurance premium',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} premium due`,
    amountField: 'premiumAmount',
    href: () => '/insurance',
  },
  {
    resource: 'vehicles',
    dateField: 'nextServiceDate',
    eventType: 'VEHICLE_SERVICE',
    module: 'vehicles',
    label: 'Vehicle service',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} service due`,
    href: (r) => `/vehicles/${String(r.id)}`,
  },
  {
    resource: 'vehicles',
    dateField: 'insuranceExpiry',
    eventType: 'VEHICLE_COMPLIANCE',
    module: 'vehicles',
    label: 'Vehicle insurance',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} insurance expires`,
    href: (r) => `/vehicles/${String(r.id)}`,
  },
  {
    resource: 'vehicles',
    dateField: 'pucExpiry',
    eventType: 'VEHICLE_COMPLIANCE',
    module: 'vehicles',
    label: 'PUC',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} PUC expires`,
    href: (r) => `/vehicles/${String(r.id)}`,
  },
  {
    resource: 'vehicles',
    dateField: 'registrationExpiry',
    eventType: 'VEHICLE_COMPLIANCE',
    module: 'vehicles',
    label: 'Vehicle registration',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} registration / fitness expires`,
    href: (r) => `/vehicles/${String(r.id)}`,
  },
  {
    resource: 'vehicles',
    dateField: 'roadTaxValidTill',
    eventType: 'VEHICLE_COMPLIANCE',
    module: 'vehicles',
    label: 'Road tax',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} road tax expires`,
    href: (r) => `/vehicles/${String(r.id)}`,
  },
  {
    resource: 'appliances',
    dateField: 'warrantyEnd',
    eventType: 'WARRANTY_EXPIRY',
    module: 'appliances',
    label: 'Warranty',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} warranty ends`,
    href: (r) => `/appliances/${String(r.id)}`,
  },
  {
    resource: 'appliances',
    dateField: 'amcEnd',
    eventType: 'WARRANTY_EXPIRY',
    module: 'appliances',
    label: 'AMC',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} AMC ends`,
    href: (r) => `/appliances/${String(r.id)}`,
  },
  {
    resource: 'appliances',
    dateField: 'nextServiceDate',
    eventType: 'APPLIANCE_SERVICE',
    module: 'appliances',
    label: 'Appliance service',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} service due`,
    href: (r) => `/appliances/${String(r.id)}`,
  },
  {
    resource: 'warranties',
    dateField: 'endDate',
    eventType: 'WARRANTY_EXPIRY',
    module: 'appliances',
    label: 'Warranty',
    active: always,
    title: (r) => `${name(r, 'itemName')} warranty ends`,
    href: () => '/appliances',
  },
  {
    resource: 'subscriptions',
    dateField: 'nextRenewalDate',
    eventType: 'SUBSCRIPTION_RENEWAL',
    module: 'subscriptions',
    label: 'Subscription renewal',
    active: statusIs('ACTIVE', 'TRIAL'),
    title: (r) => `${name(r)} renews`,
    amountField: 'amount',
    href: () => '/subscriptions',
  },
  {
    resource: 'properties',
    dateField: 'propertyTaxDueDate',
    eventType: 'PROPERTY_TAX',
    module: 'properties',
    label: 'Property tax',
    active: statusIs('ACTIVE'),
    title: (r) => `${name(r)} property tax due`,
    amountField: 'propertyTaxAmount',
    href: (r) => `/properties/${String(r.id)}`,
  },
  {
    resource: 'salaries',
    dateField: 'dueDate',
    eventType: 'STAFF_SALARY',
    module: 'staff',
    label: 'Salary',
    active: statusIs('PENDING', 'PARTIALLY_PAID'),
    title: (r, refs) => `Salary due — ${refs.staffId ?? 'staff'}`,
    amountField: 'netAmount',
    href: (r) => `/staff/${String(r.staffId)}`,
  },
  {
    resource: 'documents',
    dateField: 'expiryDate',
    eventType: 'DOCUMENT_EXPIRY',
    module: 'documents',
    label: 'Document expiry',
    active: always,
    title: (r) => `${name(r, 'title')} expires`,
    href: (r) => `/documents/${String(r.id)}`,
  },
  {
    resource: 'maintenance-tasks',
    dateField: 'dueDate',
    eventType: 'MAINTENANCE_DUE',
    module: 'maintenance',
    label: 'Maintenance',
    active: statusIs('OPEN', 'SCHEDULED', 'IN_PROGRESS'),
    title: (r) => `${name(r, 'title')} due`,
    href: () => '/maintenance',
  },
  {
    resource: 'travel-documents',
    dateField: 'expiryDate',
    eventType: 'TRAVEL_DOCUMENT_EXPIRY',
    module: 'identity',
    label: 'Travel document',
    active: always,
    title: (r, refs) => `${String(r.docType ?? 'Document').toLowerCase()} expires — ${refs.memberId ?? ''}`.trim(),
    href: () => '/travel',
  },
];

export interface DatedEvent {
  key: string;
  resource: string;
  entityId: string;
  eventType: ReminderEventType;
  module: ModuleKey;
  label: string;
  title: string;
  date: string;
  amount?: number;
  href: string;
  /** Present for documents so callers can apply sensitivity rules. */
  sensitivity?: string;
}

export function toDatedEvent(src: DatedSource, r: Record<string, unknown>, refs: Record<string, string> = {}): DatedEvent | null {
  if (!src.active(r)) return null;
  const raw = r[src.dateField];
  const d = raw instanceof Date ? raw : parseDate(raw);
  if (!d) return null;
  const amount = src.amountField && r[src.amountField] != null ? Number(r[src.amountField]) : undefined;
  return {
    key: `${src.resource}:${String(r.id)}:${src.dateField}`,
    resource: src.resource,
    entityId: String(r.id),
    eventType: src.eventType,
    module: src.module,
    label: src.label,
    title: src.title(r, refs),
    date: isoDate(d),
    ...(amount !== undefined && Number.isFinite(amount) ? { amount } : {}),
    href: src.href(r),
    ...(typeof r.sensitivity === 'string' ? { sensitivity: r.sensitivity } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Reminder evaluation                                                 */
/* ------------------------------------------------------------------ */

export interface ReminderRuleLike {
  eventType: string;
  offsetsDays: (string | number)[];
  channels: string[];
  enabled: boolean;
}

export interface DueReminder {
  event: DatedEvent;
  /** The offset threshold that triggered (7 = seven days before; -1 = one day overdue). */
  offset: number;
  daysUntil: number;
  channels: NotificationChannel[];
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  dedupeKey: string;
  title: string;
  body: string;
}

/** How long after the last threshold an event keeps being considered. */
const STALE_AFTER_DAYS = 30;

function describe(daysUntil: number): string {
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil > 1) return `in ${daysUntil} days`;
  if (daysUntil === -1) return '1 day ago';
  return `${-daysUntil} days ago`;
}

/**
 * Decide which reminders are due today.
 *
 * For each event the most recently crossed threshold is selected, so a scan that was missed
 * (server down for a day) still produces the reminder on the next run. The dedupe key makes
 * each threshold fire at most once per event date.
 */
export function dueReminders(events: DatedEvent[], rules: ReminderRuleLike[], today: Date): DueReminder[] {
  const out: DueReminder[] = [];
  for (const event of events) {
    const date = parseDate(event.date);
    if (!date) continue;
    const daysUntil = daysBetween(today, date);
    for (const rule of rules) {
      if (!rule.enabled || rule.eventType !== event.eventType) continue;
      const offsets = [...new Set(rule.offsetsDays.map(Number).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
      if (offsets.length === 0) continue;
      // Smallest threshold that has been reached (daysUntil <= offset).
      const crossed = offsets.find((o) => daysUntil <= o);
      if (crossed === undefined) continue;
      if (daysUntil < offsets[0] - STALE_AFTER_DAYS) continue;
      const overdue = daysUntil < 0;
      const when = describe(daysUntil);
      out.push({
        event,
        offset: crossed,
        daysUntil,
        channels: rule.channels.filter(Boolean) as NotificationChannel[],
        severity: overdue ? 'CRITICAL' : daysUntil <= 3 ? 'WARNING' : 'INFO',
        dedupeKey: `${event.key}:${event.date}:${crossed}`,
        title: overdue ? `Overdue: ${event.title}` : event.title,
        body: overdue ? `${event.label} was due ${when} (${event.date}).` : `${event.label} is due ${when} (${event.date}).`,
      });
    }
  }
  return out;
}

/** Rules created for every new household. */
export const DEFAULT_REMINDER_RULES: { name: string; eventType: ReminderEventType; offsetsDays: string[] }[] = [
  { name: 'Bills', eventType: 'BILL_DUE', offsetsDays: ['7', '3', '0', '-1'] },
  { name: 'Insurance renewals', eventType: 'INSURANCE_RENEWAL', offsetsDays: ['30', '7', '0', '-1'] },
  { name: 'Insurance premiums', eventType: 'INSURANCE_PREMIUM', offsetsDays: ['7', '3', '0', '-1'] },
  { name: 'Vehicle servicing', eventType: 'VEHICLE_SERVICE', offsetsDays: ['7', '0'] },
  { name: 'Vehicle insurance, PUC and tax', eventType: 'VEHICLE_COMPLIANCE', offsetsDays: ['30', '7', '0', '-1'] },
  { name: 'Warranty and AMC expiry', eventType: 'WARRANTY_EXPIRY', offsetsDays: ['30', '7'] },
  { name: 'Appliance servicing', eventType: 'APPLIANCE_SERVICE', offsetsDays: ['7', '0'] },
  { name: 'Subscription renewals', eventType: 'SUBSCRIPTION_RENEWAL', offsetsDays: ['3', '0'] },
  { name: 'Property tax', eventType: 'PROPERTY_TAX', offsetsDays: ['30', '7', '0', '-1'] },
  { name: 'Staff salaries', eventType: 'STAFF_SALARY', offsetsDays: ['3', '0', '-1'] },
  { name: 'Document expiry', eventType: 'DOCUMENT_EXPIRY', offsetsDays: ['60', '30', '7'] },
  { name: 'Maintenance tasks', eventType: 'MAINTENANCE_DUE', offsetsDays: ['3', '0', '-1'] },
  { name: 'Passports and visas', eventType: 'TRAVEL_DOCUMENT_EXPIRY', offsetsDays: ['180', '60', '30'] },
];

export const DEFAULT_DOCUMENT_CATEGORIES: { name: string; defaultSensitivity: string }[] = [
  { name: 'Property deeds', defaultSensitivity: 'FINANCIAL' },
  { name: 'Sale agreements', defaultSensitivity: 'FINANCIAL' },
  { name: 'Registration documents', defaultSensitivity: 'FINANCIAL' },
  { name: 'Occupancy certificates', defaultSensitivity: 'NORMAL' },
  { name: 'Building plans', defaultSensitivity: 'NORMAL' },
  { name: 'Society documents', defaultSensitivity: 'NORMAL' },
  { name: 'Insurance policies', defaultSensitivity: 'FINANCIAL' },
  { name: 'Medical records & hospital invoices', defaultSensitivity: 'MEDICAL' },
  { name: 'Vehicle registration', defaultSensitivity: 'NORMAL' },
  { name: 'Vehicle insurance', defaultSensitivity: 'NORMAL' },
  { name: 'Purchase invoices', defaultSensitivity: 'NORMAL' },
  { name: 'Appliance warranties', defaultSensitivity: 'NORMAL' },
  { name: 'Employment agreements', defaultSensitivity: 'FINANCIAL' },
  { name: 'Tax documents', defaultSensitivity: 'FINANCIAL' },
  { name: 'Financial statements', defaultSensitivity: 'FINANCIAL' },
  { name: 'Personal identification', defaultSensitivity: 'IDENTITY' },
  { name: 'Utility bills', defaultSensitivity: 'NORMAL' },
  { name: 'Other', defaultSensitivity: 'NORMAL' },
];
