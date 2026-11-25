# HomeHub — run your home from one place

Bills, subscriptions, expenses, invoices, insurance, medical bills, home-staff salaries, property documents,
vehicles (service, fuel & mileage) and appliances (warranty, AMC, servicing) — with one "Needs attention"
dashboard and reminders. Built as an installable, offline-first web app (PWA) with an architecture that
wraps into iOS/Android apps without a rewrite (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Run it

```bash
cd homehub
npm start            # → http://localhost:5173   (no dependencies, no build step)
```

Open it, click **Load sample data** to explore, or just start adding your own. On a phone, open the URL and
use *Add to Home Screen* to install it as an app.

## What it covers

| You asked for | Where |
|---|---|
| Invoices | Spending & Invoices → Invoices (file attachments, pending/paid, GST) |
| Electric, water, gas, internet, phone, cable, society maintenance, property tax | Bills & Utilities → Bills (recurring, "Mark paid" schedules the next one, Pay link / UPI deep link) |
| Netflix, DTH, etc. | Bills & Utilities → Subscriptions (monthly/yearly cost roll-up, renewal reminders) |
| Insurance, hospital bills | Insurance & Health (renewals, claim tracking) |
| Groceries, restaurants, other payments | Spending & Invoices → Expenses (category charts, monthly budget) |
| Home staff salaries | Home Staff → Staff + Salary payments (one-tap "Pay salary", unpaid-this-month alerts) |
| Property documents | Property & Documents (scans, where the original is kept, expiry alerts) |
| Car / bike | Vehicles → vehicles, service & repairs, fuel log (mileage + cost/km), insurance/PUC/service due |
| Fridge, washer, dishwasher, stove, water filter… | Appliances → warranty, AMC, next service, service history |

## Honest limitations (v0.1)

- **"Pay" opens your provider's payment page or a UPI deep link — HomeHub does not move money itself.**
  Real in-app payments / bill fetch (e.g. via a bill-payment aggregator) need a regulated provider and a backend.
- Data lives **on the device** (browser storage + IndexedDB for files). There is no sync or login yet — use
  Settings → Export backup. The sync path is designed but not built (see architecture doc).
- Browser reminders only fire while the app is opened; background scheduled reminders need the native wrapper.
- The UPI link format (`upi://pay?pa=…`) is the common deep-link convention; test it with your UPI app.
- Sample data is fictional.

## Layout

```
homehub/
  web/                 the app (this folder is what Capacitor wraps)
    domain/modules.js  ← every tracked thing is declared here (fields, status, reminders, actions)
    domain/…           alerts, spending roll-ups, seed data
    data/              Repository + swappable adapters (local now, HTTP later) + file store
    platform/          the only place that touches device APIs (notifications, links, downloads)
    ui/ pages/         generic form/list engine, dashboard, settings
  scripts/             dev server, icon generator
  capacitor.config.json
```
