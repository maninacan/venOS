import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

console.log('URL:', page.url());
console.log('Errors:', JSON.stringify(errors, null, 2));
console.log('Body visible text:', await page.locator('body').innerText().catch(() => ''));

await browser.close();
