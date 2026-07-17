/**
 * End-to-end comparison: venview.io (old) vs localhost:4200 (new)
 *
 * Lessons learned:
 * - Old app URL stays at /auth even after login — navigate explicitly
 * - New app shows skeleton cards on /companies before data loads — wait for real cards
 * - WelcomeModal in new app shows "I'll explore on my own"; old app shows same after scroll
 * - Use locator().or() for multi-condition waits, not comma-separated text= selectors
 * - Wait for URL to include event UUID (not just networkidle) after event form submit
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const TODAY      = new Date().toISOString().slice(0, 10);
const EVENT_NAME = `Playwright Comparison ${TODAY}`;
const SALES      = { grossSales: '800', refunds: '40', discounts: '20', totalCollected: '740' };
const LABOR      = { name: 'Test Worker', hours: '4', wage: '15' }; // 4h × $15 = $60
const EXPENSES   = {
  healthDeptFee:  '50',  eventFee:        '100',
  mileage:        '15',  mileageRate:     '0.67',
  coordinatorFee: '0',   posFee:          '0',
  employeeBonus:  '0',   eventRunnerFees: '0',
};
const EMAIL    = 'jon.r.aaron@gmail.com';
const PASSWORD = '11!!FUNinthesun';

mkdirSync('./scripts/screenshots', { recursive: true });
let ss = 0;
async function shot(page, label) {
  const n = String(++ss).padStart(2, '0');
  const f = `./scripts/screenshots/${n}-${label}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`    📸 ${n}-${label}.png  [${page.url().replace(/^https?:\/\/[^/]+/, '')}]`);
  return f;
}

// Shared: run event creation + sales + expenses + profit summary
// Called either from the normal company-click flow OR from the modal "Create First Event" shortcut
async function runEventFlow(page, companyId, baseUrl, pfx) {
  // ── 4. Create event ─────────────────────────────────────────────────────────
  console.log('④ Create event');
  await page.goto(`${baseUrl}/companies/${companyId}/events/new`,
    { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('input', { timeout: 8000 });
  await shot(page, `${pfx}-05-event-form`);
  return runFromEventForm(page, pfx);
}

async function continueFromEventsNew(page, pfx) {
  // Already on events/new — just need to fill form
  console.log('④ Create event (already on form)');
  // Use type-specific selector: old app has type=text/date inputs for the form;
  // hidden auth form uses type=email/password which we want to avoid.
  await page.waitForSelector(
    'input[type="text"], input[type="date"], input:not([type])',
    { timeout: 10000 }
  );
  await shot(page, `${pfx}-05-event-form`);
  return runFromEventForm(page, pfx);
}

async function runFromEventForm(page, pfx) {
  // Fill Event Name (case-insensitive hasText matches both "Event name" and "Event Name")
  await fill(page, 'Event Name', EVENT_NAME);

  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.count()) await dateInput.fill(TODAY);

  // Old-app extra required fields (Venue name, ZIP code)
  const hasVenue = await page.locator('label').filter({ hasText: /Venue/i }).count();
  if (hasVenue) {
    await fill(page, 'Venue name', 'Test Venue');
  }
  const hasZip = await page.locator('label').filter({ hasText: /ZIP/i }).count();
  if (hasZip) {
    const zipLbl = page.locator('label').filter({ hasText: /ZIP/i }).first();
    const zipId  = await zipLbl.getAttribute('for').catch(() => null);
    const zipInp = zipId
      ? page.locator(`[id="${zipId}"]`)
      : zipLbl.locator('~ input').first().or(zipLbl.locator('..').locator('input').first());
    const existing = await zipInp.inputValue().catch(() => '');
    if (!existing.trim()) await zipInp.fill('10001');
  }

  await shot(page, `${pfx}-06-form-filled`);

  // Submit — use JS click to avoid DOM-order ambiguity between "Create event"
  // and "Create & add details" (both present in old app; comma-selector picks first in DOM)
  const [navResult] = await Promise.allSettled([
    page.waitForURL(url => {
      const m = url.match(/\/events\/([^/?#]+)/);
      return !!(m && m[1] !== 'new' && m[1].length > 4);
    }, { timeout: 20000 }),
    page.evaluate(() => {
      // Prefer "Create event" exactly, fall back to any Create Event / submit
      const all = [...document.querySelectorAll('button')];
      const btn =
        all.find(b => b.textContent.trim() === 'Create event') ||
        all.find(b => /create event/i.test(b.textContent.trim())) ||
        document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    }),
  ]);
  if (navResult.status === 'rejected') await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await shot(page, `${pfx}-07-post-submit`);
  console.log(`    URL: ${page.url()}`);

  let eventId = page.url().match(/\/events\/([^/?#]+)/)?.[1];

  // Old app: navigates to Manage Events (/companies) after creation instead of event detail
  if (!eventId || eventId === 'new') {
    const manageEventsVisible = await page.locator(
      'h1:has-text("Manage Events"), h2:has-text("Manage Events")'
    ).count() > 0;

    if (manageEventsVisible) {
      console.log('    Old app: on Manage Events after creation — opening event from list');
      // Show events table
      await page.locator('button:has-text("List All"), a:has-text("List All")').first()
        .click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await shot(page, `${pfx}-07b-events-list`);

      // Extract the event detail href from the DOM — the table row may have an <a> tag
      const eventHref = await page.evaluate((eName) => {
        // Find any <a> containing the event name
        const links = [...document.querySelectorAll('a')];
        const link = links.find(a => a.textContent.trim().includes(eName));
        if (link && link.href) return link.href;
        // Fall back: look in td cells
        const cells = [...document.querySelectorAll('td')];
        const cell = cells.find(c => c.textContent.trim().includes(eName));
        if (cell) {
          const a = cell.querySelector('a') || cell.closest('tr')?.querySelector('a');
          if (a && a.href) return a.href;
          // Check data attributes on the row
          const row = cell.closest('tr');
          if (row) return row.dataset['href'] || row.getAttribute('data-href') || null;
        }
        return null;
      }, EVENT_NAME);

      console.log(`    Event href: ${eventHref}`);
      if (eventHref && /^https?:\/\//.test(eventHref)) {
        await page.goto(eventHref, { waitUntil: 'networkidle', timeout: 15000 });
      } else {
        // Try force-clicking the row
        await page.evaluate((eName) => {
          const cells = [...document.querySelectorAll('td')];
          const cell = cells.find(c => c.textContent.includes(eName));
          const el = cell?.closest('tr') || cell;
          if (el) el.click();
        }, EVENT_NAME);
        await page.waitForTimeout(1500);
      }
      await shot(page, `${pfx}-07c-event-detail`);
      console.log(`    URL after event nav: ${page.url()}`);
      eventId = page.url().match(/\/events\/([^/?#]+)/)?.[1];
    }
  }

  if (!eventId || eventId === 'new') {
    // Old app may render event detail inline without a URL change — detect by content
    const onEventDetail = await page.locator([
      'button:has-text("Manual Sales")',
      'button:has-text("Expenses")',
      `h2:has-text("${EVENT_NAME}")`,
      `h3:has-text("${EVENT_NAME}")`,
    ].join(', ')).count() > 0;
    if (onEventDetail) {
      console.log('    Event detail detected by content (URL unchanged — old app inline view)');
      eventId = 'old-app-inline'; // sentinel; URL won't change on this app
    } else {
      throw new Error(`Event not created. URL: ${page.url()}`);
    }
  }

  // ── 5. Sales ────────────────────────────────────────────────────────────────
  console.log('⑤ Sales');
  await openSection(page, 'Manual Sales');
  await page.waitForTimeout(500);
  await fill(page, 'Gross Sales',     SALES.grossSales);
  await fill(page, 'Refunds',         SALES.refunds);
  await fill(page, 'Discounts',       SALES.discounts);
  await fill(page, 'Total Collected', SALES.totalCollected);
  await clickBtn(page, 'Save Sales', '💾 Save Sales');
  // Brief pause so the mutation fires and loading state begins BEFORE networkidle check.
  // Without this, networkidle might snapshot "0 connections" in the synchronous gap
  // between the click and the fetch starting.
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => page.waitForTimeout(3000));
  await page.waitForTimeout(600);
  await shot(page, `${pfx}-08-sales`);

  // ── 6. Labor ─────────────────────────────────────────────────────────────────
  console.log('⑥ Labor');
  await openSection(page, 'Labor');
  await page.waitForTimeout(600);
  // Old app: click "Add Worker" to insert an editable row
  await clickBtn(page, '➕ Add Worker', 'Add Worker');
  await page.waitForTimeout(800);
  // Fill by label first (new app), then by anonymous input position (old app)
  const lNameOk  = await fill(page, 'Name', LABOR.name, true);
  const lHrsOk   = await fill(page, 'Hours', LABOR.hours, true);
  const lWageOk  = await fill(page, 'Wage/hr', LABOR.wage, true)
                || await fill(page, 'Wage', LABOR.wage, true);
  if (!lNameOk || !lHrsOk || !lWageOk) {
    // Old app: labor row uses anonymous inputs (no id/name/placeholder)
    const anonResult = await page.evaluate(
      ({ labor, needName, needHrs, needWage }) => {
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const dispatch = (inp, val) => {
          nativeSet.call(inp, val);
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const vis = i => i.getBoundingClientRect().width > 0;
        // Use JS falsy check (!id) so inputs with id="" are also included
        const isAnon = i => !i.id && !i.name && !i.placeholder;
        const anonText = [...document.querySelectorAll('input[type="text"]')].filter(i => isAnon(i) && vis(i));
        const anonNum  = [...document.querySelectorAll('input[type="number"]')].filter(i => isAnon(i) && vis(i));
        if (needName && anonText.length)     dispatch(anonText[0], labor.name);
        if (needHrs  && anonNum.length > 0)  dispatch(anonNum[0],  labor.hours);
        if (needWage && anonNum.length > 1)  dispatch(anonNum[1],  labor.wage);
      },
      { labor: LABOR, needName: !lNameOk, needHrs: !lHrsOk, needWage: !lWageOk }
    );
  }
  // Save: new app "+ Add Shift"; old app "💾 Save Labor"
  const laborSaved = await page.evaluate(() => {
    const allBtns = [...document.querySelectorAll('button')];
    const btn =
      allBtns.find(b => /save.*labor/i.test(b.textContent)) ||
      allBtns.find(b => b.textContent.trim() === '+ Add Shift');
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  console.log('    Labor save:', laborSaved || 'NOT FOUND');
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => page.waitForTimeout(3000));
  await page.waitForTimeout(600);
  await shot(page, `${pfx}-08b-labor`);

  // ── 7. Expenses ─────────────────────────────────────────────────────────────
  console.log('⑦ Expenses');
  await openSection(page, 'Expenses');
  await page.waitForTimeout(500);
  // Old app shows expenses as read-only summary — click "Edit Expenses" to enter edit mode
  const editExpBtn = page.locator('button:has-text("Edit Expenses")').first();
  if (await editExpBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await editExpBtn.click();
    await page.waitForTimeout(800);
  }
  await fill(page, 'Health Dept Fee',    EXPENSES.healthDeptFee);
  await fill(page, 'Event Fee',          EXPENSES.eventFee);
  // New app: separate "Mileage (miles)" + "Mileage Rate" fields
  // Old app: single "Mileage Reimbursement" dollar-amount field
  const milesOk = await fill(page, 'Mileage (miles)', EXPENSES.mileage, true);
  if (milesOk) {
    await fill(page, 'Mileage Rate', EXPENSES.mileageRate);
  } else {
    const mileageDollars = (parseFloat(EXPENSES.mileage) * parseFloat(EXPENSES.mileageRate)).toFixed(2);
    await fill(page, 'Mileage Reimbursement', mileageDollars);
  }
  await fill(page, 'Coordinator Fee',   EXPENSES.coordinatorFee);
  // New app: "Manual POS Fee"; old app: "POS Fees"
  const posOk = await fill(page, 'Manual POS Fee', EXPENSES.posFee, true);
  if (!posOk) await fill(page, 'POS Fees', EXPENSES.posFee);
  await fill(page, 'Employee Bonus',    EXPENSES.employeeBonus);
  await fill(page, 'Event Runner Fees', EXPENSES.eventRunnerFees);
  // Old app: "💾 Save" (no suffix). New app: "💾 Save Expenses". Try both via JS.
  const expSaveResult = await page.evaluate(() => {
    const allBtns = [...document.querySelectorAll('button')];
    const saveBtn =
      allBtns.find(b => /save.*expense/i.test(b.textContent)) ||   // new app
      allBtns.find(b => b.textContent.trim() === '💾 Save');        // old app exact match
    if (saveBtn) { saveBtn.click(); return saveBtn.textContent.trim(); }
    return null;
  });
  console.log('    Save Expenses JS result:', expSaveResult || 'NOT FOUND');
  await shot(page, `${pfx}-09a-expenses-before-save`);
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => page.waitForTimeout(3000));
  await page.waitForTimeout(600);
  await shot(page, `${pfx}-09-expenses`);

  // ── 8. Profit summary ────────────────────────────────────────────────────────
  console.log('⑧ Profit summary');
  // Old app: event detail lives at /companies (no URL routing) — reload loses the
  // event context and returns to the Manage Events dashboard. Skip reload for old app.
  if (eventId !== 'old-app-inline') {
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
  } else {
    await page.waitForTimeout(800);
  }
  // Old app section is "Event Profit Summary"; new app uses "Profit Summary"
  await openSection(page, 'Profit Summary');
  await openSection(page, 'Event Profit Summary');
  await page.waitForTimeout(800);
  await shot(page, `${pfx}-10-profit-summary`);

  const summary = await extractSummary(page);
  console.log('    Values:');
  for (const [k, v] of Object.entries(summary)) console.log(`      ${k}: ${v}`);
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────
async function runApp(browser, appName, baseUrl) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${appName}  ·  ${baseUrl}`);
  console.log(`${'═'.repeat(64)}`);

  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pfx  = appName.replace(/\s+/g, '-').toLowerCase();

  try {
    // ── 1. Login ─────────────────────────────────────────────────────────────
    console.log('① Login');
    await page.goto(`${baseUrl}/auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('input[type="email"]', { timeout: 30000 });
    await shot(page, `${pfx}-01-login`);

    await page.fill('input[type="email"]',    EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for any post-login indicator using .or() chaining (text= works with .or())
    await page.locator('text=Welcome to VenView')
      .or(page.locator('text=Welcome back'))
      .or(page.locator('text=Manage Events'))
      .or(page.locator('button:has-text("Logout")'))
      .or(page.locator('a:has-text("Logout")'))
      .first().waitFor({ timeout: 25000 });

    await page.waitForTimeout(1000);
    await shot(page, `${pfx}-02-post-login`);
    console.log(`    URL: ${page.url()}`);

    // ── 2. Dismiss WelcomeModal if visible ───────────────────────────────────
    console.log('② Dismiss modal');
    const dismissed = await page.locator("button:has-text(\"I'll explore\")")
      .or(page.locator('button:has-text("Maybe later")'))
      .or(page.locator('button:has-text("No thanks")'))
      .first()
      .click({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    console.log(`    modal dismiss: ${dismissed ? 'yes' : 'no modal found'}`);
    if (dismissed) await page.waitForTimeout(800);

    // ── 3. Navigate to companies / events page ────────────────────────────────
    console.log('③ Navigate to events page');
    await page.goto(`${baseUrl}/companies`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);

    // Dismiss any modal that appeared after navigation
    await page.locator("button:has-text(\"I'll explore\")")
      .or(page.locator('button:has-text("Maybe later")'))
      .or(page.locator('button:has-text("No thanks")'))
      .first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    // Also try WelcomeModal "Create Your First Event" with force click
    {
      const cfBtn = page.locator('button:has-text("Create Your First Event")');
      if (await cfBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log('    WelcomeModal present — force-clicking "Create Your First Event"');
        await cfBtn.click({ force: true });
        await page.waitForTimeout(2000);

        const cidFromModal = page.url().match(/\/companies\/([a-zA-Z0-9_-]{6,})/)?.[1];
        // Old app: form opens inline (URL stays at /companies), detect by form content
        const formAlreadyOpen = await page.locator(
          'label:has-text("Event name"), h1:has-text("Add an event"), label:has-text("Venue name")'
        ).count() > 0;

        if (cidFromModal || formAlreadyOpen) {
          console.log(`    Form open (cid=${cidFromModal || 'none'}, formDetected=${formAlreadyOpen})`);
          await shot(page, `${pfx}-03-events-page`);
          const summary = await continueFromEventsNew(page, pfx);
          await ctx.close();
          return { appName, summary, error: null };
        }
        // Click had no effect — dismiss and proceed normally
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    await shot(page, `${pfx}-03-events-page`);

    // ── Detect app layout ─────────────────────────────────────────────────────
    // Old app  → shows "Manage Events" heading (single-company view, no card grid)
    // New app  → shows company card grid (role="button" divs with text)
    const manageEventsEl = await page.locator(
      'h1:has-text("Manage Events"), h2:has-text("Manage Events"), h3:has-text("Manage Events")'
    ).count();
    const isOldStyleApp = manageEventsEl > 0;
    console.log(`    manageEvents: ${manageEventsEl}, oldStyle: ${isOldStyleApp}`);

    if (isOldStyleApp) {
      // ── OLD APP PATH ────────────────────────────────────────────────────────
      // Already on events management page — click "Add Event" directly
      console.log('    Old-app layout — clicking Add Event');
      const addEvtBtn = page.locator(
        'button:has-text("Add Your First Event"), a:has-text("Add Event"), button:has-text("Add Event")'
      ).first();
      await addEvtBtn.click({ timeout: 6000 });
      await page.waitForSelector('input', { timeout: 8000 });
      await shot(page, `${pfx}-04-event-form`);

      const summary = await continueFromEventsNew(page, pfx);
      await ctx.close();
      return { appName, summary, error: null };
    }

    // ── NEW APP PATH ──────────────────────────────────────────────────────────
    // Wait for real company cards to finish loading
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('[role="button"]:not(a)')];
      return cards.some(b => (b.innerText || '').trim().length > 4);
    }, { timeout: 12000 });

    const realCard = page.locator('[role="button"]:not(a)').filter({ hasText: /\S{4,}/ }).first();
    await realCard.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await shot(page, `${pfx}-04-events-list`);
    console.log(`    URL: ${page.url()}`);

    const companyId = page.url().match(/\/companies\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!companyId) throw new Error(`No companyId in URL: ${page.url()}`);
    console.log(`    Company: ${companyId}`);

    const summary = await runEventFlow(page, companyId, baseUrl, pfx);
    await ctx.close();
    return { appName, summary, error: null };

  } catch (err) {
    console.error(`    ❌ ERROR: ${String(err.message || err).slice(0, 300)}`);
    await shot(page, `${pfx}-ERROR`).catch(() => {});
    await ctx.close();
    return { appName, summary: {}, error: String(err.message || err).slice(0, 400) };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function openSection(page, hint) {
  const btn = page.locator(`button:has-text("${hint}")`).first();
  try {
    if (await btn.isVisible({ timeout: 3000 })) {
      const exp = await btn.getAttribute('aria-expanded').catch(() => null);
      if (exp !== 'true') { await btn.click(); await page.waitForTimeout(500); }
    }
  } catch { /* not found */ }
}

