# Architecture

## Overview

```
 Web app (Next.js)        Mobile apps (React Native / Expo — not built yet)
        │  same-origin /api proxy            │  HTTPS, bearer tokens
        └───────────────┬────────────────────┘
                        ▼
                 REST API (NestJS)  ── OpenAPI at /docs, /openapi.json
                        │
        ┌───────────────┼──────────────────┬─────────────────┐
        ▼               ▼                  ▼                 ▼
   PostgreSQL      Document storage     Redis (optional)   External services (optional)
   (Prisma)        local disk or S3,    job queue          AI model, SMTP
                   encrypted by the API
```

The API is a **modular monolith**: one deployable process, organised into modules with clear boundaries.

| Module | Responsibility |
| --- | --- |
| `auth` | Registration, sign-in, refresh-token rotation, sessions, TOTP two-step verification |
| `households` | Households, members and invitations, roles and the permission matrix |
| `resources` | Tenant-scoped CRUD for every record type, validation, audit, business rules, ledger posting |
| `documents` | Encrypted storage, versions, signed download links, share links, full-text search |
| `inbox` | Unified inbox: uploads and forwarded e-mail → extracted fields → reviewed → filed |
| `finance` | Expense approvals, bank statement import, reconciliation |
| `staff` | Monthly salary generation, attendance |
| `payments` | Offline payment records, provider adapter contract, webhooks, refunds, receipts |
| `notifications` | Reminder rules, daily scan, delivery channels, device registry |
| `insights` | Dashboard, calendar, reports, search (read-only aggregation) |
| `assistant` | Conversational assistant over read-only, permission-checked tools |
| `privacy` | Consent, data export, deletion requests and erasure job |
| `jobs` | Background job queue (Redis/BullMQ, or in-process) |

## The resource registry

`packages/shared/src/resources.ts` declares every record type: its URL, permission module, and fields (type, required, options, references, form grouping, whether it is server-managed or hidden).

Everything else is derived from it:

- **Database** — `apps/api/scripts/generate-schema.mjs` writes `prisma/schema.prisma` (core identity models in `prisma/core.prisma` + one model per registry resource, with foreign keys for every reference). CI fails if the committed schema is stale.
- **API** — `resource.controller.ts` creates a controller per resource; `resource.service.ts` implements list/get/create/update/delete once, for all of them.
- **Validation** — `validate.ts` checks input against the field definitions. Unknown fields and server-managed fields are rejected, not ignored.
- **OpenAPI** — `openapi.ts` produces paths and schemas for each resource.
- **Web** — `components/resource.tsx` renders the table, filters, form and detail view for any resource.

### Adding a field or a record type

1. Edit `packages/shared/src/resources.ts`.
2. `npm run build:shared && npm run db:generate` and create a migration (see DEPLOYMENT.md).
3. For a new record type, add a page that renders `<ResourceView resource="your-key" />`.

Business rules that go beyond CRUD live in `ResourceService.beforeWrite / afterWrite` (for example: auto-categorising an expense, computing net salary, creating the next occurrence of a recurring maintenance task).

## Data model conventions

Every household-owned table has: `id` (UUID), `householdId`, `createdAt`, `updatedAt`, `createdById`, `status`, `deletedAt` (soft delete). Money is `DECIMAL(14,2)`. Dates without a time are stored as UTC midnight and exchanged as `YYYY-MM-DD`.

### One ledger

Spending totals always come from the `Expense` table. Records that represent money leaving the household are mirrored into it automatically and kept in sync when they change:

| Source record | Posted when |
| --- | --- |
| Bill | marked paid or partly paid |
| Salary | marked paid or partly paid |
| Fuel log, vehicle service | created |
| Work order | marked paid |
| Medical record | has an amount (posted as "Healthcare expense", with no medical detail) |
| Purchase | created (net of refunds) |
| Travel booking | has an amount and is not cancelled |

Mirrored expenses carry `sourceType` / `sourceId` and cannot be edited directly — change the source record instead. `Transaction` holds bank statement lines, which are reconciled against expenses so nothing is counted twice.

## Request flow

1. `AuthGuard` verifies the access token and checks the session has not been revoked.
2. `HouseholdGuard` loads the caller's membership of the household named in `X-Household-Id`, with their role's permissions and any property restriction, into a request context.
3. The service checks the module permission, builds a query that is always constrained to that household (plus property scope and document sensitivity), validates input, verifies that every referenced record belongs to the same household, and performs the write, audit entry and follow-on effects in one database transaction.

The dashboard, reports, calendar, reminder scan and assistant all read through the same scoping function, so they cannot show more than the REST endpoints do.

## Background work

- Daily at 02:30 UTC: for each household, create the month's salary records if missing, evaluate reminder rules per member, raise budget alerts.
- Hourly: start scheduled payments that have fallen due (only relevant when a payment provider is connected).

With `REDIS_URL` set these run through a BullMQ queue; otherwise in-process. Run the scheduler on exactly one API instance (`SCHEDULER_ENABLED`).

## Web app

Next.js App Router, client-rendered behind sign-in, data via TanStack Query. The browser calls `/api/*`, which Next.js proxies to the API, so the refresh token can be an httpOnly cookie and the access token stays in memory. Design tokens are CSS variables (`globals.css`) with light and dark themes; shared components are in `src/components`.
