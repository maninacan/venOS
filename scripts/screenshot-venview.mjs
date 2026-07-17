import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('./scripts/screenshots/venview-theme', { recursive: true });

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';
const BASE = 'https://venview.io';

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let n = 0;
const shot = async (label) => {
  const f = `./scripts/screenshots/venview-theme/${String(++n).padStart(2,'0')}-${label}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`📸 ${f}`);
};

// Login
await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
await shot('login-page');

await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await shot('login-filled');
await page.click('button[type="submit"]');
// Wait for redirect after login — old app may land on /companies or /app
await page.waitForTimeout(3000);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await shot('after-login');
console.log('URL after login:', page.url());

// Dismiss welcome modal if open
await page.evaluate(() => {
  const overlay = document.getElementById('welcomeOverlay');
  if (overlay) overlay.style.display = 'none';
  // Also try clicking any "explore on my own" type buttons
  const btns = [...document.querySelectorAll('button')];
  const close = btns.find(b => /explore|close|dismiss|skip|got it/i.test(b.textContent));
  if (close) close.click();
});
await page.waitForTimeout(500);

// Scroll down on companies page
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(500);
await shot('companies-scrolled');
await page.evaluate(() => window.scrollTo(0, 0));

// Screenshot logo/nav area closely — full-width top section
await shot('nav-top');

// Click Manage Events if available
const manageBtn = page.locator('button, a').filter({ hasText: /manage event/i }).first();
if (await manageBtn.count()) {
  await manageBtn.click();
  await page.waitForTimeout(2000);
  await shot('events-list');
}

// Click into a specific event if visible
const eventRow = page.locator('tr, li').filter({ hasText: /playwright|event/i }).first();
if (await eventRow.count()) {
  await eventRow.click();
  await page.waitForTimeout(2000);
  await shot('event-detail');
}

// Check fonts and colors on page
const styles = await page.evaluate(() => {
  const body = document.body;
  const nav = document.querySelector('nav, header, [class*="sidebar"], [class*="nav"]');
  const btn = document.querySelector('button');
  const computed = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      color: s.color,
      background: s.backgroundColor,
    };
  };
  return {
    body: computed(body),
    nav: computed(nav),
    btn: computed(btn),
    title: document.title,
  };
});
console.log('Page styles:', JSON.stringify(styles, null, 2));

await browser.close();
