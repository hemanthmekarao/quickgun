# HomeHub architecture — web today, app tomorrow

## Principles

1. **Declarative domain.** Each category (bills, vehicles, appliances…) is one object in `web/domain/modules.js`:
   fields, status rules, reminder dates, quick actions. Forms, lists, reminders and the dashboard are
   *generated* from it. Adding "Pets" or "Loans" = adding one object.
2. **Layers only point downward.** `pages/ui → domain → data`, and everything device-specific is behind `platform/`.
3. **Offline-first.** The repository keeps a synchronous in-memory cache and writes through to an adapter.
   The UI never waits on the network.
4. **No build step.** Native ES modules; the same `web/` folder is served in a browser *and* packaged by Capacitor.

```
 pages/ + ui/        screens, generic list/form engine         (knows nothing about storage or devices)
      │
 domain/             modules.js, alerts.js, spending.js        (pure rules: statuses, due dates, mileage)
      │
 data/               Repository ── Adapter (local | http)      (swap storage without touching screens)
                     fileStore (IndexedDB blobs)
 platform/           notifications, open link/UPI, download    (the ONLY file that changes for native)
```

## Going from website to app

The app is already a PWA (manifest + service worker + icons) — "Add to Home Screen" works today.
For store apps, wrap `web/` with Capacitor (config is in `capacitor.config.json`, `webDir: "web"`).
Commands below are the standard Capacitor flow; **verify against the current Capacitor docs** since CLI details change:

```bash
cd homehub
npm i @capacitor/core @capacitor/cli
npm i @capacitor/android @capacitor/ios @capacitor/local-notifications
npx cap add android          # and/or: npx cap add ios   (iOS needs a Mac + Xcode)
npx cap sync
npx cap open android         # build/run from Android Studio
```

Native-specific work is confined to `web/platform/platform.js`:

| Capability | Web now | Native upgrade |
|---|---|---|
| Reminders | Notification API when app is opened | `@capacitor/local-notifications` — schedule per-item at due date − lead days (code path already stubbed in `notify()`; background scheduling still to build) |
| File attach | `<input type=file>` (camera on mobile) | Capacitor Camera/Filesystem if you want in-app scanning |
| Open pay link / UPI | `window.open` / `location.href` | `@capacitor/browser` / app-launcher |
| Backup export | download link | Share sheet / Filesystem |

Set a real `appId` in `capacitor.config.json` (currently `com.example.homehub`) before publishing.

## Going from local to cloud (login, sync, family sharing)

`Repository` talks to an adapter with 4 methods (`loadAll`, `upsert`, `remove`, `clear`).
`data/adapters/httpAdapter.js` is an **untested stub** showing the REST shape:

```
GET /sync → { collection: Record[] }      PUT /{collection}/{id}      DELETE /{collection}/{id}
```

Suggested backend: Postgres with one generic `records(collection, id, household_id, data jsonb, updated_at, deleted_at)`
table plus a `households`/`members` model for family sharing; object storage for the file attachments
(`fileStore` gets an S3-style implementation with the same `put/get/delete`). Then:

1. Add auth (sessions/JWT) and pass the token via `httpAdapter(base, getToken)`.
2. For true offline + multi-device, keep the local adapter as the cache and queue writes to the server
   (records already carry `id`, `createdAt`, `updatedAt` — last-write-wins is the simple first policy).
3. Sync reminders server-side if you want push notifications when the app is closed.

Records are plain JSON (`{id, createdAt, updatedAt, ...fields}`), so migration from local → cloud is an upload of
`repo.dump()` (the same payload Settings → Export produces).

## Data model (collections)

`bills, subscriptions, expenses, invoices, policies, medical, staff, salaries, documents,
vehicles, vehicleServices, fuelLogs, appliances, applianceServices`

Relations are by id (`vehicleId`, `staffId`, `applianceId`, `policyId`); `children` on a module cascades deletes.
Attachments are `{id, name, type, size}` references into `fileStore`.

## Derived, never stored

- **Mileage / cost per km** — full-tank method between consecutive full fills (`fuelStats` in `modules.js`).
- **Needs-attention list** — `alerts.js` scans every module's `dates` declaration.
- **Spending roll-ups** — `spending.js` normalises payments from expenses, paid bills, salaries, medical,
  vehicle/appliance service and paid invoices. Logging one payment in two places double-counts it.

## Suggested next steps

1. Native wrapper + background local notifications (highest user value).
2. Backend + login + household sharing (spouse, parents).
3. Auto-capture: parse bill emails/SMS or photo-OCR of invoices into records (privacy review needed).
4. Real bill payment through a licensed bill-payment aggregator (compliance, not just code).
5. Encryption at rest for documents; PIN/biometric lock in the native app.
6. Automated tests (the domain layer is pure and easy to unit-test; none exist yet).
