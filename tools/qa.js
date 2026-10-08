// End-to-end QA for the Sumify static site (served locally on :8787).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:8787';
const OUT = process.env.SHOTS_DIR || path.join(__dirname, '.shots');
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROOT = path.resolve(__dirname, '..', 'public');

let failures = 0, passes = 0;
function check(cond, msg) { if (cond) { passes++; console.log('  ✓', msg); } else { failures++; console.log('  ✗ FAIL:', msg); } }

const PAGES = ['/', '/catch-up-bookkeeping', '/thank-you', '/privacy', '/nope-404'];
const VIEWPORTS = [[375, 812], [390, 844], [768, 1024], [1440, 900]];

const configWithIds = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8')
  .replace('ga4MeasurementId: ""', 'ga4MeasurementId: "G-TEST123"')
  .replace('googleAdsId: ""', 'googleAdsId: "AW-111"')
  .replace('googleAdsBookingLabel: ""', 'googleAdsBookingLabel: "LBL"');

const FAKE_CALENDLY = `window.Calendly = { initPopupWidget: function (o) { window.__popupUrl = o.url; } };`;

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York', ...opts });
  await ctx.route('https://www.googletagmanager.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '/* gtag stub */' }));
  await ctx.route('https://connect.facebook.net/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  return ctx;
}
async function withIds(ctx) {
  await ctx.route(/\/assets\/js\/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: configWithIds }));
}
async function withFakeCalendly(ctx) {
  await ctx.route('https://assets.calendly.com/**/widget.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_CALENDLY }));
  await ctx.route('https://assets.calendly.com/**/widget.css', r => r.fulfill({ contentType: 'text/css', body: '' }));
}
const dl = page => page.evaluate(() => (window.dataLayer || []).map(e => {
  if (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) return Array.from(e);
  return e;
}));
const events = (layer, name) => layer.filter(e => e && e.event === name);
const conversions = layer => layer.filter(e => Array.isArray(e) && e[0] === 'event' && e[1] === 'conversion');

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Rendering, overflow, console errors, assets, axe ----------
  console.log('\n[1] Rendering at 375/390/768/1440, console errors, overflow, missing assets');
  for (const [w, h] of VIEWPORTS) {
    const ctx = await newCtx(browser, { viewport: { width: w, height: h } });
    for (const p of PAGES) {
      const page = await ctx.newPage();
      const errors = [], bad = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !(p === '/nope-404' && /404/.test(m.text()))) errors.push(m.text()); });
      page.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes('nope-404')) bad.push(r.status() + ' ' + r.url()); });
      await page.goto(BASE + p, { waitUntil: 'networkidle' });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(ov <= 0, `${p} @${w}px: no horizontal overflow (${ov}px)`);
      check(errors.length === 0, `${p} @${w}px: no JS/console errors ${errors.join(' | ')}`);
      check(bad.length === 0, `${p} @${w}px: no missing assets ${bad.join(', ')}`);
      if (p === '/' || p === '/catch-up-bookkeeping') {
        const name = (p === '/' ? 'home' : 'catchup') + `-${w}`;
        await page.screenshot({ path: path.join(OUT, name + '-fold.png') });
        if (w === 390 || w === 1440) await page.screenshot({ path: path.join(OUT, name + '-full.png'), fullPage: true });
        // Primary CTA above the fold
        const box = await page.locator('#hero-cta a[data-book]').first().boundingBox();
        check(box && box.y + box.height <= h, `${p} @${w}px: primary CTA above the fold (bottom ${box && Math.round(box.y + box.height)} <= ${h})`);
      }
      if (w === 1440 || w === 375) {
        await page.addScriptTag({ content: AXE });
        const res = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')}`));
        check(res.length === 0, `${p} @${w}px: axe WCAG A/AA + best-practice clean ${res.join(' || ')}`);
      }
      await page.close();
    }
    await ctx.close();
  }

  // ---------- 2. Internal links ----------
  console.log('\n[2] Internal links and anchors');
  {
    const ctx = await newCtx(browser); const page = await ctx.newPage();
    const seen = new Set();
    for (const p of PAGES.slice(0, 4)) {
      await page.goto(BASE + p);
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href], link[href], img[src], script[src]')].map(e => e.getAttribute('href') || e.getAttribute('src')));
      for (const l of links) {
        if (/^(https?:|mailto:)/.test(l) && !l.startsWith(BASE)) continue;
        if (l.startsWith('#')) {
          const ok = await page.evaluate(id => !!document.getElementById(id), l.slice(1));
          check(ok, `${p}: anchor ${l} exists`); continue;
        }
        const u = new URL(l, BASE + p); const key = u.pathname;
        if (seen.has(key)) continue; seen.add(key);
        const r = await page.request.get(u.toString());
        check(r.status() === 200, `${key} -> ${r.status()}`);
        if (u.hash) {
          await page.goto(u.toString());
          check(await page.evaluate(id => !!document.getElementById(id), u.hash.slice(1)), `${l} anchor target exists`);
          await page.goto(BASE + p);
        }
      }
    }
    const ext = new Set();
    for (const f of ['index.html', 'catch-up-bookkeeping.html', 'thank-you.html', 'privacy.html', '404.html']) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      (html.match(/href="(https:\/\/calendly[^"]+)"/g) || []).forEach(m => ext.add(m));
      check(!/info@getsumify\.com/.test(html) || !/hello@/.test(html), `${f}: single contact email`);
    }
    check([...ext].every(x => x === 'href="https://calendly.com/alex-atlanticbay/15min"'), `every Calendly link points to the 15min event: ${[...ext].join(', ')}`);
    await ctx.close();
  }

  // ---------- 3. UTM / click-ID propagation ----------
  console.log('\n[3] UTM and click-ID capture and propagation');
  {
    const ctx = await newCtx(browser); const page = await ctx.newPage();
    await page.goto(BASE + '/?utm_source=google&utm_medium=cpc&utm_campaign=bk-search&utm_term=outsourced%20bookkeeping&utm_content=ad1&gclid=TESTGCLID123');
    const hrefs = await page.$$eval('a[data-book]', as => as.map(a => a.href));
    check(hrefs.length >= 8, `home has ${hrefs.length} booking CTAs`);
    check(hrefs.every(h => h.includes('utm_source=google') && h.includes('utm_campaign=bk-search') && h.includes('utm_term=outsourced+bookkeeping')), 'all CTAs carry UTMs into Calendly');
    check(hrefs.every(h => !h.includes('gclid')), 'gclid is NOT leaked into Calendly URLs');
    const attr = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sumify_attr')));
    check(attr && attr.params.gclid === 'TESTGCLID123', 'gclid stored first-party (session)');
    const persisted = await page.evaluate(() => localStorage.getItem('sumify_attr'));
    check(!!persisted, 'attribution persisted 90d where storage is allowed (US timezone)');
    await page.goto(BASE + '/catch-up-bookkeeping');
    const h2 = await page.$eval('a[data-book="hero"]', a => a.href);
    check(h2.includes('utm_campaign=bk-search'), 'UTMs persist to second page in session');
    await page.goto(BASE + '/?gbraid=GB1&utm_source=google&utm_campaign=ios');
    const a2 = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sumify_attr')).params);
    check(a2.gbraid === 'GB1' && !a2.gclid, 'new ad click replaces previous touch (gbraid captured)');
    await ctx.close();
  }

  // ---------- 4. CTA click: popup opens, NOT a conversion ----------
  console.log('\n[4] CTA click opens Calendly popup and does NOT count as a lead');
  {
    const ctx = await newCtx(browser); await withIds(ctx); await withFakeCalendly(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE + '/?utm_source=google&utm_campaign=c1');
    await page.click('#hero-cta a[data-book]');
    await page.waitForFunction(() => window.__popupUrl);
    const popupUrl = await page.evaluate(() => window.__popupUrl);
    check(popupUrl.startsWith('https://calendly.com/alex-atlanticbay/15min') && popupUrl.includes('utm_campaign=c1'), `popup opened with ${popupUrl}`);
    check(page.url().startsWith(BASE), 'visitor stays on the landing page');
    const layer = await dl(page);
    const clicks = events(layer, 'book_call_click');
    check(clicks.length === 1 && clicks[0].cta_location === 'hero', 'book_call_click fired once with cta_location=hero');
    check(events(layer, 'booking_completed').length === 0 && events(layer, 'generate_lead').length === 0, 'no booking_completed / generate_lead on click');
    check(conversions(layer).length === 0, 'no Google Ads conversion on click');
    const cfg = layer.filter(e => Array.isArray(e) && e[0] === 'config').map(e => e[1]);
    check(cfg.includes('G-TEST123') && cfg.includes('AW-111'), 'GA4 + Ads configured from config.js');
    const consent = layer.filter(e => Array.isArray(e) && e[0] === 'consent' && e[1] === 'default');
    const cfgIdx = layer.findIndex(e => Array.isArray(e) && e[0] === 'config');
    const conIdx = layer.findIndex(e => Array.isArray(e) && e[0] === 'consent');
    check(consent.length === 2 && conIdx < cfgIdx, 'Consent Mode v2 defaults (regional denied + global) set before config');
    check(consent[0][2].ad_user_data === 'denied' && consent[0][2].ad_personalization === 'denied' && consent[0][2].region.includes('DE'), 'v2 signals ad_user_data/ad_personalization present for EEA');
    await ctx.close();
  }

  // ---------- 5. Calendly script blocked -> direct link fallback ----------
  console.log('\n[5] Fallback when Calendly script cannot load');
  {
    const ctx = await newCtx(browser);
    await ctx.route('https://assets.calendly.com/**', r => r.abort());
    let navTo = null;
    await ctx.route('https://calendly.com/**', r => { navTo = r.request().url(); r.fulfill({ contentType: 'text/html', body: '<h1>calendly</h1>' }); });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?utm_source=google');
    await page.click('#hero-cta a[data-book]');
    await page.waitForURL(/calendly\.com/, { timeout: 8000 }).catch(() => {});
    check(navTo && navTo.includes('utm_source=google'), `fell back to direct Calendly link: ${navTo}`);
    await ctx.close();
  }
  {
    // No JavaScript at all: links are still real Calendly links
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage(); await page.goto(BASE + '/');
    const href = await page.$eval('#hero-cta a[data-book]', a => a.getAttribute('href'));
    check(href === 'https://calendly.com/alex-atlanticbay/15min', 'no-JS: CTA is a working Calendly link');
    await ctx.close();
  }

  // ---------- 6. Confirmed booking via Calendly embed message ----------
  console.log('\n[6] calendly.event_scheduled -> one conversion, redirect, no duplicates');
  {
    const ctx = await newCtx(browser); await withIds(ctx); await withFakeCalendly(ctx);
    await ctx.route('https://calendly.com/fake-frame', r => r.fulfill({ contentType: 'text/html', body:
      `<script>
        parent.postMessage({event:'calendly.event_type_viewed',payload:{}}, '*');
        parent.postMessage({event:'calendly.date_and_time_selected',payload:{}}, '*');
        parent.postMessage({event:'calendly.event_scheduled',payload:{event:{uri:'https://api.calendly.com/scheduled_events/EVT1'},invitee:{uri:'https://api.calendly.com/scheduled_events/EVT1/invitees/INVTEST0001'}}}, '*');
        parent.postMessage({event:'calendly.event_scheduled',payload:{event:{uri:'https://api.calendly.com/scheduled_events/EVT1'},invitee:{uri:'https://api.calendly.com/scheduled_events/EVT1/invitees/INVTEST0001'}}}, '*');
      </script>` }));
    const page = await ctx.newPage();
    // spoof attempt from a non-Calendly origin must be ignored
    await page.goto(BASE + '/?utm_source=google&utm_campaign=c9');
    await page.evaluate(() => window.postMessage({ event: 'calendly.event_scheduled', payload: { invitee: { uri: 'x/invitees/SPOOF000001' } } }, '*'));
    await page.waitForTimeout(300);
    check(events(await dl(page), 'booking_completed').length === 0, 'spoofed same-origin message ignored');

    // Capture dataLayer before navigation
    await page.exposeFunction('__snap', () => {});
    let snapshot = null;
    page.on('framenavigated', async f => {});
    const navPromise = page.waitForURL(/\/thank-you\?invitee_uuid=INVTEST0001&via=embed/, { timeout: 8000 });
    await page.evaluate(() => {
      window.addEventListener('beforeunload', () => { sessionStorage.setItem('__dl', JSON.stringify(window.dataLayer.map(e => (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) ? Array.from(e) : e), (k, v) => typeof v === 'function' ? 'fn' : v)); });
      const f = document.createElement('iframe'); f.src = 'https://calendly.com/fake-frame'; document.body.appendChild(f);
    });
    await navPromise.then(() => check(true, 'redirected to /thank-you after confirmed booking')).catch(() => check(false, 'redirect to /thank-you'));
    snapshot = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__dl')));
    check(events(snapshot, 'booking_widget_viewed').length === 1 && events(snapshot, 'booking_time_selected').length === 1, 'funnel events: widget viewed + time selected');
    check(events(snapshot, 'booking_completed').length === 1, 'booking_completed fired exactly once on landing page (duplicate message ignored)');
    check(events(snapshot, 'generate_lead').length === 1, 'generate_lead fired exactly once');
    const conv = conversions(snapshot);
    check(conv.length === 1 && conv[0][2].send_to === 'AW-111/LBL' && conv[0][2].transaction_id === 'INVTEST0001', 'Ads conversion once with transaction_id = invitee UUID');
    check(events(snapshot, 'booking_completed')[0].campaign_name === 'c9', 'booking carries campaign attribution');
    await page.waitForLoadState('networkidle');
    let layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'thank-you after embed: no duplicate conversion');
    check(await page.isVisible('[data-state="confirmed"] h1'), 'thank-you shows confirmed state');
    await page.reload({ waitUntil: 'networkidle' });
    layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'refreshing thank-you: no duplicate conversion');
    await ctx.close();
  }

  // ---------- 7. Thank-you page: direct visit / Calendly redirect ----------
  console.log('\n[7] Thank-you page conversion rules');
  {
    const ctx = await newCtx(browser); await withIds(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE + '/thank-you', { waitUntil: 'networkidle' });
    let layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'plain visit: NO conversion');
    check(await page.isVisible('[data-state="neutral"] h1') && !(await page.isVisible('[data-state="confirmed"] h1')), 'plain visit: neutral copy, no "booked" claim');
    await page.goto(BASE + '/thank-you.html', { waitUntil: 'networkidle' }).catch(() => {});

    const q = '?assigned_to=Alex&event_type_uuid=ET1&event_type_name=15%20Minute%20Meeting&event_start_time=2026-10-12T10%3A00%3A00-04%3A00&event_end_time=2026-10-12T10%3A15%3A00-04%3A00&invitee_uuid=REDIRECT0001&invitee_first_name=Jordan&invitee_last_name=Doe&invitee_full_name=Jordan%20Doe&invitee_email=jordan%40example.com&answer_1=Yes&utm_source=google&utm_campaign=c5';
    await page.goto(BASE + '/thank-you' + q, { waitUntil: 'networkidle' });
    const url = page.url();
    check(!/invitee_email|jordan%40|example\.com|invitee_full_name|invitee_first_name|answer_1/.test(url), 'PII scrubbed from URL before tags: ' + url);
    layer = await dl(page);
    const cfgPage = layer.find(e => Array.isArray(e) && e[0] === 'config');
    check(!!cfgPage, 'GA4 config (page_view) issued after scrub');
    check(events(layer, 'booking_completed').length === 1 && conversions(layer).length === 1 && conversions(layer)[0][2].transaction_id === 'REDIRECT0001', 'Calendly redirect: one conversion with transaction_id');
    check(events(layer, 'booking_completed')[0].booking_source === 'calendly_redirect', 'booking_source=calendly_redirect');
    check((await page.textContent('[data-state="confirmed"] h1')).includes('Jordan'), 'personalised with first name (client-side only)');
    check(await page.isVisible('[data-start-time]'), 'shows booked time');
    await page.reload({ waitUntil: 'networkidle' });
    layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'refresh after redirect: no duplicate');
    await page.goto(BASE + '/thank-you?invitee_uuid=%3Cscript%3E', { waitUntil: 'networkidle' });
    layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0, 'malformed invitee id ignored');
    await ctx.close();
  }

  // ---------- 8. Sticky mobile CTA ----------
  console.log('\n[8] Sticky mobile CTA');
  {
    const ctx = await newCtx(browser); const page = await ctx.newPage();
    await page.goto(BASE + '/');
    const vis = () => page.evaluate(() => document.querySelector('.sticky-cta').classList.contains('is-visible'));
    check(!(await vis()), 'hidden while hero CTA visible');
    await page.evaluate(() => document.getElementById('pricing').scrollIntoView({behavior:'instant'})); await page.waitForTimeout(400);
    check(await vis(), 'visible mid-page');
    await page.evaluate(() => document.getElementById('book').scrollIntoView({behavior:'instant'})); await page.waitForTimeout(400);
    check(!(await vis()), 'hidden at final CTA section');
    await ctx.close();
    const d = await newCtx(browser, { viewport: { width: 1440, height: 900 } }); const p2 = await d.newPage();
    await p2.goto(BASE + '/'); await p2.evaluate(() => window.scrollTo(0, 3000)); await p2.waitForTimeout(300);
    check(!(await p2.isVisible('.sticky-cta a')), 'not shown on desktop');
    await d.close();
  }

  // ---------- 9. Consent ----------
  console.log('\n[9] Consent banner and storage');
  {
    const ctx = await newCtx(browser, { timezoneId: 'Europe/Berlin' }); await withIds(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE + '/?utm_source=google&gclid=EUCLICK');
    check(await page.isVisible('.consent'), 'EU visitor sees non-blocking banner');
    check(!(await page.evaluate(() => localStorage.getItem('sumify_attr'))), 'EU visitor: click ID not persisted before consent');
    await page.screenshot({ path: path.join(OUT, 'consent-390.png') });
    await page.click('.consent [data-consent="granted"]');
    const layer = await dl(page);
    const upd = layer.filter(e => Array.isArray(e) && e[0] === 'consent' && e[1] === 'update');
    check(upd.length === 1 && upd[0][2].ad_storage === 'granted', 'accept -> consent update granted');
    check(!!(await page.evaluate(() => localStorage.getItem('sumify_attr'))), 'after accept: attribution persisted');
    await page.reload();
    check(!(await page.isVisible('.consent')), 'choice remembered');
    await page.click('footer [data-consent-open]');
    check(await page.isVisible('.consent'), 'footer "Privacy choices" reopens banner');
    await page.click('.consent [data-consent="denied"]');
    check(!(await page.evaluate(() => localStorage.getItem('sumify_attr'))), 'decline -> persisted attribution removed');
    await ctx.close();
    const us = await newCtx(browser); const p2 = await us.newPage(); await p2.goto(BASE + '/');
    check(!(await p2.isVisible('.consent')), 'US visitor: no banner');
    await us.close();
  }

  // ---------- 10. Keyboard ----------
  console.log('\n[10] Keyboard access');
  {
    const ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } }); await withFakeCalendly(ctx);
    const page = await ctx.newPage(); await page.goto(BASE + '/');
    await page.keyboard.press('Tab');
    check((await page.evaluate(() => document.activeElement.className)) === 'skip-link', 'first Tab focuses skip link');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const el = await page.evaluate(() => document.activeElement.getAttribute('data-book'));
    check(el === 'header', 'header CTA reachable by keyboard');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__popupUrl, null, { timeout: 3000 }).then(() => check(true, 'Enter on CTA opens scheduler')).catch(() => check(false, 'Enter opens scheduler'));
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check(outline !== 'none', 'visible focus indicator');
    await ctx.close();
  }

  // ---------- 11. Secrets & fabricated proof scan ----------
  console.log('\n[11] Static scans');
  {
    const files = ['index.html', 'catch-up-bookkeeping.html', 'thank-you.html', 'privacy.html', '404.html', 'assets/js/config.js', 'assets/js/tracking.js', 'assets/js/main.js', 'assets/js/thank-you.js'];
    const all = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    check(!/(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9]/i.test(all), 'no secrets/API keys in frontend');
    check(!/AW-\d{6,}|G-[A-Z0-9]{8,}|GTM-[A-Z0-9]{5,}/.test(all.replace(/e\.g\. "[^"]+"/g, '')), 'no hard-coded (fabricated) tracking IDs');
    check(!/★|stars?\b.*review|trusted by \d|\d+\+? (clients|businesses)|guarantee/i.test(all), 'no fabricated reviews, client counts or guarantees');
    const prices = ['$500', '$750', '$1,500', '150', '300', '750', '+$75/mo', '+$25/mo', '+$15/mo per employee', '$300–$500'];
    const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check(prices.every(p => home.includes(p)), 'all pricing and add-on terms present on home');
  }

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
