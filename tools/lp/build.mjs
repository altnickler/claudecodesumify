#!/usr/bin/env node
/*
 * Sumify niche landing-page generator.
 *
 *   node tools/lp/build.mjs           build public/lp/<slug>/index.html for every lp/niches/*.json
 *   node tools/lp/build.mjs --check   verify generated pages are up to date (exit 1 if stale/invalid)
 *   --niches <dir> --out <dir>        alternate input/output dirs (used by tests)
 *
 * No dependencies. Output is plain static HTML committed to the repo, so
 * Cloudflare Pages needs no build step. Field reference: lp/README.md.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const CHECK = args.includes("--check");
const NICHES = resolve(opt("--niches", join(ROOT, "lp", "niches")));
const OUT = resolve(opt("--out", join(ROOT, "public", "lp")));

/* ------------------------------------------------------------------ */
/* Verified Sumify facts shared by every niche page (from the main site). */
/* Change these only when the business terms change.                     */
/* ------------------------------------------------------------------ */
const STANDARD_FAQS = {
  pricing: {
    q: "How much does monthly bookkeeping cost?",
    a: "Flat monthly plans based on volume: Starter is $500/month (up to 150 transactions and 2 accounts), Standard is $750/month (up to 300 transactions and 4 accounts, plus basic AR/AP tracking and a monthly 15-minute check-in), and Growth is $1,500/month (up to 750 transactions and 8 accounts, plus basic AR/AP tracking and a monthly 30-minute check-in). Extra transactions are +$75/month per 100, and additional accounts are +$25/month each. You'll get an exact price on the call.",
  },
  included: {
    q: "What's included each month?",
    a: "We categorize your transactions, reconcile your bank and credit card accounts, review the work a second time, and send your Profit & Loss and Balance Sheet with a plain-English summary within 10 business days of month-end. Tax preparation or filing, running payroll or filing payroll taxes, and CFO or advisory services are not included.",
  },
  software: {
    q: "Do you work in QuickBooks Online? Do I have to change software?",
    a: "We work in QuickBooks Online, on your own subscription. If you already use it, nothing changes. If you use other software or spreadsheets, our monthly service requires QuickBooks Online, and we can set it up for you for a one-time $300–$500.",
  },
  behind: {
    q: "What if our books are behind or need cleanup?",
    a: "That's common. We quote a flat one-time catch-up fee based on how far behind you are and the condition of your records, then move you into monthly service once you're current.",
  },
  onboarding: {
    q: "How does onboarding work?",
    a: "If you want to go ahead after the call, you get a short engagement letter to sign and a link to set up payment. You then invite us to QuickBooks Online as your accountant (you never email passwords), and we review your chart of accounts and set up your monthly workflow.",
  },
  call: {
    q: "What happens on the free 15-minute call?",
    a: "We ask how you handle your books today, confirm QuickBooks Online and your monthly volume, and check whether this program fits. If it does, you get an exact price before the call ends, with no pressure to decide.",
  },
};

const STATUSES = ["preview", "draft", "live"];
const PLACEHOLDER = /\[[^\]]{2,}\]/;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function walkStrings(obj, path, fn) {
  if (typeof obj === "string") return fn(obj, path);
  if (Array.isArray(obj)) return obj.forEach((v, i) => walkStrings(v, `${path}[${i}]`, fn));
  if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) if (k !== "$comment") walkStrings(v, path ? `${path}.${k}` : k, fn);
}

