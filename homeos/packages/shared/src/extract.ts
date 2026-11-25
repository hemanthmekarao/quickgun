import { categoriseExpense, parseLooseDate } from './finance';
import { UTILITY_TYPES } from './resources';

/**
 * Deterministic invoice / bill field extraction from plain text (PDF text layer, e-mail body,
 * OCR output). No value is invented: a field is only returned when a pattern matched, and the
 * confidence score reflects how many key fields were found.
 */
export interface ExtractedInvoice {
  vendor?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  amount?: number;
  gstAmount?: number;
  gstin?: string;
  consumerNumber?: string;
  category?: string;
  utilityType?: string;
  paymentStatus?: 'PAID' | 'UNPAID';
  suggestedType: 'BILL' | 'EXPENSE' | 'DOCUMENT';
  /** 0–1. Share of key fields (vendor, amount, date, number) that were found. */
  confidence: number;
  /** Names of the fields that were found, for display. */
  found: string[];
}

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[ -][A-Za-z]{3,9}[ ,-]+\d{2,4})`;
const MONEY = String.raw`(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)`;

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

function money(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const UTILITY_HINTS: [string, RegExp][] = [
  ['ELECTRICITY', /\b(electricity|kwh|units consumed|power supply|bescom|msedcl|discom|tata power|bses)\b/i],
  ['WATER', /\b(water (bill|supply|charges|board)|bwssb|jal board)\b/i],
  ['LPG', /\b(lpg|indane|hp gas|bharat ?gas|cylinder)\b/i],
  ['GAS', /\b(piped (natural )?gas|png|scm)\b/i],
  ['BROADBAND', /\b(broadband|fib(er|re)net|fibre|wi-?fi plan)\b/i],
  ['DTH', /\b(dth|tata play|dish ?tv|set-?top)\b/i],
  ['MOBILE', /\b(postpaid|prepaid|mobile (bill|number))\b/i],
  ['TELEPHONE', /\b(landline|telephone)\b/i],
  ['PROPERTY_TAX', /\bproperty tax\b/i],
  ['SOCIETY_MAINTENANCE', /\b(society|association) (maintenance|charges)\b/i],
  ['MUNICIPAL', /\b(municipal|corporation) (tax|charges|bill)\b/i],
];

export function extractInvoiceFields(rawText: string): ExtractedInvoice {
  const text = (rawText ?? '').replace(/\r/g, '');
  const found: string[] = [];
  const out: ExtractedInvoice = { suggestedType: 'DOCUMENT', confidence: 0, found };
  if (!text.trim()) return out;

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const vendorLine = lines.find(
    (l) => l.length >= 3 && l.length <= 80 && /[A-Za-z]{3}/.test(l) && !/^(tax )?invoice\b|^bill\b|^receipt\b|^page \d|^date\b|^gstin\b/i.test(l),
  );
  if (vendorLine) {
    out.vendor = vendorLine.replace(/\s{2,}/g, ' ');
    found.push('vendor');
  }

  const invoiceNumber = firstMatch(text, [
    /(?:invoice|bill|receipt|order)\s*(?:no\.?|number|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,30})/i,
    /\b(?:inv|ref)\s*(?:no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,30})/i,
  ]);
  if (invoiceNumber) {
    out.invoiceNumber = invoiceNumber;
    found.push('invoiceNumber');
  }

  const dueRaw = firstMatch(text, [
    new RegExp(String.raw`(?:due date|pay(?:ment)? by|payment due(?: date)?|last date(?: of payment)?)\s*[:-]?\s*${DATE}`, 'i'),
  ]);
  const due = dueRaw ? parseLooseDate(dueRaw) : null;
  if (due) {
    out.dueDate = due;
    found.push('dueDate');
  }

  const dateRaw = firstMatch(text, [
    new RegExp(String.raw`(?:invoice date|bill date|date of issue|dated|order date|date)\s*[:-]?\s*${DATE}`, 'i'),
  ]);
  const invDate = dateRaw ? parseLooseDate(dateRaw) : null;
  if (invDate) {
    out.invoiceDate = invDate;
    found.push('invoiceDate');
  }

  const amount = money(
    firstMatch(text, [
      new RegExp(String.raw`(?:amount payable|total amount due|net payable|amount due|grand total|total payable|net amount|invoice total|total amount|bill amount)\s*(?:\(.*?\))?\s*[:-]?\s*${MONEY}`, 'i'),
      new RegExp(String.raw`\btotal\b\s*[:-]?\s*${MONEY}`, 'i'),
    ]),
  );
  if (amount !== undefined) {
    out.amount = amount;
    found.push('amount');
  }

  const gstParts = [...text.matchAll(new RegExp(String.raw`\b(?:cgst|sgst|igst|utgst)\b[^\n0-9₹]*(?:\d{1,2}(?:\.\d+)?\s*%)?[^\n0-9₹]*${MONEY}`, 'gi'))]
    .map((m) => money(m[1]))
    .filter((n): n is number => n !== undefined);
  const gstTotal = money(firstMatch(text, [new RegExp(String.raw`\b(?:total gst|gst amount|total tax|tax amount)\s*[:-]?\s*${MONEY}`, 'i')]));
  const gst = gstTotal ?? (gstParts.length ? Math.round(gstParts.reduce((s, n) => s + n, 0) * 100) / 100 : undefined);
  if (gst !== undefined && (out.amount === undefined || gst < out.amount)) {
    out.gstAmount = gst;
    found.push('gstAmount');
  }

  const gstin = firstMatch(text, [/\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/]);
  if (gstin) {
    out.gstin = gstin;
    found.push('gstin');
  }

  const consumer = firstMatch(text, [
    /(?:consumer|customer|account|ca|service|connection|rr)\s*(?:no\.?|number|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{4,24})/i,
  ]);
  if (consumer) {
    out.consumerNumber = consumer;
    found.push('consumerNumber');
  }

  for (const [type, re] of UTILITY_HINTS) {
    if (re.test(text) && (UTILITY_TYPES as readonly string[]).includes(type)) {
      out.utilityType = type;
      found.push('utilityType');
      break;
    }
  }

  if (/\b(payment received|paid in full|amount paid|payment successful|thank you for your payment)\b/i.test(text)) {
    out.paymentStatus = 'PAID';
  } else if (out.dueDate) {
    out.paymentStatus = 'UNPAID';
  }

  const cat = categoriseExpense(text.slice(0, 2000), out.vendor);
  if (cat !== 'OTHER') out.category = cat;
  else if (out.utilityType) out.category = 'UTILITIES';

  if (out.amount !== undefined) {
    out.suggestedType = out.utilityType || (out.dueDate && out.paymentStatus !== 'PAID') ? 'BILL' : 'EXPENSE';
  }

  const keyFields = [out.vendor, out.amount, out.invoiceDate ?? out.dueDate, out.invoiceNumber];
  out.confidence = keyFields.filter((x) => x !== undefined).length / keyFields.length;
  return out;
}

/** Below this confidence the item is always sent for manual review. */
export const AUTO_REVIEW_THRESHOLD = 0.75;

const DOC_CATEGORY_HINTS: [string, RegExp][] = [
  ['Property deeds', /\b(sale deed|conveyance deed|title deed|gift deed)\b/i],
  ['Sale agreements', /\b(agreement (to|for) sale|sale agreement)\b/i],
  ['Registration documents', /\b(sub-?registrar|registration (certificate|receipt)|encumbrance)\b/i],
  ['Occupancy certificates', /\boccupancy certificate\b/i],
  ['Building plans', /\b(building plan|sanctioned plan|floor plan)\b/i],
  ['Insurance policies', /\b(policy (schedule|number|no)|sum insured|insurer)\b/i],
  ['Medical records & hospital invoices', /\b(hospital|discharge summary|prescription|diagnos|patient|lab report)\b/i],
  ['Vehicle registration', /\b(registration certificate|rc book|chassis)\b/i],
  ['Appliance warranties', /\bwarranty (card|certificate|period)\b/i],
  ['Employment agreements', /\b(employment agreement|appointment letter|offer letter)\b/i],
  ['Tax documents', /\b(form 16|income tax|itr|tds certificate|property tax)\b/i],
  ['Financial statements', /\b(account statement|statement of account|bank statement)\b/i],
  ['Personal identification', /\b(aadhaar|passport|pan card|permanent account number|driving licen[cs]e|voter id)\b/i],
  ['Utility bills', /\b(electricity|water|gas|broadband|dth) bill\b/i],
  ['Purchase invoices', /\b(tax invoice|invoice|receipt)\b/i],
];

/** Suggest a vault category name from file name and text. Returns undefined when nothing matches. */
export function classifyDocument(fileName: string, text: string): string | undefined {
  const hay = `${fileName}\n${(text ?? '').slice(0, 4000)}`;
  for (const [cat, re] of DOC_CATEGORY_HINTS) if (re.test(hay)) return cat;
  return undefined;
}
