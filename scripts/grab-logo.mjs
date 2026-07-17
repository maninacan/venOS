import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://venview.io/app', { waitUntil: 'networkidle', timeout: 15000 });

// Find logo image
const logoInfo = await page.evaluate(() => {
  // Look for img tags near nav/header
  const imgs = [...document.querySelectorAll('img')];
  const logoImg = imgs.find(i => i.src.includes('logo') || i.alt?.toLowerCase().includes('logo') || i.closest('nav, header, #navbar') !== null);
  
  // Also look for all images
  return {
    allImgs: imgs.map(i => ({ src: i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight })),
    logoImg: logoImg ? { src: logoImg.src, alt: logoImg.alt } : null,
  };
});

console.log('Logo:', JSON.stringify(logoInfo.logoImg));
console.log('All images:', JSON.stringify(logoInfo.allImgs, null, 2));

await browser.close();
