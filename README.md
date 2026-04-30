# DomainPulse — Instant Domain Search

Real-time domain availability checker with SSE streaming, JWT auth, MySQL history, and affiliate registrar links.

## Stack
- **Frontend**: React 18 + Vite + plain CSS (dark theme)
- **Backend**: Node.js + Express + SSE streaming
- **Database**: MySQL 8+
- **Domain checks**: RDAP via rdap.org (free, no API key)

## Setup

### 1. Database
```bash
mysql -u root -p < backend/schema.sql
```

### 2. Backend
```bash
cd backend
cp .env.example .env       # edit with your DB credentials & JWT secret
npm install
npm run dev                # http://localhost:3000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```

## Affiliate Links

Edit `frontend/src/config/registrars.js` — replace the placeholder IDs with your own:

| Registrar | Where to get your ID |
|-----------|---------------------|
| Namecheap | namecheap.com/affiliates → `clickref` |
| GoDaddy   | godaddy.com/affiliate → `isc` code |
| Porkbun   | porkbun.com/referral |
| Name.com  | name.com/referral → `ref` username |

Registrars are sorted by commission rate. The **highest commission** registrar is shown as the primary "Register" button; others are revealed via "Compare prices".

## How it works

1. User types a domain name
2. After 400ms debounce, an SSE connection opens to `/api/search/stream`
3. The backend checks each TLD in parallel (8 at a time) via RDAP
4. Results stream back one by one as each TLD check completes
5. If logged in, the full search is saved to MySQL on completion

## Environment Variables

| Variable       | Default             | Description |
|----------------|---------------------|-------------|
| PORT           | 3000                | Backend port |
| DB_HOST        | localhost           | MySQL host |
| DB_PORT        | 3306                | MySQL port |
| DB_USER        | root                | MySQL user |
| DB_PASSWORD    |                     | MySQL password |
| DB_NAME        | domain_search       | MySQL database |
| JWT_SECRET     | (required)          | ≥32 random chars |
| JWT_EXPIRES_IN | 7d                  | Token lifetime |
| CLIENT_ORIGIN  | http://localhost:5173 | CORS origin |
