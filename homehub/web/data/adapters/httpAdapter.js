// Cloud-sync adapter STUB — same contract as localAdapter, for when you add a backend.
// NOT wired up or tested: it documents the REST shape the backend should expose
// (see docs/ARCHITECTURE.md). Swap it in inside data/index.js.
//
//   GET    {base}/sync                 -> { [collection]: Record[] }
//   PUT    {base}/{collection}/{id}    body: Record
//   DELETE {base}/{collection}/{id}
//   DELETE {base}/sync                 (wipe — used by import/reset)
export function httpAdapter(base, getToken = () => null) {
  const call = async (method, path, body) => {
    const token = getToken();
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    name: 'http',
    loadAll: () => call('GET', '/sync'),
    upsert: (col, rec) => call('PUT', `/${col}/${rec.id}`, rec),
    remove: (col, id) => call('DELETE', `/${col}/${id}`),
    clear: () => call('DELETE', '/sync'),
  };
}
