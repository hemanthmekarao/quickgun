import type { FieldDef, ResourceDef } from './fields';

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Normalised values, ready to persist (dates are Date objects, numbers are numbers). */
  data: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Parse 'YYYY-MM-DD' (as UTC midnight) or a full ISO timestamp. Returns null when invalid. */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const s = value.trim();
  if (DATE_ONLY_RE.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    // Reject impossible dates such as 2025-02-31, which Date.UTC silently rolls over.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerce(field: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  switch (field.type) {
    case 'string':
    case 'text': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'must be text' };
      const s = String(raw).trim();
      const max = field.type === 'string' ? 500 : 20000;
      if (s.length > max) return { error: `must be at most ${max} characters` };
      return { value: s };
    }
    case 'int':
    case 'number':
    case 'money': {
      const n = toNumber(raw);
      if (n === null) return { error: 'must be a number' };
      if (field.type === 'int' && !Number.isInteger(n)) return { error: 'must be a whole number' };
      if (field.min !== undefined && n < field.min) return { error: `must be at least ${field.min}` };
      if (field.max !== undefined && n > field.max) return { error: `must be at most ${field.max}` };
      if (field.type === 'money') {
        if (Math.abs(n) >= 1e12) return { error: 'is too large' };
        return { value: Math.round(n * 100) / 100 };
      }
      return { value: n };
    }
    case 'date':
    case 'datetime': {
      const d = parseDate(raw);
      if (!d) return { error: 'must be a valid date (YYYY-MM-DD)' };
      return { value: d };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'must be true or false' };
    }
    case 'enum': {
      if (typeof raw !== 'string' || !(field.options ?? []).includes(raw)) {
        return { error: `must be one of: ${(field.options ?? []).join(', ')}` };
      }
      return { value: raw };
    }
    case 'ref': {
      if (!isUuid(raw)) return { error: 'must be a valid record id' };
      return { value: raw.toLowerCase() };
    }
    case 'tags': {
      if (!Array.isArray(raw)) return { error: 'must be a list' };
      if (raw.length > 100) return { error: 'has too many entries' };
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string' && typeof item !== 'number') return { error: 'must be a list of text values' };
        const s = String(item).trim();
        if (!s) continue;
        if (s.length > 100) return { error: 'entries must be at most 100 characters' };
        if (field.options && !field.options.includes(s)) {
          return { error: `entries must be one of: ${field.options.join(', ')}` };
        }
        if (!out.includes(s)) out.push(s);
      }
      return { value: out };
    }
    case 'json': {
      if (raw === null || typeof raw !== 'object') return { error: 'must be an object' };
      return { value: raw };
    }
    default:
      return { error: 'has an unsupported type' };
  }
}

function isEmpty(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

/**
 * Validate client input for a resource.
 * - Unknown and server-managed fields are rejected (never silently dropped).
 * - In `partial` mode (PATCH) only supplied fields are checked; `null` / '' clears an optional field.
 */
export function validateRecord(
  def: ResourceDef,
  input: unknown,
  opts: { partial?: boolean } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const data: Record<string, unknown> = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ field: '_', message: 'Request body must be a JSON object' }], data };
  }
  const body = input as Record<string, unknown>;
  const writable = new Map(def.fields.filter((x) => !x.system).map((x) => [x.key, x]));

  for (const key of Object.keys(body)) {
    if (!writable.has(key)) issues.push({ field: key, message: 'is not a writable field' });
  }

  for (const field of writable.values()) {
    const supplied = Object.prototype.hasOwnProperty.call(body, field.key);
    const raw = body[field.key];
    if (!supplied || isEmpty(raw)) {
      if (opts.partial) {
        if (supplied) {
          if (field.required) issues.push({ field: field.key, message: 'is required' });
          else data[field.key] = field.default !== undefined ? field.default : field.type === 'tags' ? [] : null;
        }
        continue;
      }
      if (field.default !== undefined) data[field.key] = field.default;
      else if (field.required) issues.push({ field: field.key, message: 'is required' });
      else if (field.type === 'tags') data[field.key] = [];
      continue;
    }
    const res = coerce(field, raw);
    if (res.error) issues.push({ field: field.key, message: res.error });
    else if (field.required && field.type === 'tags' && (res.value as unknown[]).length === 0) {
      issues.push({ field: field.key, message: 'is required' });
    } else data[field.key] = res.value;
  }

  // Cross-field rule shared by every resource that has it.
  if (def.key === 'reminder-rules' && Array.isArray(data.offsetsDays)) {
    for (const o of data.offsetsDays as string[]) {
      if (!/^-?\d{1,3}$/.test(o)) issues.push({ field: 'offsetsDays', message: 'entries must be whole numbers of days' });
    }
  }
  if (def.key === 'salaries' && typeof data.month === 'string' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)) {
    issues.push({ field: 'month', message: 'must be in YYYY-MM format' });
  }

  return { ok: issues.length === 0, issues, data };
}

/** Defaults for server-managed fields, applied when the server creates a record. */
export function systemDefaults(def: ResourceDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.system && field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}
