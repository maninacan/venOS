import { chromium } from 'playwright';

const EMAIL = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Login to new app
await page.goto('http://localhost:4200/auth', { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(6000);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

console.log('URL:', page.url());

// Get all network requests made by the app
const companies = await page.evaluate(async () => {
  try {
    const r = await fetch('http://localhost:3000/graphql', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (await (window as any).supabase?.auth?.getSession())?.data?.session?.access_token || '',
      },
      body: JSON.stringify({ query: '{ me { id email companies { id name } } }' }),
    });
    return await r.json();
  } catch(e) { return { error: String(e) }; }
});
console.log('Companies from direct API:', JSON.stringify(companies));

// Also check localStorage for auth token
const session = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (k.includes('supabase') || k.includes('auth')) {
      try { return { key: k, value: JSON.parse(localStorage.getItem(k) || '{}') }; } catch(e) {}
    }
  }
  return null;
});
console.log('Session keys found:', session ? session.key : 'none');
if (session?.value?.access_token) {
  console.log('Token found, length:', session.value.access_token.length);
}

await browser.close();