async function fill(page, labelText, value, silent = false) {
  const lbl = page.locator('label').filter({ hasText: labelText }).first();
  if (!await lbl.count()) {
    const partial = labelText.split(' ').slice(0, 2).join(' ');
    const pLbl = page.locator('label').filter({ hasText: partial }).first();
    if (await pLbl.count()) return fillNear(page, pLbl, value);
    if (!silent) console.log(`    ⚠  label not found: "${labelText}"`);
    return false;
  }
  return fillNear(page, lbl, value);
}

async function fillNear(page, labelLoc, value) {
  const forAttr = await labelLoc.getAttribute('for').catch(() => null);
  if (forAttr) {
    const inp = page.locator(`[id="${forAttr}"]`).first();
    if (await inp.count()) { await inp.fill(''); await inp.fill(value); return true; }
  }
  const sib = labelLoc.locator('~ input').first();
  if (await sib.count()) { await sib.fill(''); await sib.fill(value); return true; }
  const par = labelLoc.locator('..').locator('input').first();
  if (await par.count()) { await par.fill(''); await par.fill(value); return true; }
  return false;
}

async function clickBtn(page, ...texts) {
  for (const t of texts) {
    const btn = page.locator(`button:has-text("${t}")`).first();
    try { if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); return; } }
    catch { /* try next */ }
  }
}

