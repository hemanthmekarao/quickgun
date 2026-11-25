/**
 * Roles, permission modules and the default role → permission matrix.
 * The matrix is seeded into the Role/Permission tables when a household is created and can
 * then be customised per household. `can()` is the single evaluation function used by the API
 * guards, the AI assistant tools and the web navigation.
 */

export const ROLE_KEYS = [
  'OWNER',
  'SPOUSE',
  'FAMILY_MEMBER',
  'ACCOUNTANT',
  'PROPERTY_MANAGER',
  'HOME_MANAGER',
  'DRIVER',
  'DOMESTIC_STAFF',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: 'Primary owner',
  SPOUSE: 'Spouse',
  FAMILY_MEMBER: 'Family member',
  ACCOUNTANT: 'Accountant',
  PROPERTY_MANAGER: 'Property manager',
  HOME_MANAGER: 'Home manager',
  DRIVER: 'Driver',
  DOMESTIC_STAFF: 'Domestic staff',
};

export const MODULE_KEYS = [
  'household',
  'finance',
  'bills',
  'payments',
  'subscriptions',
  'properties',
  'documents',
  'identity',
  'vehicles',
  'appliances',
  'maintenance',
  'staff',
  'insurance',
  'healthcare',
  'shopping',
  'assets',
  'travel',
  'smarthome',
  'notifications',
  'assistant',
  'reports',
  'settings',
  'audit',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  household: 'Household & members',
  finance: 'Finance & expenses',
  bills: 'Bills & utilities',
  payments: 'Payments',
  subscriptions: 'Subscriptions',
  properties: 'Properties',
  documents: 'Document vault',
  identity: 'Identity documents',
  vehicles: 'Vehicles',
  appliances: 'Appliances',
  maintenance: 'Maintenance & vendors',
  staff: 'Household staff',
  insurance: 'Insurance',
  healthcare: 'Healthcare records',
  shopping: 'Shopping',
  assets: 'Personal assets',
  travel: 'Travel',
  smarthome: 'Smart home',
  notifications: 'Notifications & reminders',
  assistant: 'AI assistant',
  reports: 'Reports',
  settings: 'Settings',
  audit: 'Audit log',
};

export const ACTIONS = ['read', 'write', 'delete', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ModulePermission {
  read: boolean;
  write: boolean;
  delete: boolean;
  approve: boolean;
}
export type PermissionMap = Partial<Record<ModuleKey, ModulePermission>>;

const NONE: ModulePermission = { read: false, write: false, delete: false, approve: false };

/** Compact notation: any of the letters r, w, d, a. */
function p(spec: string): ModulePermission {
  return {
    read: spec.includes('r'),
    write: spec.includes('w'),
    delete: spec.includes('d'),
    approve: spec.includes('a'),
  };
}

function build(spec: Partial<Record<ModuleKey, string>>, fallback = ''): PermissionMap {
  const out: PermissionMap = {};
  for (const m of MODULE_KEYS) out[m] = p(spec[m] ?? fallback);
  return out;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionMap> = {
  OWNER: build({}, 'rwda'),
  SPOUSE: build({ household: 'rw', settings: 'rw', audit: 'r' }, 'rwda'),
  FAMILY_MEMBER: build({
    household: 'r',
    finance: 'rw',
    bills: 'r',
    subscriptions: 'rw',
    properties: 'r',
    documents: 'rw',
    vehicles: 'r',
    appliances: 'r',
    maintenance: 'rw',
    shopping: 'rw',
    travel: 'rw',
    smarthome: 'r',
    notifications: 'rw',
    assistant: 'r',
  }),
  ACCOUNTANT: build({
    household: 'r',
    finance: 'rwa',
    bills: 'rw',
    payments: 'rw',
    subscriptions: 'r',
    properties: 'r',
    documents: 'rw',
    staff: 'r',
    insurance: 'r',
    notifications: 'rw',
    assistant: 'r',
    reports: 'r',
    audit: 'r',
  }),
  PROPERTY_MANAGER: build({
    household: 'r',
    bills: 'rw',
    properties: 'rw',
    documents: 'rw',
    appliances: 'rw',
    maintenance: 'rwd',
    smarthome: 'r',
    notifications: 'rw',
    assistant: 'r',
  }),
  HOME_MANAGER: build({
    household: 'r',
    bills: 'r',
    subscriptions: 'r',
    documents: 'r',
    vehicles: 'rw',
    appliances: 'rw',
    maintenance: 'rwd',
    staff: 'rw',
    shopping: 'rw',
    smarthome: 'rw',
    notifications: 'rw',
    assistant: 'r',
  }),
  DRIVER: build({ vehicles: 'rw', notifications: 'rw' }),
  DOMESTIC_STAFF: build({ maintenance: 'r', shopping: 'rw', notifications: 'rw' }),
};

export function can(perms: PermissionMap | undefined | null, module: ModuleKey, action: Action): boolean {
  if (!perms) return false;
  return Boolean((perms[module] ?? NONE)[action]);
}

/** Document sensitivity → extra module a member must be able to read to see the document. */
export const SENSITIVITIES = ['NORMAL', 'FINANCIAL', 'MEDICAL', 'IDENTITY'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export const SENSITIVITY_MODULE: Record<Sensitivity, ModuleKey | null> = {
  NORMAL: null,
  FINANCIAL: 'finance',
  MEDICAL: 'healthcare',
  IDENTITY: 'identity',
};

/** Sensitivities a member with the given permissions may see. */
export function visibleSensitivities(perms: PermissionMap): Sensitivity[] {
  return SENSITIVITIES.filter((s) => {
    const m = SENSITIVITY_MODULE[s];
    return m === null || can(perms, m, 'read');
  });
}
