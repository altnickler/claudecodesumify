# Sumify niche landing pages (`/lp/<slug>/`)

A reusable system for **unlisted, industry-specific Google Ads landing pages**.
One template, one JSON config per niche, one command to generate.
Goal: qualified booked discovery calls (and, later, cost per acquired recurring client), not traffic.

> **Market narrowly, service broadly.** A page's criteria apply to *that ad campaign's program* only.
> They never limit what Sumify offers through the main site.

## How it fits together

```
lp/niches/<slug>.json      ← the ONLY thing you edit per niche (ICP + copy + campaign + Calendly)
tools/lp/build.mjs         ← template + validator + shared verified Sumify facts (pricing, scope, FAQs)
public/lp/<slug>/index.html  ← generated static page (commit it; Cloudflare needs no build step)
public/assets/css/lp.css   ← landing-page-only styles, layered on the production styles.css
public/assets/js/lp.js     ← inline Calendly scheduler, attribution into Calendly, fallback
```

```bash
node tools/lp/build.mjs            # generate every page from lp/niches/*.json
node tools/lp/build.mjs --check    # CI-style check: configs valid and pages up to date
```

Currently configured: **`/lp/template-preview/`**, a placeholder-only preview (status `preview`). No real niche pages exist yet.

## Page structure (fixed by the template)

1. **Hero**: who + problem + how, qualifier line, and an "Is this program a fit?" snapshot (industry, revenue, decision-maker, service, software).
2. **Inline Calendly scheduler**, visible without any click, framed as the free 15-minute call, with "what to expect" and "helpful to have handy". There's a direct-link fallback if the embed can't load.
3. **Before & after**: intended service outcomes (explicitly labelled as not client results), plus the monthly deliverables.
4. **Who it's for**.
5. **Who it's not for**, with a note that the criteria are program-specific and that catch-up and cleanup exist.
6. **FAQ**: niche questions plus selected shared, verified answers.
7. **Final**: scroll back to the scheduler. There is no second embed.

The header has the logo and "Pick a time" only, with no site navigation. The footer has legal text, the privacy policy, privacy choices and the contact email.

## Discoverability

| Rule | How |
|---|---|
| Not in navigation or footer of the main site | Nothing links to `/lp/` (checked by `tools/qa-lp.js`) |
| Not in the sitemap | `public/sitemap.xml` is hand-maintained; never add `/lp/` |
| `noindex, follow` | `<meta name="robots">` on every page **and** `X-Robots-Tag` for `/lp/*` in `public/_headers` |
| AdsBot can crawl | Nothing in `robots.txt` blocks `/lp/` (and must not) |
| Direct access | Plain static pages, no auth, cookies or referrer checks |

## Config reference: `lp/niches/<slug>.json`

| Field | Meaning |
|---|---|
| `slug` | URL path `/lp/<slug>/`; must match the file name |
| `status` | `preview` (placeholders allowed, banner) · `draft` (real copy, **proposed** targeting, banner "do not send ad traffic") · `live` (no banner; requires approvals) |
| `campaign.id` | Analytics label, e.g. `lp_dental_v1`. Sent as `lp_campaign` on every event and as `utm_campaign` to Calendly when the ad has none |
| `icp.approved` | `true` only after the owner approves the targeting. Required for `live` |
| `icp.industry`, `icp.audience` | e.g. "dental practices" / "established dental practices" |
| `icp.revenue.label` / `.approved` | e.g. "$2M–$5M annual revenue". Shown with a **Proposed** tag until approved; a `live` page cannot show an unapproved range |
| `icp.decisionMaker` | Who can buy, e.g. "Practice owner or authorized practice administrator" |
| `icp.painPoint`, `icp.desiredOutcome`, `icp.workflow` | ICP notes. `workflow` is internal only (never rendered) |
| `seo.title`, `seo.description` | Must match the ad's headline and promise (message match) |
| `hero.badge`, `.headline`, `.headlineAccent`, `.subhead`, `.qualifier` | Hero copy. The headline must say WHO, the PROBLEM and HOW Sumify helps |
| `booking.calendlyUrl` | Event link. Prefer a per-niche Calendly event type for clean reporting; defaults to the 15-min event |
| `booking.heading`, `.intro`, `.expect[]` (1–4), `.prep[]` (0–4) | Booking panel copy |
| `beforeAfter.heading`, `.intro`, `.before[]`, `.after[]` (3–6 each) | Niche-specific operational contrasts. Intended outcomes only |
| `fit.items[]`, `notFit.items[]` (3–8 each), `notFit.note` | Qualification and disqualification |
| `faqs[]` (≤6) | Niche-specific `{ "q", "a" }` |
| `standardFaqs[]` | Any of `pricing`, `included`, `software`, `behind`, `onboarding`, `call`. These answers live in `build.mjs` and come from the approved main-site facts |
| `final.heading`, `.accent`, `.text` | Closing section |

