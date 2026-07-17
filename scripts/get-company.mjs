import { chromium } from 'playwright';

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://localhost:4200/auth', { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);

console.log('URL:', page.url());

// Try GraphQL query
const result = await page.evaluate(async () => {
  try {
    const r = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ me { companies { id name } } }' }),
    });
    return await r.json();
  } catch(e) { return { error: e.message }; }
});
console.log('GraphQL result:', JSON.stringify(result));

await browser.close();
