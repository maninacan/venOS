import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/new-app/nav-${String(++n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`📸 ${f}  [${page.url()}]`);
};

// Login
await page.goto('http://localhost:4200/auth', { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await shot('companies');

// Check what companies are available
const companyLinks = await page.$$eval('a[href*="/companies/"]', links => links.map(l => l.href));
console.log('Company links:', companyLinks);

// Click first company
const firstCompany = page.locator('a[href*="/companies/"]').first();
if (await firstCompany.count()) {
  const href = await firstCompany.getAttribute('href');
  console.log('Navigating to:', href);
  await firstCompany.click();
  await page.waitForTimeout(3000);
  await shot('company-events');
  await shot('nav-with-add-event');
}

await page.waitForTimeout(3000);
await browser.close();
