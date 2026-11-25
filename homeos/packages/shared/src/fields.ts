import type { ModuleKey } from './roles';

export type FieldType =
  | 'string'
  | 'text'
  | 'int'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum'
  | 'ref'
  | 'tags'
  | 'json';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values for `enum` (and for each entry of `tags` when present). */
  options?: readonly string[];
  /** Target resource key for `ref`. */
  ref?: string;
  /** Applied on create when the client omits the field. */
  default?: unknown;
  min?: number;
  max?: number;
  /** Show as a column in list tables. */
  table?: boolean;
  /** Group heading in forms / detail pages. */
  group?: string;
  help?: string;
  /** Written only by the server; rejected in client input and hidden from forms. */
  system?: boolean;
  /** Never returned by the API (e.g. storage keys, raw provider payloads). */
  hidden?: boolean;
  /** Returned on single-record reads only (large values). */
  detailOnly?: boolean;
}

export interface ResourceDef {
  /** URL segment: /v1/<key>. */
  key: string;
  /** Prisma model name (PascalCase). */
  model: string;
  module: ModuleKey;
  singular: string;
  plural: string;
  /** Field used as the human label of a record. */
  titleField: string;
  fields: FieldDef[];
  /** String fields searched by ?q=. */
  search: string[];
  /** Field used for ?from= / ?to= range filters and default ordering. */
  dateField?: string;
  /** No POST route (records are created by a dedicated workflow). */
  noCreate?: boolean;
  /** No POST/PATCH/DELETE routes. */
  readOnly?: boolean;
  description?: string;
}

/* ---------- tiny builders to keep the registry readable ---------- */

type Opts = Partial<Omit<FieldDef, 'key' | 'label' | 'type'>>;

export const f = {
  str: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'string', ...o }),
  text: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'text', ...o }),
  int: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'int', ...o }),
  num: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'number', ...o }),
  money: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'money', min: 0, ...o }),
  date: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'date', ...o }),
  datetime: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'datetime', ...o }),
  bool: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'boolean', ...o }),
  enum: (key: string, label: string, options: readonly string[], o: Opts = {}): FieldDef => ({
    key,
    label,
    type: 'enum',
    options,
    ...o,
  }),
  ref: (key: string, label: string, ref: string, o: Opts = {}): FieldDef => ({ key, label, type: 'ref', ref, ...o }),
  tags: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'tags', ...o }),
  json: (key: string, label: string, o: Opts = {}): FieldDef => ({ key, label, type: 'json', ...o }),
};

/** Mark a list of fields as belonging to a form group. */
export function group(name: string, fields: FieldDef[]): FieldDef[] {
  return fields.map((x) => ({ ...x, group: x.group ?? name }));
}

/** Mark fields as server-managed. */
export function system(fields: FieldDef[]): FieldDef[] {
  return fields.map((x) => ({ ...x, system: true }));
}

export function humanize(value: string): string {
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
