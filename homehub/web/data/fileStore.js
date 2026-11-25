// Binary attachments (bill copies, invoices, deeds, RC books…) stored in IndexedDB.
// Records only keep a small reference: { id, name, type, size }.
// A cloud version would implement the same put/get/delete against object storage (S3, Drive…).
import { uid } from '../core/util.js';

const DB = 'homehub-files';
const STORE = 'blobs';

const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
};

export const fileStore = {
  /** Save a File/Blob, return the reference to keep on the record. */
  async put(file) {
    const id = uid();
    await run('readwrite', (s) => s.put(file, id));
    return { id, name: file.name || 'file', type: file.type, size: file.size };
  },
  /** Restore a blob under a known id (used by backup import). */
  putAt: (id, blob) => run('readwrite', (s) => s.put(blob, id)),
  get: (id) => run('readonly', (s) => s.get(id)),
  delete: (id) => run('readwrite', (s) => s.delete(id)),
  async ids() {
    return (await run('readonly', (s) => s.getAllKeys())) || [];
  },
  async clear() {
    return run('readwrite', (s) => s.clear());
  },
  async open(ref) {
    const blob = await this.get(ref.id);
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  },
};