The validator refuses a page when:
- required fields are missing, or list sizes are out of range;
- the Calendly URL is invalid, or a campaign ID is duplicated;
- the status is `live` while `icp.approved` is false, the revenue range is unapproved, or any `[PLACEHOLDER]` text remains.

## Workflow: adding a niche

1. Copy `lp/niches/template-preview.json` to `lp/niches/<slug>.json`. Set `slug`, `status: "draft"` and `campaign.id`.
2. Fill the ICP and write **niche-specific** copy. Never just swap the industry name: the pain points, before/after, fit list and FAQs must reflect that buyer's real workflow.
3. Content rules:
   - Use only verified Sumify capabilities: QuickBooks Online, categorization, reconciliation, P&L and Balance Sheet within 10 business days, basic AR/AP on Standard and Growth, check-in calls, catch-up, and the published pricing.
   - **Never invent** industry expertise, certifications, integrations, testimonials, client names, results, ratings or case studies.
   - When a capability is uncertain (for example job costing, practice-management integrations, or industry-specific reports), say it's discussed on the call. Don't promise it.
   - Never ask for or mention collecting sensitive data (for example patient information).
4. `node tools/lp/build.mjs`, then run the QA (below), review the screenshots, commit to a development branch and push.
5. Review the branch preview. When the owner approves the targeting and copy, set `icp.approved: true` and `icp.revenue.approved: true`, then `status: "live"`. Rebuild, test and merge to `main`.

## Calendly setup (manual, in Calendly)

- Optionally create one event type per niche (for example `/15min-dental`) and put its URL in `booking.calendlyUrl`. That gives cleaner reporting and niche-specific questions.
- Recommended booking questions (radio buttons, minimal friction):
  1. *What is your approximate annual business revenue?* (ranges matching the campaign)
  2. *What accounting software do you currently use?* QuickBooks Online / Other / None
  3. *Are you looking for ongoing monthly bookkeeping?* Yes / One-time cleanup only / Not sure
- Don't add questions asking for patient data, account numbers or credentials.
- Paid plans: set **Redirect to `https://getsumify.com/thank-you`** with **Pass event details**. Both paths de-duplicate on the invitee UUID.

## Tracking

| Event | When | Notes |
|---|---|---|
| `lp_view` | Page load | `landing_page`, `lp_campaign` |
| `lp_cta_click` | "Pick a time" scroll buttons | Interaction only |
| `booking_widget_viewed` / `booking_time_selected` | Calendly embed events | **Not** bookings |
| `booking_embed_failed`, `booking_fallback_click` | Embed failure / direct link | Monitor these |
| `booking_completed` + `generate_lead` + Ads `conversion` | **Only** on `calendly.event_scheduled` (origin-checked) or a Calendly redirect carrying `invitee_uuid` | Once per invitee UUID; Ads `transaction_id` = invitee UUID |

- Every event on an `/lp/` page carries `landing_page` and `lp_campaign`, and so does `/thank-you` after a landing-page booking (`?lp=&lpc=` or `utm_content=lp_<slug>`). In GA4, register both as **event-scoped custom dimensions** to compare niches.
- Use one Google Ads campaign per niche pointing to its `/lp/<slug>/` URL. Ads already splits conversions by campaign; the same "Booked discovery call" conversion action works for all.
- Incoming UTMs are preserved. Missing `utm_content` and `utm_campaign` are filled with `lp_<slug>` and `campaign.id` for Calendly reporting. GCLID, GBRAID and WBRAID are stored first-party (consent-aware) and never sent to Calendly. No names, emails or financial data are sent to analytics.

**Not implemented (needs a backend):** server-verified bookings, the *qualified* appointment status, and the eventual *client* conversion.
The plan:
1. A Calendly `invitee.created` webhook, plus a booking-time beacon `{invitee_uri, gclid, gbraid, wbraid, lp}`, go to a Cloudflare Worker, which stores the pair in KV or D1. Secrets go in Worker env vars.
2. After the call, mark the lead qualified or won in your CRM.
3. Upload offline conversions ("Qualified call", "Became client") through the Google Ads API: `order_id` = invitee UUID, plus the stored GCLID or hashed email (enhanced conversions for leads).

## Testing

```bash
cd tools && npm install
npx serve -l 8787 ../public &
node qa-lp.js     # landing-page system: generator, guardrails, noindex/sitemap/robots, embed, fallback, tracking, a11y
node qa.js        # main site (must stay green)
```
