/**
 * Captures the README screenshots from the running app, with the seeded demo
 * data, using the Google Chrome already installed on this machine.
 *
 *   npm run dev:api & npm run dev:web      (and `npm run db:seed` once)
 *   node scripts/screenshots.mjs           → docs/screenshots/*.png
 *
 * Set BASE_URL to capture another environment.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4200';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const PASSWORD = 'Demo1234!';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

/**
 * Signed-in sessions are reused per user (cookie state), so the script signs in
 * once per account and stays well under the login rate limit.
 */
const sessions = new Map();

/** A signed-in page for `email`, in the given theme and viewport. */
async function session(email, { theme = 'light', width = 1440, height = 900, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    storageState: email ? sessions.get(email) : undefined,
  });
  // The theme preference and reduced motion: screenshots shouldn't catch half-finished animations.
  await context.addInitScript((t) => localStorage.setItem('cms-theme', t), theme);
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  if (email && !sessions.has(email)) {
    const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD, remember: true } });
    if (!res.ok()) throw new Error(`Login failed for ${email}: ${res.status()}`);
  }
  return {
    page,
    context,
    close: async () => {
      if (email) sessions.set(email, await context.storageState());
      await context.close();
    },
  };
}

async function contractId(page, query) {
  const res = await page.request.get(`${BASE}/api/contracts?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
  });
  const body = await res.json();
  if (!body.items?.length) throw new Error(`No contract matches "${query}" (did you run the seed?)`);
  return body.items[0].id;
}

async function accessToken(page) {
  const res = await page.request.post(`${BASE}/api/auth/refresh`);
  return (await res.json()).accessToken;
}

async function shot(page, path, name, { wait = 'networkidle', fullPage = false, before } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState(wait);
  await page.waitForTimeout(700);
  if (before) await before(page);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
  console.log(`✓ ${name}.png`);
}

// Sign-in (no session).
{
  const { page, close } = await session(null);
  await shot(page, '/login', 'login');
  await close();
}

// Employee: dashboard, contracts, a signed contract, its PDF.
{
  const { page, close } = await session('sales@contracthub.dev');
  await shot(page, '/', 'dashboard');
  await shot(page, '/contracts', 'contracts');
  const signed = await contractId(page, 'Fabrikam sales training');
  await shot(page, `/contracts/${signed}`, 'contract-signed');
  await shot(page, `/contracts/${signed}?tab=signatures`, 'contract-signatures');
  const review = await contractId(page, 'Northwind distribution');
  await shot(page, `/contracts/${review}?tab=approvals`, 'contract-approvals');
  const rejected = await contractId(page, 'Contoso data processing');
  await shot(page, `/contracts/${rejected}`, 'contract-rejected');
  await close();
}

// Legal: the approvals queue and the audit log.
{
  const { page, close } = await session('legal@contracthub.dev');
  await shot(page, '/approvals', 'approvals-queue');
  await close();
}

// Admin: administration screens.
{
  const { page, close } = await session('admin@contracthub.dev');
  await shot(page, '/admin/people', 'admin-people');
  await shot(page, '/admin/policies', 'admin-policies');
  await shot(page, '/admin/emails', 'admin-emails');
  await shot(page, '/admin/audit', 'admin-audit');
  await close();
}

// Dark mode.
{
  const { page, close } = await session('sales@contracthub.dev', { theme: 'dark' });
  await shot(page, '/', 'dashboard-dark');
  const signed = await contractId(page, 'Fabrikam sales training');
  await shot(page, `/contracts/${signed}`, 'contract-signed-dark');
  await close();
}

// Phone.
{
  const { page, close } = await session('sales@contracthub.dev', { width: 390, height: 844, mobile: true });
  await shot(page, '/contracts', 'mobile-contracts');
  await close();
}

await browser.close();
