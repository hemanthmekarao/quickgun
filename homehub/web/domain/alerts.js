// Turns every module's `dates` declaration into one sorted "what needs attention" list.
// Used by the dashboard AND by notifications, so both always agree.
import { MODULES } from './modules.js';
import { daysUntil } from '../core/util.js';

export function upcoming(repo, { maxDays } = {}) {
  const items = [];
  for (const mod of MODULES) {
    for (const d of mod.dates || []) {
      for (const rec of repo.all(mod.collection)) {
        if (d.when && !d.when(rec, repo)) continue;
        const date = d.field ? rec[d.field] : d.compute(rec, repo);
        if (!date) continue;
        const days = daysUntil(date);
        if (days > (maxDays ?? d.lead ?? 30)) continue;
        items.push({ mod, rec, label: d.label, date, days, title: mod.title(rec, repo), amount: mod.amount?.(rec, repo) });
      }
    }
  }
  return items.sort((a, b) => a.days - b.days);
}
