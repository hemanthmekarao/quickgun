# Security and privacy

This document describes what the code does. It is not a certification, and it is not legal advice. Before handling real household data you should have the deployment reviewed (see "Before going live").

## Authentication

- Passwords: scrypt (N=16384, r=8, p=1) with a per-user salt; minimum 10 characters with letters and digits.
- Access tokens: HS256 JWT, 15 minutes, held in memory by the web app. Tokens with any other algorithm (including `none`) are rejected.
- Refresh tokens: random 48 bytes, stored only as a SHA-256 hash, **rotated on every use**. A used token is no longer valid. Delivered to the web app as an httpOnly, SameSite=Lax cookie (Secure in production) and in the response body for native apps.
- Sessions are checked on every request, so signing a device out takes effect immediately. Changing your password signs out all other devices.
- Sign-in is rate limited and the account locks for 15 minutes after 8 consecutive failures.
- Two-step verification: TOTP (RFC 6238), secret encrypted at rest. Verified against the RFC test vectors in `apps/api/test/crypto.unit.mjs`.

## Tenant isolation

Every household-owned row has a `householdId`. All access goes through `ResourceService`, whose `scope()` adds `householdId = <caller's household>` to every query; the household comes from a verified membership, never from request data. When a record references another record, the API checks the target belongs to the same household. The end-to-end tests attempt cross-household reads, writes, deletes, header spoofing and cross-household references and expect them all to fail.

Isolation is enforced in the application layer. PostgreSQL row-level security is **not** configured; adding it would give a second, independent barrier.

## Permissions

Eight roles (owner, spouse, family member, accountant, property manager, home manager, driver, domestic staff) × 23 modules × four actions (view, add/edit, delete, approve). Defaults are in `packages/shared/src/roles.ts`; an owner can change them per household. Owners always keep full access.

Beyond the matrix:

- **Property scope** — a member can be limited to specific properties and then only sees records linked to them.
- **Document sensitivity** — financial, medical and identity documents require the matching permission; a document can also be limited to named members. A member cannot classify a document at a level they cannot see.
- **Medical data** — in its own module, off by default for everyone except owner and spouse. Medical spending appears in the ledger only as "Healthcare expense".
- **Approvals** — expenses above a household limit entered by members without approve rights are excluded from totals until approved; nobody can approve their own.
- **Notifications** — computed separately for each member with that member's permissions.

## The AI assistant

The assistant has no database access. It can only call a fixed set of read-only tools (`packages/shared/src/assistant.ts`), each of which runs with the caller's own permissions. There is no tool that pays, deletes, edits or shares. Conversations are private to the user who had them.

When an AI model is configured, questions and the tool results needed to answer them are sent to that provider, and images uploaded to the vault are sent for text extraction. Without one, nothing leaves the server. The `AI_PROCESSING` consent is recorded but **is not yet enforced as a gate** on those calls — treat configuring an AI key as a deployment-wide decision until it is.

## Documents

- Files are encrypted with AES-256-GCM using `DATA_ENCRYPTION_KEY` before they are written to disk or to S3 (S3 server-side encryption is requested as well).
- Files are never served from storage directly. Members get a signed link valid for five minutes; opening one is recorded in the audit log.
- External share links are random tokens (stored hashed), always expire (max 30 days), can have a download limit, can be revoked, and require explicit confirmation for sensitive documents.
- File types are restricted by extension and checked against file signatures; files are served with `nosniff` and a sandboxing CSP.
- Originals and all earlier versions are preserved; a SHA-256 checksum is stored for each.

## Payments

HomeOS never marks a payment successful on the client's word. An online payment becomes `SUCCEEDED` only when a provider webhook arrives with a valid signature, for a known order, with a matching amount. Payments the user records themselves are stored as `RECORDED_OFFLINE` and labelled "self-reported" everywhere, including on the receipt.

**No real payment provider is integrated.** Doing so brings obligations under RBI/NPCI rules, BBPS operating guidelines and PCI DSS that depend on the provider and the commercial arrangement; they are not addressed by this code. HomeOS stores no card numbers — only the last four digits of an account, if the user enters them.

## Audit

Every create, update and delete of a household record writes an audit entry (who, what, field-level before/after) in the same transaction as the change. Also logged: document opens, shares and share-link downloads, payments, approvals, exports, permission changes. Storage keys, secrets and extracted document text are never written to the audit log.

## Data rights (DPDP Act orientation)

Implemented: recorded consent with withdrawal for optional purposes; account and household export as JSON; deletion requests with a 30-day cancellable grace period; an erasure job (`DELETION_JOB_ENABLED=true`) that removes stored files and database rows.

Not implemented, and needed for a compliant service: a privacy notice and consent wording reviewed by counsel; a grievance contact; verifiable parental consent for children's data; breach detection and notification procedures; retention schedules; data-processing agreements with any provider you connect. Rules under the Act have continued to evolve — check the current requirements.

## Other controls

- Rate limiting on all routes (stricter on sign-in and the assistant); Helmet security headers; CORS limited to configured origins.
- Request bodies limited to 6 MB, uploads to `MAX_UPLOAD_MB`.
- CSV exports neutralise spreadsheet formula injection.
- Production refuses to start without `JWT_SECRET` and `DATA_ENCRYPTION_KEY`; the simulated payment provider cannot be enabled in production.

## Before going live

- Serve only over HTTPS; set `COOKIE_SECURE=true`.
- Keep `DATA_ENCRYPTION_KEY` in a secrets manager and back it up separately from the data. There is no key-rotation tooling yet.
- Enable encryption at rest on the database volume or managed database, and encrypted backups.
- Commission an independent security review and penetration test. The automated tests here are not a substitute.
