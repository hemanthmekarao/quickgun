// User settings (per device). Kept out of the record repository on purpose:
// they describe this installation (currency, reminders), not household data.
const KEY = 'homehub:settings';
const DEFAULTS = {
  name: '',
  currency: 'INR',
  locale: 'en-IN',
  monthlyBudget: 0,
  reminders: false,
  apiBase: '', // set when you add a backend (see docs/ARCHITECTURE.md)
};
let state = { ...DEFAULTS };
try {
  state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {
  /* private mode etc. — fall back to defaults */
}
const listeners = new Set();

export const settings = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    listeners.forEach((f) => f(state));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
