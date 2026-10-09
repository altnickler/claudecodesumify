// Acceptance tests for /lp/owner-operator-trucking/ (run with the site served on :8787):
//   npx serve -l 8787 ../public &   node qa-trucking.js
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SLUG = 'owner-operator-trucking';
const URL_LP = `${BASE}/lp/${SLUG}/`;
const CAL = 'https://calendly.com/alex-atlanticbay/15min';
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUB, 'lp', SLUG, 'index.html'), 'utf8');

let passes = 0, failures = 0;
const check = (c, m) => { if (c) { passes++; console.log('  ✓', m); } else { failures++; console.log('  ✗ FAIL:', m); } };
const dl = p => p.evaluate(() => (window.dataLayer || []).map(e => (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) ? Array.from(e) : e));
const events = (l, n) => l.filter(e => e && e.event === n);
const conversions = l => l.filter(e => Array.isArray(e) && e[0] === 'event' && e[1] === 'conversion');
const cfg = fs.readFileSync(path.join(PUB, 'assets/js/config.js'), 'utf8')
  .replace('ga4MeasurementId: ""', 'ga4MeasurementId: "G-TEST123"').replace('googleAdsId: ""', 'googleAdsId: "AW-111"').replace('googleAdsBookingLabel: ""', 'googleAdsBookingLabel: "LBL"');

