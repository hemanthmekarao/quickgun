# HomeOS

A personal home management platform: one place for a household's expenses, bills, properties, vehicles, appliances, maintenance, staff, insurance, healthcare records, subscriptions, purchases, assets, travel and documents.

HomeOS is API-first. The web app in this repository is one client of the REST API; Android and iOS apps can use the same API without any backend changes (see [docs/MOBILE.md](docs/MOBILE.md)).

> **Read [docs/STATUS.md](docs/STATUS.md) first.** It lists, feature by feature, what is implemented and tested, what is implemented but not exercised against a real external service, and what is deliberately not included (for example a real payment gateway).

## What is in the repository

```
homeos/
├─ packages/shared   Dependency-free TypeScript: the resource registry (every record type and its
│                    fields), validation, role/permission rules, finance and reminder logic,
│                    invoice text extraction, assistant intent parsing, OpenAPI builder, API client.
├─ apps/api          NestJS REST API, Prisma + PostgreSQL. Auth, tenancy, RBAC, audit, documents,
│                    payments, reminders, assistant, privacy endpoints. OpenAPI at /docs.
├─ apps/web          Next.js (App Router) + Tailwind web app. 36 routes, responsive, installable (PWA).
└─ docs              Architecture, security & privacy, mobile, deployment, status.
```

One idea keeps the three parts consistent: **the resource registry** (`packages/shared/src/resources.ts`). The database schema is generated from it, the API validates and documents requests from it, and the web app builds its tables and forms from it. Adding a field is a one-line change in one file.

## Run it locally

Requirements: Node.js 20+, PostgreSQL 14+ (Redis optional).

```bash
cd homeos
npm install
cp .env.example .env                 # then set DATABASE_URL (JWT_SECRET / DATA_ENCRYPTION_KEY are optional in development)
export $(grep -v '^#' .env | xargs)  # or use your preferred env loader

npm run build:shared                 # shared package must be built first
npm run db:generate                  # regenerate prisma/schema.prisma and the Prisma client
npm run db:push                      # create the tables

npm run build -w @homeos/api && npm run start -w @homeos/api     # API on http://localhost:4000
npm run dev -w @homeos/web                                       # web on http://localhost:3000
```

Open http://localhost:3000, create an account and you have an empty household.

API documentation: http://localhost:4000/docs (Swagger UI) and http://localhost:4000/openapi.json.

### Demo data

To explore with sample data (clearly invented — demo environments only):

```bash
npm run db:seed -- --email demo@example.com --password 'Demo-password-1'
```

It creates a household through the public API with properties, bills, a year of expenses, vehicles, appliances, staff, insurance, documents and more, and prints the sign-in details.

### Docker

```bash
cp .env.example .env    # set JWT_SECRET and DATA_ENCRYPTION_KEY
docker compose up --build
```

The Docker files were written without a Docker daemon available to test them; see [docs/STATUS.md](docs/STATUS.md).

## Tests

```bash
npm test -w @homeos/shared     # 29 unit tests, no dependencies
npm test -w @homeos/api        # security-primitive checks + end-to-end API tests (needs DATABASE_URL)
npm run e2e -w @homeos/web     # browser smoke test over every route (needs a running, seeded stack)
```

CI (`.github/workflows/homeos-ci.yml`) runs all of these on every pull request.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) — what works, what is unverified, what is not built
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, data model, request flow, how to add a module
- [docs/SECURITY.md](docs/SECURITY.md) — authentication, tenant isolation, permissions, encryption, privacy and DPDP notes
- [docs/MOBILE.md](docs/MOBILE.md) — building Android/iOS clients on the same API
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — configuration, migrations, backups, monitoring
