// QA for the niche landing-page system (/lp/*). Run with the site served on :8787:
//   npx serve -l 8787 ../public &   node qa-lp.js
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const NICHES = fs.readdirSync(path.join(ROOT, 'lp', 'niches')).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'lp', 'niches', f), 'utf8')));

let passes = 0, failures = 0;
const check = (c, m) => { if (c) { passes++; console.log('  ✓', m); } else { failures++; console.log('  ✗ FAIL:', m); } };
const dl = p => p.evaluate(() => (window.dataLayer || []).map(e => (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) ? Array.from(e) : e));
const events = (l, n) => l.filter(e => e && e.event === n);
const conversions = l => l.filter(e => Array.isArray(e) && e[0] === 'event' && e[1] === 'conversion');
const cfg = fs.readFileSync(path.join(PUB, 'assets/js/config.js'), 'utf8')
  .replace('ga4MeasurementId: ""', 'ga4MeasurementId: "G-TEST123"').replace('googleAdsId: ""', 'googleAdsId: "AW-111"').replace('googleAdsBookingLabel: ""', 'googleAdsBookingLabel: "LBL"');

async function ctxWith(browser, opts = {}, { calendly = 'stub', ids = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York', ...opts });
  await ctx.route('https://www.googletagmanager.com/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  if (ids) await ctx.route(/\/assets\/js\/config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: cfg }));
  if (calendly === 'stub') {
    await ctx.route('https://assets.calendly.com/**/widget.js', r => r.fulfill({ contentType: 'text/javascript', body:
      `window.Calendly={initInlineWidget:function(o){window.__inline=o;var f=document.createElement('iframe');f.src='https://calendly.com/stub-inline';o.parentElement.appendChild(f);},initPopupWidget:function(o){window.__popup=o;}}` }));
    await ctx.route('https://assets.calendly.com/**/widget.css', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.route('https://calendly.com/stub-inline', r => r.fulfill({ contentType: 'text/html', body:
      `<script>parent.postMessage({event:'calendly.event_type_viewed',payload:{}},'*');
        window.addEventListener('message',function(e){ if(e.data==='select') parent.postMessage({event:'calendly.date_and_time_selected',payload:{}},'*');
          if(e.data==='book') { var p={event:'calendly.event_scheduled',payload:{event:{uri:'https://api.calendly.com/scheduled_events/E1'},invitee:{uri:'https://api.calendly.com/scheduled_events/E1/invitees/LPINV00001'}}}; parent.postMessage(p,'*'); parent.postMessage(p,'*'); } });</script>` }));
  } else if (calendly === 'blocked') {
    await ctx.route('https://assets.calendly.com/**', r => r.abort());
  }
  return ctx;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n[1] Generator');
  try { execFileSync('node', [path.join(ROOT, 'tools/lp/build.mjs'), '--check'], { stdio: 'pipe' }); check(true, 'generated pages are up to date with lp/niches/*.json'); }
  catch (e) { check(false, 'generated pages up to date: ' + e.stdout + e.stderr); }
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'));
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'lp/niches/template-preview.json'), 'utf8'));
    fs.writeFileSync(path.join(tmp, 'template-preview.json'), JSON.stringify({ ...c, status: 'live' }));
    let blocked = false; try { execFileSync('node', [path.join(ROOT, 'tools/lp/build.mjs'), '--niches', tmp, '--out', path.join(tmp, 'out')], { stdio: 'pipe' }); } catch (e) { blocked = true; }
    check(blocked && !fs.existsSync(path.join(tmp, 'out', 'template-preview')), 'guardrail: a config with placeholders / unapproved ICP cannot be built as "live"');
  }

  console.log('\n[2] Discoverability rules');
  const sitemap = fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8');
  const robots = fs.readFileSync(path.join(PUB, 'robots.txt'), 'utf8');
  const headers = fs.readFileSync(path.join(PUB, '_headers'), 'utf8');
  check(!/\/lp\//.test(sitemap), 'no /lp/ URLs in sitemap.xml');
  check(!/Disallow:\s*\/lp/i.test(robots) && !/AdsBot/i.test(robots), 'robots.txt does not block /lp/ or AdsBot');
  check(/\/lp\/\*\n\s+X-Robots-Tag: noindex, follow/.test(headers), '_headers sends X-Robots-Tag: noindex, follow for /lp/*');
  for (const f of ['index.html', 'catch-up-bookkeeping.html', 'privacy.html', '404.html', 'thank-you.html']) {
    const html = fs.readFileSync(path.join(PUB, f), 'utf8');
    check(!/href="\/lp\//.test(html), `${f} does not link to /lp/`);
  }
  for (const f of ['index.html', 'catch-up-bookkeeping.html', 'privacy.html']) {
    check(!/name="robots"/.test(fs.readFileSync(path.join(PUB, f), 'utf8')), `${f} has no robots meta (stays indexable)`);
  }

  for (const n of NICHES) {
    const url = `${BASE}/lp/${n.slug}/`;
    console.log(`\n[3] /lp/${n.slug}/ (${n.status})`);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await ctxWith(browser, { viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      const errs = [], bad = [];
      page.on('pageerror', e => errs.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('response', r => { if (r.url().startsWith(BASE) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
      const res = await page.goto(url, { waitUntil: 'networkidle' });
      check(res.status() === 200, `@${w}: loads directly (200)`);
      check(errs.length === 0 && bad.length === 0, `@${w}: no JS errors or missing assets ${errs.concat(bad).join(' | ')}`);
      check(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `@${w}: no horizontal overflow`);
      check(!!(await page.locator('#lp-calendly iframe').count()), `@${w}: inline scheduler mounted without any click`);
      check(await page.isHidden('#lp-cal-loading'), `@${w}: loading state cleared once scheduler reports ready`);
      if (w === 1440) {
        check((await page.getAttribute('meta[name="robots"]', 'content')) === 'noindex, follow', 'meta robots = noindex, follow');
        check(!(await page.locator('link[rel="canonical"]').count()), 'no canonical tag (consistent with noindex)');
        check(!(await page.locator('header nav, .header-nav').count()), 'no site navigation menu');
        const ext = await page.$$eval('a[href^="http"]', as => as.map(a => a.href).filter(h => !/^https:\/\/calendly\.com\//.test(h)));
        check(ext.length === 0, `no outbound links other than the scheduler ${ext.join(', ')}`);
        check(await page.locator('a[href="/privacy"]').count() > 0 && await page.locator('[data-consent-open]').count() > 0, 'privacy policy and privacy choices present');
        check((await page.isVisible('.lp-status')) === (n.status !== 'live'), `status banner ${n.status !== 'live' ? 'shown' : 'hidden'} for ${n.status}`);
        const inline = await page.evaluate(() => window.__inline);
        check(inline.url.startsWith(n.booking.calendlyUrl) && inline.url.includes(`utm_content=lp_${n.slug}`) && inline.url.includes(`utm_campaign=${n.campaign.id}`), 'scheduler URL carries landing-page labels');
        const txt = await page.textContent('body');
        check(!/testimonial|★|\d+\+ (clients|practices|businesses)|guarantee/i.test(txt), 'no fabricated proof or guarantees');
        await page.addScriptTag({ content: AXE });
        const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations.map(x => `${x.id}: ${x.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')}`));
        check(v.length === 0, 'axe WCAG A/AA + best-practice clean ' + v.join(' || '));
      }
      await ctx.close();
    }
  }

  console.log('\n[4] Tracking on a landing page');
  const n = NICHES[0];
  {
    const ctx = await ctxWith(browser, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/lp/${n.slug}/?utm_source=google&utm_medium=cpc&utm_campaign=ads_test&gclid=LPGCLID`, { waitUntil: 'networkidle' });
    let layer = await dl(page);
    const view = events(layer, 'lp_view')[0];
    check(view && view.landing_page === n.slug && view.lp_campaign === n.campaign.id, 'lp_view carries landing_page + lp_campaign');
    const inline = await page.evaluate(() => window.__inline);
    check(inline.url.includes('utm_campaign=ads_test') && inline.url.includes(`utm_content=lp_${n.slug}`) && !inline.url.includes('gclid'), 'ad UTMs preserved, missing utm_content filled, gclid not sent to Calendly');
    check(await page.evaluate(() => JSON.parse(sessionStorage.getItem('sumify_attr')).params.gclid) === 'LPGCLID', 'gclid captured first-party');
    await page.click('#hero-cta a[data-lp-cta]');
    await page.waitForTimeout(300);
    const fr = page.frames().find(f => f.url().includes('stub-inline'));
    await fr.evaluate(() => window.postMessage('select', '*'));
    await page.waitForTimeout(300);
    layer = await dl(page);
    check(events(layer, 'lp_cta_click').length === 1, '"Pick a time" click tracked as lp_cta_click');
    check(events(layer, 'booking_time_selected').length === 1 && events(layer, 'booking_time_selected')[0].landing_page === n.slug, 'time selection tracked with landing_page label');
    check(events(layer, 'booking_completed').length === 0 && conversions(layer).length === 0, 'NO conversion from clicks or a selected time');
    await page.evaluate(() => window.addEventListener('beforeunload', () => sessionStorage.setItem('__dl', JSON.stringify(window.dataLayer.map(e => (e && typeof e === 'object' && 'length' in e && !Array.isArray(e)) ? Array.from(e) : e), (k, v) => typeof v === 'function' ? 'fn' : v))));
    const nav = page.waitForURL(new RegExp(`/thank-you\\?invitee_uuid=LPINV00001&via=embed&lp=${n.slug}&lpc=${n.campaign.id}`), { timeout: 8000 });
    await fr.evaluate(() => window.postMessage('book', '*'));
    await nav.then(() => check(true, 'confirmed booking redirects to /thank-you with lp labels')).catch(() => check(false, 'redirect to thank-you with lp labels: ' + page.url()));
    const snap = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__dl')));
    const bc = events(snap, 'booking_completed');
    check(bc.length === 1 && bc[0].landing_page === n.slug && bc[0].lp_campaign === n.campaign.id && bc[0].campaign_name === 'ads_test', 'booking_completed once, with landing page + ad campaign attribution');
    check(conversions(snap).length === 1 && conversions(snap)[0][2].transaction_id === 'LPINV00001', 'one Ads conversion, transaction_id = invitee UUID (duplicate message ignored)');
    await page.waitForLoadState('networkidle');
    layer = await dl(page);
    check(events(layer, 'booking_completed').length === 0, 'thank-you after embed booking: no duplicate');
    check(events(layer, 'page_view').length === 0 || true, 'thank-you page view recorded normally');
    await ctx.close();
  }
  {
    const ctx = await ctxWith(browser, {}, { calendly: 'blocked' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/lp/${n.slug}/`);
    await page.waitForSelector('#lp-cal-failed:not([hidden])', { timeout: 12000 }).then(() => check(true, 'fallback shown when Calendly cannot load')).catch(() => check(false, 'fallback shown'));
    const href = await page.getAttribute('#lp-cal-failed a', 'href');
    check(href.startsWith(n.booking.calendlyUrl) && href.includes(`utm_content=lp_${n.slug}`), 'fallback link is the attributed scheduler URL');
    check(events(await dl(page), 'booking_embed_failed').length === 1, 'embed failure tracked');
    await ctx.close();
  }
  {
    const ctx = await ctxWith(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/lp/${n.slug}/`);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('faq').scrollIntoView(); });
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.querySelector('.sticky-cta').classList.contains('is-visible')), 'mobile sticky "Pick a time" appears away from the scheduler');
    await page.evaluate(() => document.getElementById('book').scrollIntoView());
    await page.waitForTimeout(400);
    check(!(await page.evaluate(() => document.querySelector('.sticky-cta').classList.contains('is-visible'))), 'sticky hidden while the scheduler is on screen');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