function validate(c, file) {
  const errors = [], warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  const str = (v) => typeof v === "string" && v.trim().length > 0;
  const list = (v, min, max, name) => need(Array.isArray(v) && v.length >= min && v.length <= max && v.every(str), `${name}: needs ${min}–${max} non-empty items`);

  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug || ""), "slug: lowercase letters, numbers and hyphens only");
  need(file === `${c.slug}.json`, `file name must be ${c.slug}.json`);
  need(STATUSES.includes(c.status), `status: one of ${STATUSES.join(", ")}`);
  need(/^[a-z0-9_]{3,60}$/.test(c.campaign?.id || ""), "campaign.id: 3–60 chars, lowercase letters, numbers, underscores (used in analytics)");
  need(/^https:\/\/calendly\.com\/[A-Za-z0-9_\-/]+$/.test(c.booking?.calendlyUrl || ""), "booking.calendlyUrl: must be an https://calendly.com/... event link");
  for (const f of ["icp.industry", "icp.audience", "icp.decisionMaker", "icp.painPoint", "icp.desiredOutcome", "seo.title", "seo.description",
                   "hero.badge", "hero.headline", "hero.subhead", "hero.qualifier", "booking.heading", "booking.intro",
                   "beforeAfter.heading", "fit.heading", "notFit.heading", "notFit.note", "final.heading", "final.text"]) {
    need(str(f.split(".").reduce((o, k) => o?.[k], c)), `${f}: required`);
  }
  list(c.booking?.expect, 1, 4, "booking.expect");
  list(c.booking?.prep || [], 0, 4, "booking.prep");
  list(c.beforeAfter?.before, 3, 6, "beforeAfter.before");
  list(c.beforeAfter?.after, 3, 6, "beforeAfter.after");
  list(c.fit?.items, 3, 8, "fit.items");
  list(c.notFit?.items, 3, 8, "notFit.items");
  need(Array.isArray(c.faqs) && c.faqs.length <= 6 && c.faqs.every((f) => str(f.q) && str(f.a)), "faqs: up to 6 items with q and a");
  need(Array.isArray(c.standardFaqs) && c.standardFaqs.every((k) => k in STANDARD_FAQS), `standardFaqs: keys from ${Object.keys(STANDARD_FAQS).join(", ")}`);
  const total = (c.faqs?.length || 0) + (c.standardFaqs?.length || 0);
  if (total < 5 || total > 8) warnings.push(`FAQ count is ${total}; aim for 5–8`);

  const placeholders = [];
  walkStrings(c, "", (s, p) => { if (p !== "icp.workflow" && PLACEHOLDER.test(s)) placeholders.push(p); });

  if (c.status === "live") {
    need(c.icp?.approved === true, "live pages need icp.approved: true (owner-approved targeting)");
    need(!c.icp?.revenue?.label || c.icp.revenue.approved === true, "live pages cannot show an unapproved revenue range (set icp.revenue.approved: true or remove the label)");
    need(placeholders.length === 0, `live pages cannot contain [PLACEHOLDER] text: ${placeholders.join(", ")}`);
  } else if (placeholders.length) {
    warnings.push(`${placeholders.length} placeholder field(s) — fine for ${c.status}, must be filled before live`);
  }
  return { errors, warnings };
}

/* ------------------------------------------------------------------ */
const ICON_CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SMALL_CHECK = '<span class="check" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

