import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/new-app/fin-${String(++n).padStart(2,'0')}-${label}.png`;
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

// Dismiss any modal
await page.evaluate(() => {
  document.querySelectorAll('.modal-overlay').forEach(o => { o.style.display = 'none'; });
});
await page.waitForTimeout(500);

// Find all links on the companies page
const links = await page.$$eval('a', ls => ls.map(l => ({ href: l.href, text: l.textContent.trim().slice(0,50) })));
console.log('All links:', JSON.stringify(links.slice(0, 15)));

// Find company card (not /new)
const companyUrl = links.find(l => l.href.includes('/companies/') && !l.href.endsWith('/new') && !l.href.endsWith('/companies/'));
console.log('Company link found:', companyUrl);

if (companyUrl) {
  await page.goto(companyUrl.href + '/events', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  // Dismiss modal again
  await page.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(o => { o.style.display = 'none'; });
  });
  await shot('events-with-nav');
} else {
  await shot('companies-no-company');
}

await browser.close();
