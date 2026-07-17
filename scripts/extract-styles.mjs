import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://venview.io/app', { waitUntil: 'networkidle', timeout: 15000 });

const styles = await page.evaluate(() => {
  // Get CSS variables
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const cssVars = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const text = rule.cssText || '';
        const matches = text.matchAll(/--[\w-]+:\s*[^;]+/g);
        for (const m of matches) {
          const [key, ...vals] = m[0].split(':');
          cssVars[key.trim()] = vals.join(':').trim();
        }
      }
    } catch(e) {}
  }
  
  // Key element styles
  const nav = document.querySelector('#navbar, nav, header');
  const btn = document.querySelector('.btn-add, button[class*="add"], button[class*="primary"]');
  const h1 = document.querySelector('h1, h2');
  const profit = document.querySelector('[class*="profit"], [id*="profit"]');
  
  const s = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor, font: cs.fontFamily, fontSize: cs.fontSize };
  };

  return {
    cssVars,
    nav: s(nav),
    btn: s(btn),
    h1: s(h1),
    bodyFont: getComputedStyle(document.body).fontFamily,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});

console.log(JSON.stringify(styles, null, 2));
await browser.close();
