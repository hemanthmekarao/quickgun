#!/usr/bin/env node
/**
 * Browser smoke test. Signs in to a seeded demo household and opens every route, on a
 * desktop and a phone-sized viewport, failing on page crashes, console errors, failed API
 * calls, error banners or horizontal overflow. Also exercises one create flow end to end.
 *
 *   SEED_JSON='{"email":...}' WEB_URL=http://localhost:3000 node apps/web/e2e/smoke.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const seed = JSON.parse(process.env.SEED_JSON ?? '{}');
if (!seed.email || !seed.password) {
  console.error('SEED_JSON with email and password is required (output of seed-demo.mjs).');
  process.exit(2);
}
const shots = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(shots, { recursive: true });

/** [path, text that must be visible] */
const ROUTES = [
  ['/dashboard', 'Spent this month'],
  ['/household', 'Vikram Rao'],
  ['/finance', 'Rent received'],
  ['/finance/transactions', 'Bank transactions'],
  ['/finance/budgets', 'Groceries'],
  ['/bills', 'Electricity — Indiranagar'],
  ['/bills/upcoming', 'Overdue'],
  ['/payments', 'Payments'],
  ['/properties', 'Indiranagar Apartment'],
  [`/properties/${seed.propertyId}`, 'Estimated value'],
  ['/vehicles', 'Family SUV'],
  [`/vehicles/${seed.vehicleId}`, 'Total cost of ownership'],
  ['/appliances', 'Living room AC'],
  [`/appliances/${seed.applianceId}`, 'Warranty'],
  ['/maintenance', 'Kitchen sink leaking'],
  ['/staff', 'Lakshmi'],
  [`/staff/${seed.staffId}`, 'Monthly salary'],
  ['/insurance', 'Family health floater'],
  ['/healthcare', 'Manipal Hospital'],
  ['/shopping', 'Dining table'],
  ['/subscriptions', 'Netflix'],
  ['/documents', 'Sale deed'],
  [`/documents/${seed.documentId}`, 'Versions'],
  ['/assets', 'Gold necklace set'],
  ['/travel', 'Goa'],
  ['/smart-home', 'Front door camera'],
  ['/calendar', 'This month'],
  ['/reports', 'Assets and liabilities'],
  ['/assistant', 'What would you like to know?'],
  ['/notifications', 'Notifications'],
  ['/settings', 'Privacy choices'],
  ['/settings/users', 'What each role can do'],
  ['/settings/integrations', 'Document storage'],
  ['/settings/security', 'Two-step verification'],
];

const problems = [];
const note = (where, what) => {
  problems.push(`${where}: ${what}`);
  console.error(`  ✗ ${where}: ${what}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await context.newPage();
let current = 'startup';

page.on('pageerror', (err) => note(current, `page error: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // The first refresh attempt before signing in is expected to be rejected.
  if (/401|Failed to load resource/.test(text) && current === 'login') return;
  note(current, `console error: ${text.slice(0, 300)}`);
});
page.on('response', (res) => {
  const url = res.url();
  if (!url.includes('/api/')) return;
  const status = res.status();
  if (status >= 500) note(current, `API ${status} ${url}`);
  else if (status >= 400 && !(current === 'login' && status === 401)) note(current, `API ${status} ${res.request().method()} ${url.replace(WEB, '')}`);
});

async function settle() {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
}

