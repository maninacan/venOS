import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/new-app/final-${String(++n).padStart(2,'0')}-${label}.png`;
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

// Dismiss welcome modal
await page.evaluate(() => {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.style.display = 'none';
});
await page.waitForTimeout(500);

await shot('companies-clean');

// Click into first real company
const companyCard = page.locator('[class*="company"], h3, h2').filter({ hasText: /food|catering|event|co\./i }).first();
const anyCompanyLink = page.locator('a[href*="/companies/"]').filter({ hasNot: page.locator('[href$="/new"]') }).first();

if (await anyCompanyLink.count()) {
  const href = await anyCompanyLink.getAttribute('href');
  console.log('Clicking company:', href);
  await anyCompanyLink.click();
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await shot('company-events-nav');
  
  // Dismiss modal if shown again
  await page.evaluate(() => {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.style.display = 'none';
  });
  await page.waitForTimeout(500);
  await shot('events-page');
}

await browser.close();
