// Repository = the ONLY thing UI/domain code talks to for data.
// It keeps an in-memory cache (fast, synchronous reads → simple UI) and
// writes through to a pluggable adapter (localStorage today, HTTP/SQLite later).
//
// Adapter contract (all async):
//   loadAll(): Promise<{[collection]: Record[]}>
//   upsert(collection, record): Promise<void>
//   remove(collection, id): Promise<void>
//   clear(): Promise<void>
import { uid } from '../core/util.js';

export class Repository {
  constructor(adapter) {
    this.adapter = adapter;
    this.cache = {};
    this.listeners = new Set();
    this._pending = false;
  }
  async init() {
    this.cache = (await this.adapter.loadAll()) || {};
  }
  all(col) {
    return this.cache[col] || (this.cache[col] = []);
  }
  get(col, id) {
    return this.all(col).find((r) => r.id === id);
  }
  async create(col, data) {
    const now = new Date().toISOString();
    const rec = { ...data, id: uid(), createdAt: now, updatedAt: now };
    this.all(col).push(rec);
    await this.adapter.upsert(col, rec);
    this._emit();
    return rec;
  }
  async update(col, id, patch) {
    const rec = this.get(col, id);
    if (!rec) throw new Error(`${col}/${id} not found`);
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    await this.adapter.upsert(col, rec);
    this._emit();
    return rec;
  }
  async remove(col, id) {
    const arr = this.all(col);
    const i = arr.findIndex((r) => r.id === id);
    if (i >= 0) arr.splice(i, 1);
    await this.adapter.remove(col, id);
    this._emit();
  }
  dump() {
    return JSON.parse(JSON.stringify(this.cache));
  }
  async replaceAll(data) {
    await this.adapter.clear();
    this.cache = {};
    for (const [col, rows] of Object.entries(data || {})) {
      for (const rec of rows) {
        this.all(col).push(rec);
        await this.adapter.upsert(col, rec);
      }
    }
    this._emit();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  // coalesce bursts of writes (seeding, imports) into a single UI refresh
  _emit() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      this.listeners.forEach((f) => f());
    });
  }
}