/* ---- sign in ---- */
current = 'login';
await page.goto(`${WEB}/login`);
await page.getByLabel('E-mail').fill(seed.email);
await page.getByLabel('Password').fill(seed.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/dashboard', { timeout: 30_000 });
await settle();
console.log('signed in');

/* ---- every route, desktop ---- */
for (const [path, expected] of ROUTES) {
  current = path;
  await page.goto(`${WEB}${path}`);
  await settle();
  const main = page.locator('#main');
  if (!(await main.count())) {
    note(path, 'app shell did not render');
    continue;
  }
  try {
    await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    note(path, `expected text not found: "${expected}"`);
  }
  const text = await main.innerText();
  if (/Something went wrong|Application error|Not permitted/.test(text)) note(path, 'an error banner is showing');
  await page.screenshot({ path: join(shots, `desktop${path.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`) });
  console.log(`  ✓ ${path}`);
}

/* ---- create flow: add an expense through the UI ---- */
current = 'create-expense';
await page.goto(`${WEB}/finance?add=1`);
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible', timeout: 15_000 });
await dialog.getByLabel(/^Description/).fill('Smoke test stationery');
await dialog.getByLabel(/^Amount/).first().fill('321');
await dialog.getByRole('button', { name: 'Add expense' }).click();
await dialog.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => note(current, 'the form did not close after saving'));
await settle();
try {
  await page.getByText('Smoke test stationery').first().waitFor({ state: 'visible', timeout: 15_000 });
  console.log('  ✓ created an expense through the form');
} catch {
  note(current, 'the new expense is not listed');
}

/* ---- validation is shown, not swallowed ---- */
current = 'validation';
await page.goto(`${WEB}/vehicles`);
await settle();
await page.getByRole('button', { name: /Add vehicle/ }).first().click();
const vDialog = page.getByRole('dialog');
await vDialog.getByRole('button', { name: 'Add vehicle' }).click();
try {
  await vDialog.getByText('is required').first().waitFor({ state: 'visible', timeout: 10_000 });
  console.log('  ✓ required-field errors are shown');
} catch {
  note(current, 'no validation message appeared for an empty form');
}
// The rejected request is expected here; drop the API 400 it logged.
for (let i = problems.length - 1; i >= 0; i--) if (problems[i].startsWith('validation: API 400') || problems[i].startsWith('validation: console error')) problems.splice(i, 1);
await page.keyboard.press('Escape');

/* ---- dark mode ---- */
current = 'dark-mode';
await page.goto(`${WEB}/dashboard`);
await settle();
await page.getByRole('button', { name: /dark mode/ }).click();
if (!(await page.evaluate(() => document.documentElement.classList.contains('dark')))) note(current, 'dark mode did not switch on');
await page.screenshot({ path: join(shots, 'dark-dashboard.png'), fullPage: true });
await page.getByRole('button', { name: /light mode/ }).click();

/* ---- phone viewport: no horizontal overflow, menu works ---- */
await page.setViewportSize({ width: 390, height: 844 });
for (const [path] of ROUTES) {
  current = `mobile ${path}`;
  await page.goto(`${WEB}${path}`);
  await settle();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) note(current, `page is ${overflow}px wider than the screen`);
}
current = 'mobile menu';
await page.goto(`${WEB}/dashboard`);
await settle();
await page.getByRole('button', { name: 'Open menu' }).click();
await page.getByRole('link', { name: 'Vehicles' }).click();
await page.waitForURL('**/vehicles', { timeout: 15_000 }).catch(() => note(current, 'navigation from the mobile menu failed'));
await page.screenshot({ path: join(shots, 'mobile-vehicles.png') });
await page.goto(`${WEB}/dashboard`);
await settle();
await page.screenshot({ path: join(shots, 'mobile-dashboard.png'), fullPage: true });
console.log('  ✓ phone viewport checked');

/* ---- sign out ---- */
current = 'sign-out';
await page.setViewportSize({ width: 1360, height: 900 });
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForURL('**/login', { timeout: 15_000 }).catch(() => note(current, 'did not return to the sign-in page'));
// After signing out, protected pages must not be reachable.
current = 'login';
await page.goto(`${WEB}/dashboard`);
await page.waitForURL('**/login', { timeout: 15_000 }).catch(() => note('sign-out', 'dashboard is reachable after signing out'));

await browser.close();

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nAll ${ROUTES.length} routes passed on desktop and phone viewports.`);
