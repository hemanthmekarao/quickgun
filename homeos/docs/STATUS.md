# Status: what works, what is unverified, what is not built

This file is deliberately blunt. It separates three things that are easy to blur together:

- **Verified** — implemented and exercised by automated tests that pass in CI.
- **Implemented, not verified** — code exists, but it has never been run against the real external service it talks to.
- **Not built** — only an integration point exists, or nothing does.

## How this was verified

The project was written in an environment where npm packages could not be installed, so nothing that depends on NestJS, Prisma or Next.js could be run locally. Verification is therefore through the GitHub Actions workflow (`.github/workflows/homeos-ci.yml`):

| Check | What it proves |
| --- | --- |
| Shared package unit tests (29) | Validation, permission matrix, finance rules (categorisation, duplicate detection, bank CSV parsing, ledger posting, mileage), reminder thresholds, invoice field extraction, assistant intent parsing, OpenAPI generation, API client token refresh. Also run locally. |
| Security primitive checks | Password hashing, JWT (including rejection of `alg: none`), TOTP against RFC 6238 vectors, AES-GCM tamper detection. Also run locally. |
| API end-to-end tests (70) against PostgreSQL | Registration, sign-in, refresh rotation, session revocation, MFA; tenant isolation in every direction; create/read/update/delete on every writable record type with every field; bills → ledger; offline and simulated payments including forged and mismatched webhooks; expense approvals; bank import and reconciliation; vehicles, appliances, staff salaries, recurring maintenance; document upload, extraction, search, versions, signed links, sharing; inbox review; invitations, role permissions, property scoping, sensitive documents; reminders without duplicates; calendar; assistant; privacy endpoints; OpenAPI document. |
| Web production build | Every page type-checks and compiles. |
| Browser test | Signs in to a seeded demo household, opens all 34 required routes plus travel and smart-home on desktop and phone widths, and fails on crashes, console errors, failed API calls, error banners or horizontal overflow. Adds an expense through the form, checks validation messages, dark mode, the mobile menu and sign-out. |

What automated tests do **not** establish: visual quality beyond the checks above, behaviour under load, behaviour with large data volumes, accessibility beyond basic semantics, and security against a determined attacker. No human has used this application yet.

## Acceptance criteria from the brief

| Criterion | State |
| --- | --- |
| Register and create a household | Verified |
| Add multiple properties | Verified |
| Add and track bills | Verified |
| Record and categorise expenses | Verified (keyword-based automatic categorisation) |
| Upload and search documents | Verified for text files and for PDFs with a text layer |
| Register and maintain vehicles | Verified |
| Register appliances with warranty details | Verified |
| Manage household staff and salaries | Verified |
| Create maintenance tasks | Verified |
| Configure reminders | Verified (rules per event type, days-before offsets, channels) |
| Dashboards show accurate consolidated information | Verified for the cases tested (totals, refunds, approvals, ledger posting). Not exhaustively. |
| Multiple family members access permitted information | Verified |
| Data is securely stored | Partly: see SECURITY.md. Encryption, isolation and permissions are tested; there has been no independent security review. |
| APIs documented and usable independently | Verified (OpenAPI at `/docs` and `/openapi.json`; the tests and the seeder use only the API) |
| Responsive on mobile browsers | Verified for layout overflow and navigation at 390 px wide |
| Backend ready for React Native clients | The API is client-agnostic and the shared client works without cookies. No mobile app exists to prove it end to end. |

## Module by module

| Module | Built | Notes |
| --- | --- | --- |
| A. Dashboard | Yes | "AI-generated monthly summary" is a summary **calculated** from your figures, not written by a language model. |
| B. Finance | Yes | Bank import is CSV upload. There is no live bank connection. |
| C. Bills & utilities | Yes | |
| D. Subscriptions | Yes | "Unused" is based on a last-used date you enter; HomeOS cannot observe usage. |
| E. Properties | Yes | |
| F. Document vault | Yes | OCR of photos and scans needs an AI key (see below). Scanned PDFs without a text layer are stored but not searchable inside. |
| G. Vehicles | Yes | Ownership cost excludes insurance premiums, loan interest and depreciation, and says so. |
| H. Appliances | Yes | Replacement advice is rule-based (age, condition, repair spend). |
| I. Maintenance | Yes | |
| J. Staff | Yes | |
| K. Insurance & healthcare | Yes | |
| L. Shopping | Yes | Manual entry; no retailer integrations. |
| M. Smart home | Registry only | Device inventory plus an API endpoint for adapters to report state. No platform adapter. |
| N. Travel & assets | Yes | |
| O. AI assistant | Yes, two modes | Without an AI key: a fixed set of ten question types answered from real data. With a key: tool-calling over the same data. Only the first mode is tested. |
| Unified inbox | Yes | Upload and a generic inbound-email webhook. No mailbox connection (Gmail/Outlook). Nothing is filed without your confirmation. |
| Payments | Partly | Recording payments you made yourself: yes. Real in-app payment: **no**. |
| Notifications | Partly | In-app: yes. E-mail: implemented, unverified. SMS, WhatsApp, push: not built. |
| Users & roles | Yes | |

## Implemented but never run against the real service

Treat each of these as untested until you have tried it with real credentials:

- **AI model** (assistant tool-calling, image transcription) — written against the OpenAI-compatible chat completions API. The default model name may be out of date; set `OPENAI_MODEL`.
- **S3-compatible storage** — written against the AWS SDK v3.
- **Redis job queue** (BullMQ).
- **SMTP e-mail** (Nodemailer).
- **Docker images and docker-compose** — written without a Docker daemon to build them.
- **Data erasure job** — off by default; no test covers it. Test it on a copy before enabling.

## Not built

- A real **payment gateway or Bharat Connect (BBPS)** integration. This needs a contract with a licensed provider and work against their documentation, plus the regulatory and PCI DSS obligations that come with it. The adapter contract and webhook handling are in place and tested with a simulated provider that cannot be enabled in production.
- **SMS, WhatsApp and push** delivery.
- **Live bank feeds** (account aggregator).
- **Mailbox connection** for automatic invoice pickup.
- **Smart-home platform** adapters.
- **Mobile apps.**
- **Prisma migration files and a package lockfile** (see DEPLOYMENT.md — both need one command on a machine with network access).
- **Error tracking, metrics, automated backups, deployment pipeline.**
- **PostgreSQL row-level security**, key rotation, virus scanning of uploads.

## Known limitations

- Dates are calendar days in UTC; the household time zone is stored but not yet used for "today".
- Document search has no dedicated index; it scans the household's documents on each search.
- Lists page at 25–200 rows; a few summary screens load up to 200 rows and would under-count beyond that.
- Property restriction applies to records that are linked to a property directly or through their parent (a bill through its utility account, a fuel entry through its vehicle, a salary through the staff member). Records with no property link at all — subscriptions, vendors, bank accounts — are governed by role permissions only.
- The recorded `AI_PROCESSING` consent does not yet gate AI calls.
- Rate limiting is per client IP address. The web app reaches the API through the Next.js server, so check in your deployment that the original client address is forwarded (`X-Forwarded-For`); if it is not, all web users share one rate-limit bucket. What Next.js forwards by default has not been verified.
- The web app is client-rendered; there is no offline data access (the service worker caches only the static shell).
