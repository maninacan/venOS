import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('./scripts/screenshots/new-app', { recursive: true });

const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:4200/auth', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: './scripts/screenshots/new-app/login-updated.png', fullPage: false });
console.log('📸 login-updated.png');
await browser.close();
