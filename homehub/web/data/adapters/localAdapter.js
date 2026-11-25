// Offline-first adapter: one localStorage key per collection.
// Home-scale data (thousands of rows) fits comfortably; binary files live in IndexedDB (see fileStore.js).
const PREFIX = 'homehub:v1:';

export const localAdapter = {
  name: 'local',
  async loadAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        try {
          out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)) || [];
        } catch {
          out[k.slice(PREFIX.length)] = [];
        }
      }
    }
    return out;
  },
  async upsert(col, rec) {
    const rows = JSON.parse(localStorage.getItem(PREFIX + col) || '[]');
    const i = rows.findIndex((r) => r.id === rec.id);
    if (i >= 0) rows[i] = rec;
    else rows.push(rec);
    localStorage.setItem(PREFIX + col, JSON.stringify(rows));
  },
  async remove(col, id) {
    const rows = JSON.parse(localStorage.getItem(PREFIX + col) || '[]').filter((r) => r.id !== id);
    localStorage.setItem(PREFIX + col, JSON.stringify(rows));
  },
  async clear() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  },
};