function render(c) {
  const rev = c.icp.revenue?.label
    ? esc(c.icp.revenue.label) + (c.icp.revenue.approved ? "" : ' <span class="lp-proposed">Proposed</span>')
    : "";
  const banner = c.status === "live" ? "" : `
  <div class="lp-status" role="region" aria-label="Page status">
    <div class="wrap"><strong>${c.status === "preview" ? "Template preview" : "Draft"}</strong><span>${c.status === "preview"
      ? "Placeholder content for internal review. This page is not an advertising destination."
      : "Targeting criteria on this page are proposed and not yet approved. Do not send ad traffic here."}</span></div>
  </div>`;
  const li = (items, icon) => items.map((t) => `              <li>${icon}<span>${esc(t)}</span></li>`).join("\n");
  const faqs = [...c.faqs, ...c.standardFaqs.map((k) => STANDARD_FAQS[k])].map((f) => `          <details>
            <summary>${esc(f.q)}</summary>
            <div class="answer"><p>${esc(f.a)}</p></div>
          </details>`).join("\n");
  const cal = esc(c.booking.calendlyUrl);

  return `<!doctype html>
<!--
  GENERATED FILE: do not edit by hand.
  Source: lp/niches/${c.slug}.json   Build: node tools/lp/build.mjs
-->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(c.seo.title)}</title>
  <meta name="description" content="${esc(c.seo.description)}">
  <meta name="robots" content="noindex, follow">
  <meta name="theme-color" content="#ffffff">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/assets/img/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preconnect" href="https://assets.calendly.com">
  <link rel="preconnect" href="https://calendly.com">
  <link rel="stylesheet" href="/assets/css/styles.css?v=3">
  <link rel="stylesheet" href="/assets/css/lp.css?v=1">
  <script src="/assets/js/config.js?v=2" defer></script>
  <script src="/assets/js/tracking.js?v=3" defer></script>
  <script src="/assets/js/main.js?v=3" defer></script>
  <script src="/assets/js/lp.js?v=1" defer></script>
</head>
<body data-lp="${esc(c.slug)}" data-lp-campaign="${esc(c.campaign.id)}" data-lp-status="${esc(c.status)}">
  <a class="skip-link" href="#book">Skip to scheduling</a>
${banner}
  <header class="site-header lp-header">
    <div class="wrap">
      <span class="brand"><img src="/assets/img/logo.png" alt="Sumify" width="126" height="36"></span>
      <div class="header-actions">
        <ul class="lp-trust" aria-label="At a glance">
          <li>Free 15-minute call</li>
          <li>QuickBooks Online</li>
          <li>Flat monthly pricing</li>
        </ul>
        <a class="btn btn-primary btn-sm" href="#book" data-lp-cta="header">Pick a time</a>
      </div>
    </div>
  </header>

  <main id="main">
    <!-- 1. Hero: who + problem + how -->
    <section class="hero lp-hero" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div>
          <p class="hero-badge"><span class="badge-dot" aria-hidden="true"></span>${esc(c.hero.badge)}</p>
          <h1 id="hero-title">${esc(c.hero.headline)}${c.hero.headlineAccent ? ` <span class="accent">${esc(c.hero.headlineAccent)}</span>` : ""}</h1>
          <p class="lead">${esc(c.hero.subhead)}</p>
          <p class="lp-qualifier">${ICON_CHECK}<span>${esc(c.hero.qualifier)}</span></p>
          <div class="lp-hero-actions" id="hero-cta">
            <a class="btn btn-primary" href="#book" data-lp-cta="hero">Pick a time for a free call <span class="arrow" aria-hidden="true">↓</span></a>
            <p class="cta-note">Free · 15 minutes · No obligation</p>
          </div>
        </div>
        <div class="lp-snapshot">
          <h2>Is this program a fit?</h2>
          <dl>
            <div><dt>Industry</dt><dd>${esc(c.icp.audience)}</dd></div>
${rev ? `            <div><dt>Annual revenue</dt><dd>${rev}</dd></div>\n` : ""}            <div><dt>Decision-maker</dt><dd>${esc(c.icp.decisionMaker)}</dd></div>
            <div><dt>Service</dt><dd>Ongoing monthly bookkeeping</dd></div>
            <div><dt>Software</dt><dd>QuickBooks Online</dd></div>
          </dl>
          <p class="lp-snapshot-note">Criteria for this advertised program. Details below.</p>
        </div>
      </div>
    </section>

    <!-- 2. Primary conversion: inline scheduler -->
    <section class="lp-book" id="book" aria-labelledby="book-title">
      <div class="wrap lp-book-grid">
        <div class="lp-book-intro">
          <p class="eyebrow">Free discovery call</p>
          <h2 id="book-title">${esc(c.booking.heading)}</h2>
          <p>${esc(c.booking.intro)}</p>
          <ol class="lp-expect">
${c.booking.expect.map((t, i) => `            <li><span class="n" aria-hidden="true">${i + 1}</span><span>${esc(t)}</span></li>`).join("\n")}
          </ol>
${c.booking.prep?.length ? `          <div class="lp-prep">
            <h3>Helpful to have handy</h3>
            <ul>
${c.booking.prep.map((t) => `              <li>${esc(t)}</li>`).join("\n")}
            </ul>
          </div>\n` : ""}        </div>
        <div class="lp-cal-frame">
          <div class="lp-cal-bar"><span><span class="badge-dot" aria-hidden="true"></span>Free 15-minute discovery call</span><small>Sumify</small></div>
          <div class="lp-calendly" id="lp-calendly" data-url="${cal}" data-timeout="10000">
            <div class="lp-cal-state" id="lp-cal-loading" role="status">
              <div class="lp-skeleton" aria-hidden="true">${"<i></i>".repeat(14)}</div>
              <p>Loading available times…</p>
            </div>
            <div class="lp-cal-state" id="lp-cal-failed" hidden>
              <p>The scheduler didn't load on this page. You can book in a new tab instead.</p>
              <a class="btn btn-primary" href="${cal}" target="_blank" rel="noopener" data-lp-fallback="failed_state">Open the scheduler</a>
            </div>
            <noscript><p class="lp-cal-state"><a href="${cal}">Open the scheduler to pick a time</a></p></noscript>
          </div>
          <div class="lp-cal-fallback-row">
            <span>Calendar not showing?</span>
            <a href="${cal}" target="_blank" rel="noopener" data-lp-fallback="row">Open it in a new tab ↗</a>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. Before & after (intended service outcomes) -->
    <section class="section" aria-labelledby="ba-title">
      <div class="wrap">
        <div class="section-head">
          <p class="eyebrow">Before &amp; after</p>
          <h2 id="ba-title">${esc(c.beforeAfter.heading)}</h2>
${c.beforeAfter.intro ? `          <p>${esc(c.beforeAfter.intro)}</p>\n` : ""}        </div>
        <div class="compare">
          <div class="compare-col compare-before">
            <h3><span class="tag tag-before">Before</span> Doing it in-house</h3>
            <ul>
${li(c.beforeAfter.before, ICON_X)}
            </ul>
          </div>
          <div class="compare-col compare-after">
            <h3><span class="tag tag-after">With Sumify</span> Handled every month</h3>
            <ul>
${li(c.beforeAfter.after, ICON_CHECK)}
            </ul>
          </div>
        </div>
        <p class="lp-note">These are the intended outcomes of the service, not reported results from specific clients.</p>
        <ul class="lp-deliver" aria-label="Delivered every month">
          <li>${SMALL_CHECK}<span><small>Every month</small>Reconciled bank &amp; card accounts</span></li>
          <li>${SMALL_CHECK}<span><small>Within 10 business days</small>Profit &amp; Loss and Balance Sheet</span></li>
          <li>${SMALL_CHECK}<span><small>From your dedicated contact</small>A plain-English summary</span></li>
        </ul>
      </div>
    </section>

    <!-- 4 + 5. Who it's for / not for -->
    <section class="section section-soft" aria-label="Program fit">
      <div class="wrap lp-fit">
        <div class="lp-fit-col lp-fit-yes">
          <h2>${esc(c.fit.heading)}</h2>
          <p>${esc(c.fit.intro || "This program is built for:")}</p>
          <ul>
${li(c.fit.items, ICON_CHECK)}
          </ul>
        </div>
        <div class="lp-fit-col lp-fit-no">
          <h2>${esc(c.notFit.heading)}</h2>
          <p>${esc(c.notFit.intro || "This program isn't the right fit for:")}</p>
          <ul>
${li(c.notFit.items, ICON_X)}
          </ul>
          <p class="lp-fit-foot">${esc(c.notFit.note)} <a href="/">See all Sumify services</a>.</p>
        </div>
      </div>
    </section>

    <!-- 6. FAQ -->
    <section class="section section-tint" id="faq" aria-labelledby="faq-title">
      <div class="wrap">
        <div class="section-head center">
          <p class="eyebrow">FAQ</p>
          <h2 id="faq-title">Questions before you book</h2>
        </div>
        <div class="faq">
${faqs}
        </div>
      </div>
    </section>

    <!-- 7. Final: back to the scheduler (no second embed) -->
    <section class="final-cta lp-final" aria-labelledby="final-title">
      <div class="wrap">
        <div class="final-panel">
          <div class="inner">
            <h2 id="final-title">${esc(c.final.heading)}${c.final.accent ? ` <span class="lp-dark-accent">${esc(c.final.accent)}</span>` : ""}</h2>
            <p>${esc(c.final.text)}</p>
            <a class="btn btn-on-dark" href="#book" data-lp-cta="final">Pick a time <span class="arrow" aria-hidden="true">↑</span></a>
            <p class="cta-note">Prefer email? Write to <a href="mailto:info@getsumify.com">info@getsumify.com</a>.</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-brand">
        <img src="/assets/img/logo.png" alt="Sumify" width="98" height="28" loading="lazy">
        <p class="footer-legal">© 2026 Sumify LLC. Sumify provides bookkeeping services. It is not a CPA firm and does not provide tax, legal, or investment advice.</p>
      </div>
      <ul class="footer-links">
        <li><a href="/privacy">Privacy policy</a></li>
        <li><button type="button" data-consent-open>Privacy choices</button></li>
        <li><a href="mailto:info@getsumify.com">info@getsumify.com</a></li>
      </ul>
    </div>
  </footer>

  <div class="sticky-cta" aria-hidden="true">
    <a class="btn btn-primary" href="#book" data-lp-cta="sticky_mobile" tabindex="-1">Pick a time for a free call</a>
  </div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
const files = existsSync(NICHES) ? readdirSync(NICHES).filter((f) => f.endsWith(".json")).sort() : [];
let failed = false;
const ids = new Map();
for (const file of files) {
  let c;
  try { c = JSON.parse(readFileSync(join(NICHES, file), "utf8")); }
  catch (e) { console.error(`✗ ${file}: invalid JSON (${e.message})`); failed = true; continue; }
  const { errors, warnings } = validate(c, file);
  if (ids.has(c.campaign?.id)) errors.push(`campaign.id duplicates ${ids.get(c.campaign.id)}`);
  ids.set(c.campaign?.id, file);
  warnings.forEach((w) => console.warn(`! ${file}: ${w}`));
  if (errors.length) { errors.forEach((e) => console.error(`✗ ${file}: ${e}`)); failed = true; continue; }

  const html = render(c);
  const dest = join(OUT, c.slug, "index.html");
  if (CHECK) {
    const cur = existsSync(dest) ? readFileSync(dest, "utf8") : "";
    if (cur !== html) { console.error(`✗ ${file}: ${dest} is out of date. Run: node tools/lp/build.mjs`); failed = true; }
    else console.log(`✓ ${file} → /lp/${c.slug}/ (${c.status}, up to date)`);
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
    console.log(`✓ ${file} → /lp/${c.slug}/ (${c.status})`);
  }
}
if (existsSync(OUT)) {
  const slugs = new Set(files.map((f) => f.replace(/\.json$/, "")));
  for (const d of readdirSync(OUT)) if (!slugs.has(d)) console.warn(`! public/lp/${d}/ has no config in lp/niches/ (delete it if retired)`);
}
process.exit(failed ? 1 : 0);