async function ctxWith(browser, opts = {}, calendly = 'stub') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', ...opts });
  await ctx.route('https://www.googletagmanager.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.route(/\/assets\/js\/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: cfg }));
  if (calendly === 'stub') {
    await ctx.route('https://assets.calendly.com/**/widget.js', r => r.fulfill({ contentType: 'text/javascript', body:
      `window.Calendly={initInlineWidget:function(o){window.__inline=o;var f=document.createElement('iframe');f.src='https://calendly.com/stub-inline';o.parentElement.appendChild(f);}}` }));
    await ctx.route('https://assets.calendly.com/**/widget.css', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route('https://calendly.com/stub-inline', r => r.fulfill({ contentType: 'text/html', body:
      `<title>stub</title><script>parent.postMessage({event:'calendly.event_type_viewed',payload:{}},'*');
        parent.postMessage({event:'calendly.page_height',payload:{height:'812px'}},'*');
        window.addEventListener('message',function(e){ if(e.data==='select') parent.postMessage({event:'calendly.date_and_time_selected',payload:{}},'*');
          if(e.data==='book'){ var p={event:'calendly.event_scheduled',payload:{event:{uri:'https://api.calendly.com/scheduled_events/E1'},invitee:{uri:'https://api.calendly.com/scheduled_events/E1/invitees/TRUCK00001'}}}; parent.postMessage(p,'*'); parent.postMessage(p,'*'); } });</script>` }));
  } else {
    await ctx.route('https://assets.calendly.com/**', r => r.abort());
  }
  return ctx;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Content acceptance criteria');
  const text = HTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const count = re => (HTML.match(re) || []).length;
  check(/For owner-operators with 1–3 trucks/.test(text), 'eyebrow: "For owner-operators with 1–3 trucks"');
  check(/You Drive\.\s+We Handle the Books\./.test(text), 'headline: "You Drive. We Handle the Books."');
  check(/done-for-you bookkeeping from \$500\/month/.test(text), 'hero states "from $500/month"');
  check(/Let's Get Your Books Handled\./.test(text) && /Free 15-minute call · No obligation/.test(text), 'calendar heading + "Free 15-minute call · No obligation"');
  const ba = HTML.slice(HTML.indexOf('id="ba-title"'), HTML.indexOf('lpt-fit'));
  check((ba.match(/<li>/g) || []).length === 6 && /Receipts and settlements piling up/.test(ba) && /Clear financial reports/.test(ba), 'before/after: exactly 3 + 3 trucking points');
  const fit = HTML.slice(HTML.indexOf('lpt-fit-grid'), HTML.indexOf('id="faq-title"'));
  check(/Made for Trucking Business Owners\./.test(fit) && /Probably Not the Right Fit If…/.test(fit) && (fit.match(/<li>/g) || []).length === 6, 'who it\'s for / not for: 3 + 3 points');
  check(/starting at \$500\/month/.test(fit) && /company driver, not a business owner/.test(fit), 'fit lists include the $500 minimum and the company-driver exclusion');
  check(count(/<details>/g) === 4 && /IFTA/.test(text) && /QuickBooks Online/.test(text), 'exactly 4 FAQs, incl. IFTA and a QuickBooks Online note');
  check(!/sticky-cta/.test(HTML), 'no sticky booking bar');
  check((HTML.slice(HTML.indexOf('<body')).match(/\$500/g) || []).length <= 3, 'visible price mentioned at most 3 times (hero, fit, FAQ)');
  const paras = (HTML.match(/<(?:p|li|h[1-3]|summary)[^>]*>([\s\S]*?)<\/(?:p|li|h[1-3]|summary)>/g) || []).map(x => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  check(paras.length === new Set(paras).size, 'no repeated text blocks');
  check(!/\$750|\$1,500|Starter|Standard|Growth plan|Add-ons/.test(text), 'no three-plan pricing table or add-on list');
  check(!/What Sumify handles every month|Catch-up fee schedule|How it works/.test(text), 'no homepage services catalog / process / catch-up sections');
  check(!/testimonial|★|rated|\d+\+ (clients|truckers|businesses)|guarantee|save \$|saved/i.test(text), 'no fabricated proof, ratings, savings or guarantees');
  check(!/IFTA filing (included|service)|DOT compliance service|fuel tax prep|dispatch service|per-truck profitability/i.test(text), 'no unverified transportation-specific services claimed');
  const order = ['<h1', 'id="book-title"', 'id="ba-title"', 'Made for Trucking', 'Probably Not the Right Fit', 'id="faq-title"'].map(m => HTML.indexOf(m));
  check(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'sections in the required order: hero → calendar → before/after → for → not for → FAQ');

  console.log('\n[2] Unlisted, noindex, crawlable');
  const sitemap = fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8');
  const robots = fs.readFileSync(path.join(PUB, 'robots.txt'), 'utf8');
  const headers = fs.readFileSync(path.join(PUB, '_headers'), 'utf8');
  check(!/\/lp\//.test(sitemap), 'not in sitemap.xml');
  check(!/Disallow:\s*\/lp/i.test(robots) && !/AdsBot/i.test(robots), 'not blocked in robots.txt (AdsBot can crawl)');
  check(/<meta name="robots" content="noindex, follow">/.test(HTML) && /\/lp\/\*\n\s+X-Robots-Tag: noindex, follow/.test(headers), 'noindex via meta and X-Robots-Tag');
  check(!/rel="canonical"/.test(HTML), 'no canonical tag');
  for (const f of ['index.html', 'catch-up-bookkeeping.html', 'privacy.html', 'thank-you.html', '404.html']) {
    check(!/\/lp\//.test(fs.readFileSync(path.join(PUB, f), 'utf8')), `${f} does not link to /lp/`);
  }
  check(!fs.existsSync(path.join(PUB, 'lp', 'template-preview')), 'old template preview removed');
  try {
    const changed = execSync('git diff --name-only origin/main -- public/index.html public/catch-up-bookkeeping.html public/privacy.html public/thank-you.html public/404.html public/assets/css/styles.css public/sitemap.xml public/robots.txt public/_redirects', { cwd: ROOT }).toString().trim();
    check(changed === '', 'production pages, styles, sitemap, robots and redirects unchanged vs main ' + changed);
  } catch (e) { check(false, 'git diff vs main: ' + e.message); }

  console.log('\n[3] Preview routing function');
  const fn = await import(path.join(ROOT, 'functions', 'index.js'));
  for (const [u, want] of [['https://claude-sumify-niche-landing.sumify.pages.dev/?gclid=X', 302], ['https://getsumify.com/', 'next'], ['https://www.getsumify.com/', 'next'], ['https://sumify.pages.dev/', 'next']]) {
    const r = await fn.onRequest({ request: new Request(u), next: async () => 'next' });
    const got = r === 'next' ? 'next' : r.status;
    check(got === want && (got !== 302 || r.headers.get('location').endsWith(`/lp/${SLUG}/?gclid=X`)), `${new URL(u).host}/ → ${got === 302 ? 'trucking page (query kept)' : 'homepage untouched'}`);
  }

  console.log('\n[4] Rendering');
  for (const [w, h] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [375, 812]]) {
    const ctx = await ctxWith(browser, { viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errs = [], bad = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    const res = await page.goto(URL_LP, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    check(res.status() === 200 && errs.length === 0 && bad.length === 0, `@${w}: loads directly, no errors ${errs.concat(bad).join(' | ')}`);
    check(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `@${w}: no horizontal overflow`);
    check(await page.locator('#lp-calendly iframe').count() === 1, `@${w}: inline scheduler mounted with no click (exactly one booking system)`);
    check(await page.isHidden('#lp-cal-loading'), `@${w}: loading state cleared`);
    check((await page.evaluate(() => document.getElementById('lp-calendly').style.height)) === '812px', `@${w}: frame resized to Calendly's content height (no inner scroll)`);
    const vis = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, sel);
    check(await vis('.lpt-lede strong'), `@${w}: "$500/month" visible on the first screen`);
    const iw = await page.evaluate(() => document.getElementById('lp-calendly').clientWidth);
    const hid = /hide_event_type_details=1/.test(await page.evaluate(() => window.__inline.url));
    check(hid === (iw < 700), `@${w}: Calendly details ${hid ? 'hidden (narrow frame, calendar first)' : 'shown (wide frame)'}`);
    const logoH = await page.evaluate(() => document.querySelector('.lpt-logo').getBoundingClientRect().height);
    check(logoH >= 34 && logoH <= 42, `@${w}: logo ${Math.round(logoH)}px tall (34–42px, never upscaled past the 72px source)`);
    const lines = await page.evaluate(() => { const e = document.querySelector('.lpt-eyebrow'); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); });
    check(lines <= 2, `@${w}: audience label on ${lines} line(s), no mid-word break`);
    check(await vis('.lpt-cal-head'), `@${w}: calendar card starts on the first screen`);
    if (w === 1440) {
      check(!(await page.locator('nav').count()), 'no navigation menu');
      check((await page.locator('header a').count()) === 0, 'hero header has no links (logo is not an exit)');
      const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
      const exits = hrefs.filter(h => !h.startsWith('#') && !h.startsWith(CAL) && h !== '/privacy' && !h.startsWith('mailto:'));
      check(exits.length === 0, `only exits: privacy policy, email, scheduler fallback ${exits.join(', ')}`);
      const bookCtas = await page.$$eval('[data-lp-cta]', as => as.map(a => a.getAttribute('href')));
      check(bookCtas.length === 1 && bookCtas[0] === '#book', 'one quiet "Pick a time" link after the FAQ, returning to the scheduler');
      check((await page.$$eval('a[href^="https://calendly.com"]', as => as.length)) === 1, 'Calendly link only as the hidden-until-needed fallback');
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(x => `${x.id}: ${x.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')}`));
      check(v.length === 0, 'axe WCAG A/AA + best-practice clean ' + v.join(' || '));
    }
    await ctx.close();
  }

  console.log('\n[5] Tracking');
  {
    const ctx = await ctxWith(browser, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${URL_LP}?utm_source=google&utm_medium=cpc&utm_campaign=trucking_search&utm_term=owner%20operator%20bookkeeping&gclid=TRUCKGCLID`, { waitUntil: 'networkidle' });
    let layer = await dl(page);
    const v = events(layer, 'lp_view')[0];
    check(v && v.landing_page === SLUG && v.lp_campaign === SLUG, 'lp_view with landing_page + lp_campaign = owner-operator-trucking');
    const inline = await page.evaluate(() => window.__inline);
    check(inline.url.startsWith(CAL) && /utm_campaign=trucking_search/.test(inline.url) && /utm_content=lp_owner-operator-trucking/.test(inline.url) && !/gclid/.test(inline.url), 'ad UTMs passed to Calendly, page label added, gclid kept off Calendly');
    check(!/hide_event_type_details=1/.test(inline.url), '@1440: Calendly keeps its event-details column (two-column layout fills the frame)');
    check(await page.evaluate(() => JSON.parse(sessionStorage.getItem('sumify_attr')).params.gclid) === 'TRUCKGCLID', 'gclid captured first-party for Ads attribution');
    const cv = layer.filter(e => Array.isArray(e) && e[0] === 'config').map(e => e[1]);
    check(cv.includes('G-TEST123') && cv.includes('AW-111'), 'existing GA4 + Google Ads tags load as on the main site');
    await page.click('a[data-lp-cta]');
    const fr = page.frames().find(f => f.url().includes('stub-inline'));
    await fr.evaluate(() => window.postMessage('select', '*'));
    await page.waitForTimeout(300);
    layer = await dl(page);
    check(events(layer, 'lp_cta_click').length === 1 && events(layer, 'booking_time_selected').length === 1, 'CTA click and time selection tracked as interactions');
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'NO conversion from a click or selected time');
    await page.evaluate(() => window.addEventListener('beforeunload', () => sessionStorage.setItem('__dl', JSON.stringify(window.dataLayer.map(e => (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) ? Array.from(e) : e), (k, v) => typeof v === 'function' ? 'fn' : v))));
    const nav = page.waitForURL(/\/thank-you\?invitee_uuid=TRUCK00001&via=embed&lp=owner-operator-trucking&lpc=owner-operator-trucking/, { timeout: 8000 });
    await fr.evaluate(() => window.postMessage('book', '*'));
    await nav.then(() => check(true, 'confirmed booking → /thank-you with landing-page labels')).catch(() => check(false, 'redirect to thank-you: ' + page.url()));
    const snap = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__dl')));
    const bc = events(snap, 'booking_completed');
    check(bc.length === 1 && bc[0].landing_page === SLUG && bc[0].campaign_name === 'trucking_search', 'booking_completed once, with landing page + ad campaign');
    check(conversions(snap).length === 1 && conversions(snap)[0][2].transaction_id === 'TRUCK00001', 'one Ads conversion (duplicate Calendly message ignored)');
    await page.waitForLoadState('networkidle');
    check(events(await dl(page), 'booking_completed').length === 0, 'thank-you does not double count');
    await ctx.close();
  }
  {
    const ctx = await ctxWith(browser, {}, 'blocked');
    const page = await ctx.newPage();
    await page.goto(URL_LP);
    await page.waitForSelector('#lp-cal-failed:not([hidden])', { timeout: 12000 }).then(() => check(true, 'fallback appears only when Calendly fails to load')).catch(() => check(false, 'fallback shown'));
    const href = await page.getAttribute('#lp-cal-failed a', 'href');
    check(href.startsWith(CAL) && /utm_content=lp_owner-operator-trucking/.test(href), 'fallback link is the attributed scheduler URL');
    check((await page.evaluate(() => document.getElementById('lp-calendly').style.height)) === '320px', 'fallback state is compact (no empty frame)');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
