import type { ModuleKey } from './roles';

/**
 * Read-only tools available to the AI assistant. The same catalogue is used by the
 * rule-based engine and, when an LLM is configured, as its function-calling tools.
 * There are deliberately no tools that pay, delete, share or modify anything.
 */
export interface AssistantTool {
  name: string;
  description: string;
  module: ModuleKey;
  parameters: Record<string, { type: 'string' | 'number'; description: string; enum?: string[] }>;
}

export const SPEND_PERIODS = ['THIS_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'LAST_YEAR', 'LAST_12_MONTHS'] as const;
export type SpendPeriod = (typeof SPEND_PERIODS)[number];

export const ASSISTANT_TOOLS: AssistantTool[] = [
  {
    name: 'spending_summary',
    description: 'Total household spending and the breakdown by category for a period.',
    module: 'finance',
    parameters: { period: { type: 'string', description: 'Reporting period', enum: [...SPEND_PERIODS] } },
  },
  {
    name: 'bills_due',
    description: 'Unpaid bills due within the next N days, plus overdue bills.',
    module: 'bills',
    parameters: { days: { type: 'number', description: 'Look-ahead window in days (default 7)' } },
  },
  {
    name: 'search_documents',
    description: 'Search the document vault by title, tags and extracted text.',
    module: 'documents',
    parameters: { query: { type: 'string', description: 'Search words' } },
  },
  {
    name: 'vehicle_service_status',
    description: 'Next service date and compliance expiry dates for each vehicle.',
    module: 'vehicles',
    parameters: {},
  },
  {
    name: 'appliances_under_warranty',
    description: 'Appliances whose manufacturer or extended warranty is still valid.',
    module: 'appliances',
    parameters: {},
  },
  {
    name: 'insurance_expiring',
    description: 'Insurance policies expiring within the next N days.',
    module: 'insurance',
    parameters: { days: { type: 'number', description: 'Look-ahead window in days (default 90)' } },
  },
  {
    name: 'staff_salary_summary',
    description: 'Monthly salary commitment and salaries paid this year for household staff.',
    module: 'staff',
    parameters: {},
  },
  {
    name: 'subscriptions_summary',
    description: 'Active recurring subscriptions with monthly and annual cost, and possibly unused ones.',
    module: 'subscriptions',
    parameters: {},
  },
  {
    name: 'maintenance_cost',
    description: 'Total home maintenance cost for a period and open maintenance tasks.',
    module: 'maintenance',
    parameters: { period: { type: 'string', description: 'Reporting period', enum: [...SPEND_PERIODS] } },
  },
  {
    name: 'budget_status',
    description: 'Budgets with amount used in the current period.',
    module: 'finance',
    parameters: {},
  },
];

export interface ParsedIntent {
  tool: string;
  args: Record<string, string | number>;
}

function period(text: string, fallback: SpendPeriod): SpendPeriod {
  if (/last month|previous month/.test(text)) return 'LAST_MONTH';
  if (/this month|current month|month so far/.test(text)) return 'THIS_MONTH';
  if (/last year|previous year/.test(text)) return 'LAST_YEAR';
  if (/last (12|twelve) months|past year/.test(text)) return 'LAST_12_MONTHS';
  if (/this year|annual|yearly|per year|year to date|ytd/.test(text)) return 'THIS_YEAR';
  return fallback;
}

function days(text: string, fallback: number): number {
  const m = /(\d{1,3})\s*days?/.exec(text);
  if (m) return Number(m[1]);
  if (/today/.test(text)) return 0;
  if (/this week|next week|week/.test(text)) return 7;
  if (/fortnight/.test(text)) return 14;
  if (/this month|next month|month/.test(text)) return 30;
  if (/quarter/.test(text)) return 90;
  if (/year/.test(text)) return 365;
  return fallback;
}

/**
 * Map a natural-language question to one tool call. Returns null when the question is not
 * understood — the caller must say so instead of guessing.
 */
export function parseIntent(question: string): ParsedIntent | null {
  const t = question.toLowerCase().replace(/[?!.]+$/g, '').trim();
  if (!t) return null;

  if (/\b(find|search|show|where|locate|get)\b.*\b(document|deed|agreement|certificate|policy document|invoice|receipt|paper|file|scan)\b/.test(t)) {
    const query = t
      .replace(/\b(find|search|show|where is|where are|where|locate|get|me|my|the|a|an|for|please|document|documents|file|files|copy of|of)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { tool: 'search_documents', args: { query: query || t } };
  }
  if (/\b(staff|maid|cook|driver|gardener|housekeeper|domestic)\b/.test(t) && /\b(salar|wage|pay|spend|cost)\w*/.test(t)) {
    return { tool: 'staff_salary_summary', args: {} };
  }
  if (/\bsubscription|ott\b|membership|recurring (payment|charge)s?/.test(t)) return { tool: 'subscriptions_summary', args: {} };
  if (/\b(insurance|polic(y|ies))\b/.test(t) && /\b(expir|renew|due|laps)\w*/.test(t)) {
    return { tool: 'insurance_expiring', args: { days: days(t, 90) } };
  }
  if (/\bwarrant(y|ies)\b/.test(t)) return { tool: 'appliances_under_warranty', args: {} };
  if (/\b(car|bike|vehicle|scooter|motorcycle)s?\b/.test(t) && /\b(servic|puc|insurance|due|maintenance)\w*/.test(t)) {
    return { tool: 'vehicle_service_status', args: {} };
  }
  if (/\b(maintenance|repair)s?\b/.test(t) && /\b(cost|spend|spent|total|expens)\w*/.test(t)) {
    return { tool: 'maintenance_cost', args: { period: period(t, 'THIS_YEAR') } };
  }
  if (/\bbills?\b/.test(t) && /\b(due|upcoming|pending|overdue|unpaid|pay)\b/.test(t)) {
    return { tool: 'bills_due', args: { days: days(t, 7) } };
  }
  if (/\bbudgets?\b/.test(t)) return { tool: 'budget_status', args: {} };
  if (/\b(spend|spent|spending|expenditure|expenses?|cost)\b/.test(t)) {
    return { tool: 'spending_summary', args: { period: period(t, 'THIS_MONTH') } };
  }
  return null;
}

export const ASSISTANT_EXAMPLES = [
  'What did I spend last month?',
  'What bills are due this week?',
  'Find my property registration document',
  'When is my car due for servicing?',
  'Which appliances are under warranty?',
  'What is my annual household expenditure?',
  'Show all insurance policies expiring in the next 90 days',
  'How much do I spend on staff salaries?',
  'Which subscriptions are recurring?',
  'What is the total maintenance cost of my home?',
];

/* ------------------------------------------------------------------ */
/* Monthly household summary (deterministic text from real figures)    */
/* ------------------------------------------------------------------ */

export interface MonthlySummaryInput {
  monthLabel: string;
  currency: string;
  totalThisMonth: number;
  totalLastMonth: number;
  topCategories: { category: string; amount: number }[];
  overdueBills: number;
  upcomingBills: number;
  upcomingBillsAmount: number;
  renewalsNext30Days: number;
  openMaintenanceTasks: number;
  anomalies: { category: string; ratio: number }[];
  unusedSubscriptions: string[];
}

export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

function label(v: string): string {
  return v.replace(/_/g, ' ').toLowerCase();
}

export function buildMonthlySummary(s: MonthlySummaryInput): { headline: string; points: string[] } {
  const points: string[] = [];
  const fmt = (n: number) => formatMoney(n, s.currency);
  let headline = `You have spent ${fmt(s.totalThisMonth)} in ${s.monthLabel}.`;
  if (s.totalLastMonth > 0) {
    const change = ((s.totalThisMonth - s.totalLastMonth) / s.totalLastMonth) * 100;
    headline +=
      Math.abs(change) < 1
        ? ' That is about the same as last month.'
        : ` That is ${Math.abs(change).toFixed(0)}% ${change > 0 ? 'more' : 'less'} than last month's total of ${fmt(s.totalLastMonth)}.`;
  }
  if (s.topCategories.length) {
    points.push(`Largest categories: ${s.topCategories.slice(0, 3).map((c) => `${label(c.category)} (${fmt(c.amount)})`).join(', ')}.`);
  }
  if (s.overdueBills > 0) points.push(`${s.overdueBills} bill${s.overdueBills === 1 ? ' is' : 's are'} overdue.`);
  if (s.upcomingBills > 0) {
    points.push(`${s.upcomingBills} bill${s.upcomingBills === 1 ? '' : 's'} totalling ${fmt(s.upcomingBillsAmount)} fall due in the next 30 days.`);
  }
  if (s.renewalsNext30Days > 0) {
    points.push(`${s.renewalsNext30Days} renewal${s.renewalsNext30Days === 1 ? '' : 's'} or expiry date${s.renewalsNext30Days === 1 ? '' : 's'} coming up in the next 30 days.`);
  }
  if (s.openMaintenanceTasks > 0) points.push(`${s.openMaintenanceTasks} maintenance task${s.openMaintenanceTasks === 1 ? ' is' : 's are'} open.`);
  for (const a of s.anomalies.slice(0, 2)) {
    points.push(`Spending on ${label(a.category)} is ${a.ratio.toFixed(1)}× its recent monthly average.`);
  }
  if (s.unusedSubscriptions.length) {
    points.push(`Possibly unused subscriptions: ${s.unusedSubscriptions.slice(0, 3).join(', ')}.`);
  }
  if (!points.length && s.totalThisMonth === 0) points.push('No expenses have been recorded this month yet.');
  return { headline, points };
}