async function extractSummary(page) {
  const pairs = await page.evaluate(() => {
    const res = [];
    const seen = new Set();
    function walk(el) {
      if (seen.has(el) || !el.tagName || ['SCRIPT','STYLE','HEAD'].includes(el.tagName)) return;
      seen.add(el);
      const kids = [...el.children];
      if (kids.length >= 2) {
        const texts = kids.map(k => (k.innerText || '').trim());
        const last  = texts[texts.length - 1];
        if (last.match(/^-?\$[\d,.]+$/) && texts[0].length > 1 && texts[0].length < 80) {
          res.push([texts.slice(0, -1).join(' ').trim(), last]);
          return;
        }
      }
      for (const k of kids) walk(k);
    }
    walk(document.body);
    return res;
  });

  const result = {};
  for (const [k, v] of pairs) if (k && v && !result[k]) result[k] = v;

  if (Object.keys(result).length < 3) {
    const lines = await page.evaluate(() =>
      document.body.innerText.split('\n').map(l => l.trim()).filter(Boolean)
    );
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i + 1]?.match(/^-?\$[\d,.]+$/)) { result[lines[i]] = lines[i + 1]; i++; }
    }
  }

  const KEEP = ['Gross Sales','Returns','Refunds','Discounts','Net Sales','COGS',
    'Ingredient','Gross Profit','Health Dept','Event Fee','Mileage','Coordinator',
    'POS Fee','Labor','Employee Bonus','Event Runner','Additional Fee',
    'Total Operating','Net Profit'];
  const filtered = Object.fromEntries(
    Object.entries(result).filter(([k]) => KEEP.some(kw => k.toLowerCase().includes(kw.toLowerCase())))
  );
  return Object.keys(filtered).length > 0 ? filtered : result;
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const oldResult = await runApp(browser, 'OLD APP', 'https://venview.io');
  const newResult = await runApp(browser, 'NEW APP', 'http://localhost:4200');
  await browser.close();

  console.log(`\n${'═'.repeat(70)}`);
  console.log('  COMPUTATION COMPARISON');
  console.log(`${'═'.repeat(70)}`);

  if (oldResult.error) console.log(`\n⚠  OLD APP error:\n   ${oldResult.error}`);
  if (newResult.error) console.log(`\n⚠  NEW APP error:\n   ${newResult.error}`);

  const mileage   = (15 * 0.67).toFixed(2);
  const laborAmt  = (4 * 15).toFixed(2);
  const totalExp  = (50 + 100 + 15 * 0.67 + 4 * 15).toFixed(2);
  const netProfit = (740 - 50 - 100 - 15 * 0.67 - 4 * 15).toFixed(2);
  console.log(`
Inputs: Gross $800 · Refunds $40 · Discounts $20
        Health Dept $50 · Event Fee $100 · Mileage 15mi×$0.67=$${mileage} · Labor 4h×$15=$${laborAmt}
Expected: Net Sales $740 | Total Expenses $${totalExp} | Net Profit $${netProfit}
`);

  const allKeys = [...new Set([
    ...Object.keys(oldResult.summary),
    ...Object.keys(newResult.summary),
  ])];

  if (!allKeys.length) {
    console.log('⚠  No values extracted. Review screenshots.\n');
  } else {
    const W  = Math.max(38, ...allKeys.map(k => k.length + 2));
    const HR = '─'.repeat(W + 44);
    console.log(`┌${HR}┐`);
    console.log(`│ ${'Field'.padEnd(W)} │ ${'Old App'.padEnd(18)} │ ${'New App'.padEnd(18)} │ Match │`);
    console.log(`├${HR}┤`);
    const mismatches = [];
    for (const k of allKeys) {
      const o = oldResult.summary[k] ?? '—';
      const n = newResult.summary[k] ?? '—';
      const both = o !== '—' && n !== '—';
      const ok   = o === n;
      if (both && !ok) mismatches.push(k);
      const icon = !both ? '  ?  ' : ok ? '  ✓  ' : '  ✗  ';
      console.log(`│ ${k.padEnd(W)} │ ${o.padEnd(18)} │ ${n.padEnd(18)} │ ${icon} │`);
    }
    console.log(`└${HR}┘`);
    console.log(mismatches.length === 0
      ? '\n✅  All values present in both apps match!'
      : `\n⚠   ${mismatches.length} mismatch(es): ${mismatches.join(', ')}`);
  }

  writeFileSync('./scripts/comparison-report.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    inputs: { ...SALES, ...EXPENSES },
    expected: { netSales: 740, totalExpenses: +totalExp, netProfit: +netProfit },
    oldApp: oldResult, newApp: newResult,
  }, null, 2));
  console.log('\n📄 scripts/comparison-report.json');
  console.log('📸 scripts/screenshots/');
})();
