import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/new-app/${String(++n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`📸 ${f}  [${page.url()}]`);
};

// Login to new app
await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle' });
await shot('login');

await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await shot('after-login');

// Dismiss any welcome modal
const dismiss = page.locator('button').filter({ hasText: /explore|dismiss|skip|close|my own/i }).first();
if (await dismiss.count()) {
  await dismiss.click();
  await page.waitForTimeout(500);
}
await shot('companies');

// Click into first company
const companyCard = page.locator('a[href*="/companies/"], [class*="company"]').first();
if (await companyCard.count()) {
  await companyCard.click();
  await page.waitForTimeout(2000);
  await shot('company-detail');
  
  // Click into events
  const eventsLink = page.locator('a[href*="/events"], a').filter({ hasText: /events/i }).first();
  if (await eventsLink.count()) {
    await eventsLink.click();
    await page.waitForTimeout(1500);
    await shot('events-list');
  }
}

await browser.close();
