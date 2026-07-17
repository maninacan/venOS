import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/new-app/fin2-${String(++n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`📸 ${f}  [${page.url()}]`);
};

await page.goto('http://localhost:4200/auth', { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);

// Dismiss modal and find company card
await page.evaluate(() => {
  document.querySelectorAll('.modal-overlay').forEach(o => { o.style.display = 'none'; });
});
await page.waitForTimeout(500);

// Find all clickable elements on companies page
const elements = await page.$$eval('[class*="company"], [class*="card"], h2, h3', els => 
  els.map(e => ({ tag: e.tagName, class: e.className.slice(0,60), text: e.textContent.trim().slice(0,40) }))
);
console.log('Company elements:', JSON.stringify(elements));

// Click on company name text
const companyText = page.locator('text=Lemon Drip Food Co.').first();
if (await companyText.count()) {
  console.log('Found company card by text');
  await companyText.click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(o => { o.style.display = 'none'; }); });
  await shot('events-with-nav');
}

await browser.close();
