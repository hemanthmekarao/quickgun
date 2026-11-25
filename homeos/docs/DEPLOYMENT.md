# Deployment

## Components

| Component | Notes |
| --- | --- |
| API (`apps/api`) | Stateless Node.js process. Scale horizontally; run the scheduler on one instance only. |
| Web (`apps/web`) | Next.js server. Needs `API_URL` at build time for the `/api` proxy rule. |
| PostgreSQL 14+ | The system of record. |
| Document storage | Local volume (single server) or an S3-compatible bucket (recommended for anything more). |
| Redis (optional) | Durable job queue. Without it jobs run in-process. |

Put both servers behind a TLS-terminating reverse proxy or load balancer. The API trusts one proxy hop for client IP addresses.

## Configuration

All configuration is environment variables; see `.env.example` for the full list. In production the API refuses to start without `JWT_SECRET` (≥ 32 characters) and `DATA_ENCRYPTION_KEY` (64 hex characters).

`DATA_ENCRYPTION_KEY` encrypts every stored document and the two-step verification secrets. If it is lost, those are unrecoverable. Store it in a secrets manager and keep a separate backup.

## Database schema and migrations

The schema file is generated (`npm run db:generate`). This repository does **not** yet contain Prisma migration files: they could not be generated in the environment the project was written in. Until you create them:

- Development and first install: `npm run db:push` (creates/updates tables to match the schema). The API Docker image does this on start.
- Before running in production with real data, create a baseline migration once, on a machine with database access, and commit it:

  ```bash
  cd apps/api
  npx prisma migrate dev --name init
  ```

  From then on deploy with `npx prisma migrate deploy` and change the image's start command accordingly. `db push` can drop columns when the schema changes, so do not rely on it once you have data you care about.

Recommended addition for large vaults — a full-text index for document search (search works without it, by scanning the household's documents):

```sql
CREATE INDEX document_search_idx ON "Document" USING gin (
  to_tsvector('english', coalesce("title",'') || ' ' || coalesce("description",'') || ' ' || coalesce("fileName",'') || ' ' || coalesce("extractedText",''))
);
```

The query in `documents.service.ts` also includes tags in its expression, so adjust one or the other to match if you want the planner to use the index.

## Backups and recovery

Three things must be backed up together to restore a working system:

1. **PostgreSQL** — scheduled `pg_dump` or, preferably, your provider's point-in-time recovery. Test a restore.
2. **Document storage** — the bucket (enable versioning) or the `storage` volume.
3. **`DATA_ENCRYPTION_KEY`** — separately from 1 and 2.

No backup automation is included in this repository; configure it in your hosting platform. Decide and write down your recovery point and recovery time objectives, then rehearse a restore into a clean environment.

## Monitoring

- Liveness/readiness: `GET /v1/health` (checks the database).
- Logs: the API writes structured NestJS logs to stdout; unexpected errors are logged with stack traces and return a generic message to the client.
- Error tracking and metrics are **not** wired in. Add your provider's SDK in `apps/api/src/main.ts` and the Next.js instrumentation hook.

## CI/CD

`.github/workflows/homeos-ci.yml` runs on every pull request: shared unit tests, generated-schema check, Prisma validation, API build and end-to-end tests against PostgreSQL, web production build, and a browser test of every page against a seeded stack. There is no deployment job; add one for your platform that builds the two images and runs migrations before switching traffic.

Dependencies are specified with version ranges and no lockfile is committed (it could not be generated where the project was written). Run `npm install` once and commit the resulting `package-lock.json` so builds are reproducible, then switch CI and the Dockerfiles to `npm ci`.

## Connecting optional services

| Service | Setting | State |
| --- | --- | --- |
| AI model (assistant, reading photos) | `OPENAI_API_KEY`, `OPENAI_MODEL` | Implemented against the OpenAI-compatible chat completions API; not exercised against a live key. |
| E-mail reminders | `SMTP_URL`, `MAIL_FROM` | Implemented; not exercised against a live SMTP server. |
| Forwarded invoices | `INBOUND_EMAIL_SECRET` + your mail provider's HTTP forwarding to `POST /v1/inbox/email` | Endpoint tested; you must map your provider's payload to `{ householdId, from, subject, text, attachments[] }`. |
| S3 storage | `STORAGE_DRIVER=s3`, `S3_*` | Implemented; not exercised against a live bucket. |
| Redis queue | `REDIS_URL` | Implemented; not exercised in CI. |
| Payment gateway / BBPS, SMS, WhatsApp, push, bank feeds, smart-home platforms | — | Not implemented. Adapter contracts exist; see STATUS.md. |
