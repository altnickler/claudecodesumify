# Sumify: Google Ads landing site

Static HTML/CSS/JS site for **getsumify.com**, built for paid search traffic. Its single goal is **confirmed 15-minute discovery-call bookings**.
There is no build step, framework or backend, and nothing in the browser is secret.

```
public/                          ← the deployed site (Cloudflare build output directory)
├── index.html                   Monthly bookkeeping landing page (primary ad destination)
├── catch-up-bookkeeping.html    Catch-up / cleanup landing page (for catch-up keywords)
├── thank-you.html               Post-booking page (conversion only with a Calendly booking ID)
├── privacy.html                 Privacy policy (DRAFT: attorney review before ads)
├── 404.html                     Served automatically by Pages for unknown URLs
├── _headers                     Security headers, CSP, caching, noindex for *.pages.dev
├── _redirects                   Short links (/book, /catch-up)
├── robots.txt, sitemap.xml, favicon.ico
└── assets/
    ├── css/styles.css
    ├── js/config.js             ← the ONLY file you edit for IDs (GA4, Ads, GTM, Meta, Calendly)
    ├── js/tracking.js           Consent Mode v2, tag loading, UTM/click-ID capture, de-duplicated conversions
    ├── js/main.js               Calendly popup (lazy-loaded) + fallback, embed events, sticky mobile CTA
    ├── js/thank-you.js          Thank-you state + conversion rules
    ├── fonts/                   Self-hosted Instrument Sans + IBM Plex Mono (SIL OFL)
    └── img/                     Logo (from the original logo.png), favicons, OG share image
tools/qa.js                      Playwright + axe end-to-end QA (not deployed)
```

Clean URLs: Cloudflare Pages serves `/thank-you`, `/privacy` and `/catch-up-bookkeeping` from the `.html` files. Old `*.html` URLs automatically 308-redirect to the clean URL, and the query string is kept.

---

## 1. Fill in configuration: `public/assets/js/config.js`

| Setting | Where to get it | Required? |
|---|---|---|
| `ga4MeasurementId` | GA4 → Admin → Data streams → Web → Measurement ID (`G-…`) | Recommended |
| `googleAdsId` | Google Ads → Goals → Conversions → your action → Tag setup → "Install the tag yourself" (`AW-…`) | **Yes, for Ads** |
| `googleAdsBookingLabel` | Same screen: the part after the slash in `send_to: 'AW-…/XXXX'` | **Yes, for Ads** |
| `gtmContainerId` | Only if you prefer GTM. If set, the site does not load gtag.js itself (see §5b) | Optional |
| `metaPixelId` | Meta Events Manager (only if you advertise on Meta) | Optional |
| `calendlyUrl` | Already set to `https://calendly.com/alex-atlanticbay/15min` | Done |

With every ID left blank the site still works: every button opens Calendly and nothing is tracked.
**Never** put API keys, Calendly tokens or Google Ads developer tokens in this file. They would be public.

After editing JS or CSS, bump `?v=2` → `?v=3` in the HTML `<script>`/`<link>` tags so returning visitors get the new file.

---

## 2. Deploy to Cloudflare Pages (Direct Upload)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Project name: `sumify` (this gives you `sumify.pages.dev`). Click **Create project**.
3. Drag the **`public` folder** (not the repo root) into the upload box → **Deploy site**.
4. Open the `*.pages.dev` URL and run the checks in §7. The `_headers` file keeps `*.pages.dev` out of Google's index.
5. To update later: project → **Create new deployment** → upload `public` again. Every deployment gets a preview URL, and you can roll back from **Deployments**.

CLI alternative (optional): `npx wrangler pages deploy public --project-name sumify`.

### 2b. Automatic deploys from GitHub (recommended): `main` is production

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → authorize GitHub → choose `altnickler/claudecodesumify`.
2. **Production branch:** `main`.
3. **Framework preset:** None. **Build command:** leave empty. **Build output directory:** `public`.
   This setting matters. Without it, Cloudflare would publish the repo root, which still contains the old site files.
4. **Save and Deploy.** From then on every push to `main` deploys to production. Pushes to other branches get preview URLs (`<branch>.<project>.pages.dev`).
5. A project created with **Direct Upload** can't be switched to Git later. If you already made one, create a new Git-connected project, then move the custom domains to it (§3).

> **Legacy files:** `index.html`, `privacy.html`, `thank-you.html` and `logo.png` at the repo root are the previous site, kept unchanged from the original upload. They are **not** deployed (only `public/` is) and can be deleted whenever you like.

## 3. Custom domain: getsumify.com

1. Add **getsumify.com** as a site in Cloudflare (**Add a domain**), then change the nameservers at your registrar to the two Cloudflare gives you. Wait for "Active".
2. Pages project → **Custom domains** → **Set up a custom domain** → `getsumify.com` → **Activate domain**. Cloudflare creates the DNS record and SSL certificate.
3. Repeat for `www.getsumify.com`.
4. **SSL/TLS → Edge Certificates**: turn on **Always Use HTTPS**. HSTS is already sent by `_headers` (1 year, no preload). Add preload only once you're sure every subdomain will always be HTTPS.
5. Redirect www to the apex: **Rules → Redirect Rules → Create rule**, *Custom filter*: `Hostname equals www.getsumify.com`
   → *Dynamic* → `concat("https://getsumify.com", http.request.uri.path)` → **301**, ✅ Preserve query string.
   Preserving the query string is essential, because `gclid` and the UTMs must survive the redirect.

## 4. Redirect sumify.io → getsumify.com

1. Add **sumify.io** to Cloudflare and switch its nameservers.
2. DNS for sumify.io: add `AAAA @ 100::` and `AAAA www 100::`, both **Proxied (orange cloud)**. These are placeholder records that only exist so Cloudflare can apply the redirect.
3. sumify.io zone → **Rules → Redirect Rules → Create rule** → *All incoming requests* →
   *Dynamic* `concat("https://getsumify.com", http.request.uri.path)` → **301**, ✅ Preserve query string.
   (Or use **Bulk Redirects** with "Include subdomains", "Subpath matching" and "Preserve query string" ticked.)
4. Email: add SPF, DKIM and DMARC records for **both** domains from your email provider. If sumify.io sends no mail, publish `v=spf1 -all` and `v=DMARC1; p=reject`.

> Point your Google Ads final URLs at **https://getsumify.com/** directly, not at sumify.io. Redirects slow the landing page and can trigger Ads policy "destination mismatch" reviews.

---

## 5. Google Ads + GA4 setup

### How conversions work (and why a click is not a lead)

| Event | Fires when | Use it as |
|---|---|---|
| `page_view` | Any page load (GA4 config) | — |
| `book_call_click` | A booking button is clicked (carries `cta_location`) | Funnel diagnostics only. **Never a primary conversion.** |
| `booking_widget_viewed`, `booking_time_selected` | Calendly popup loaded / time chosen | Funnel diagnostics |
| `booking_completed` + `generate_lead` | **Calendly confirms the booking**: either Calendly's `calendly.event_scheduled` message in the on-page popup, or a Calendly redirect carrying `invitee_uuid` | GA4 key event |
| Google Ads `conversion` | Same moment, with `transaction_id = Calendly invitee UUID` | **Primary Ads conversion** |

De-duplication works in three layers:
1. Each invitee UUID is recorded once per browser. That covers refreshes, the back button, and the popup and redirect both landing for the same booking.
2. Google Ads de-duplicates server-side on `transaction_id`.
3. `/thank-you` without a valid `invitee_uuid` records **nothing** and makes no "you're booked" claim.

Personal data that Calendly appends (name, email, answers) is stripped from the URL **before** any tag loads, so it never reaches GA4 or Ads.

### 5a. gtag.js (recommended)

1. **Google Ads → Goals → Conversions → New conversion action → Website** → *Add a conversion action manually*:
   - Goal: **Book appointment**. Name: `Booked discovery call`.
   - Value: optional. Use a consistent value if you know what a booked call is worth.
   - Count: **One**. Click-through window: **90 days**, which matches the site's 90-day attribution storage.
   - Set it as a **Primary** action. Copy the `AW-…` ID and label into `config.js`.
2. Make sure **auto-tagging** is on (Admin → Account settings). The site preserves `gclid`, `gbraid` and `wbraid`.
3. **GA4**: create a web data stream and put the Measurement ID in `config.js`. After the first test booking, go to Admin → Events → mark **`booking_completed`** as a **key event**. Do not also mark `generate_lead`, which would double count.
4. Link GA4 ↔ Google Ads (GA4 Admin → Product links). If you import GA4 key events into Ads, set the imported `booking_completed` to **Secondary**. The Ads tag conversion is already primary, and two primaries for the same booking double count.
5. Optional: import `book_call_click` as a **Secondary** conversion for observation only.

### 5b. Google Tag Manager (alternative)

Set `gtmContainerId` and leave the GA4/Ads IDs blank. The site still sets Consent Mode defaults and pushes these `dataLayer` events: `book_call_click`, `booking_completed` (with `booking_id`), `generate_lead`, `consent_update`. In GTM:
- Google tag (GA4) on *Initialization – All Pages*.
- Conversion Linker on all pages.
- Google Ads Conversion Tracking tag on *Custom Event = booking_completed*, with **Transaction ID = `{{DLV – booking_id}}`**.

If GTM Custom HTML tags need inline scripts, you'll have to loosen `script-src` in `_headers`.

**CSP note:** `_headers` sends a Content-Security-Policy allowing Google tags, Calendly and Meta. If Tag Assistant or the browser console reports a blocked request after you add a new tool, add that domain to the matching directive (`script-src`, `connect-src`, `frame-src`). Country-specific Google domains such as `www.google.co.uk` are an example.

### Consent Mode v2

- Visitors in the EEA, UK and Switzerland (resolved by Google from IP; list in `config.js`) start with `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` **denied**. Everyone else starts granted.
- A small non-blocking banner shows for visitors whose browser time zone is in Europe. "Privacy choices" in every footer reopens it for anyone.
- `url_passthrough` and `ads_data_redaction` are on, so denied-consent clicks can still be modeled.
- If counsel wants a certified CMP instead (e.g. Cookiebot, Osano), remove the banner code in `tracking.js` and let the CMP send the consent updates.

---

## 6. Calendly setup

1. **Booking questions.** Keep them short and use radio buttons, which are faster than free text:
   1. *Do you currently use QuickBooks Online?* Yes / No / Not sure
   2. *About how many transactions per month?* Under 150 / 150–300 / 300–750 / 750+ / Not sure
   3. *Are your books up to date?* Yes / 1–6 months behind / 6+ months behind / Not sure

   These three cover plan fit and catch-up needs, which is all you need to quote on the call.
2. **Confirmation page.**
   - **Paid plans (Standard and up):** *Event type → Booking page options (Confirmation page) → Redirect to an external site* → `https://getsumify.com/thank-you`, and ✅ **Pass event details to your redirected page**. Use the clean URL, not `.html`. This also tracks bookings made outside the popup, for example from an email link or the no-JS fallback.
   - **Free plan:** no redirect is available. Bookings made in the **on-page popup** are still tracked through Calendly's `event_scheduled` message, and the visitor is sent to `/thank-you`. Bookings made on calendly.com directly (fallback or new tab) can't be attributed without a redirect or webhook.
3. Don't also turn on Calendly's own Google Analytics / Ads integration and mark those as conversions. That double counts.
4. UTMs are passed into Calendly automatically (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`), so they appear in Calendly, Zapier and your CRM. `gclid` is deliberately not sent to Calendly.

---

## 7. End-to-end conversion verification checklist

Run this on the live domain with real IDs filled in, before spending money on ads.

- [ ] `https://getsumify.com/?utm_source=test&utm_campaign=check&gclid=TEST` loads. Hover a booking button: its URL contains `utm_source=test&utm_campaign=check` and **not** `gclid`.
- [ ] `http://sumify.io/x?gclid=TEST` → 301 → `https://getsumify.com/x?gclid=TEST`. Do the same for `www.getsumify.com`.
- [ ] **Google Tag Assistant** (tagassistant.google.com) connected to the site:
  - consent `default` appears **before** any `config`
  - clicking "Book a free 15-minute call" fires `book_call_click` and **no** Ads conversion
- [ ] Book a real test call in the popup. Tag Assistant shows **one** `conversion` with `transaction_id` set, plus `booking_completed`, then the page moves to `/thank-you` showing "You're on the calendar".
- [ ] Refresh `/thank-you` and press Back/Forward: **no** new conversion.
- [ ] Open `https://getsumify.com/thank-you` in a private window: neutral copy and **no** conversion.
- [ ] If Calendly redirect is enabled: book from the direct Calendly link. You land on `/thank-you?...invitee_uuid=…`, the address bar no longer shows your name or email, and one conversion fires.
- [ ] GA4 → Reports → Realtime shows `booking_completed`. Google Ads → Conversions shows the test within ~3–24 h. Cancel the test booking in Calendly afterwards.
- [ ] Phone check (iOS Safari + Android Chrome): tap every button. The popup opens and is scrollable; the sticky "Book" bar appears mid-page and hides near the final CTA.
- [ ] With an EU VPN: the banner shows. Decline, then confirm in Tag Assistant that consent is "denied".
- [ ] PageSpeed Insights (mobile) on `/` and `/catch-up-bookkeeping`.
- [ ] Google Ads → Ad → Landing page: no "destination not working" policy warnings.

### Known limits of browser-only tracking (and the server-side plan)

These are not solved in the browser and cannot be:
- **Ad blockers** stop gtag.js entirely.
- **Consent denied** produces modeled conversions, not observed ones.
- **Booking on calendly.com without a redirect** (free plan) can't be attributed.
- **GA4 counts per device:** if someone books twice on two devices, GA4 sees two leads (Ads still de-dupes).

For fully reliable, de-duplicated conversions:
1. **Calendly webhook** `invitee.created` (Calendly Standard plan or higher, created with a personal access token) → a **Cloudflare Worker** at e.g. `https://getsumify.com/api/calendly`. Store the token and webhook signing key as **Worker secrets**, never in `public/`. The Worker verifies the `Calendly-Webhook-Signature` header.
2. The Worker uploads the conversion with the **Google Ads API** (`ConversionUploadService.UploadClickConversions`):
   - `order_id` = invitee UUID, so Ads de-dupes it against the browser tag
   - `user_identifiers` = SHA-256 of the lowercase invitee email (*enhanced conversions for leads*), so conversions match even without a gclid or with blocked tags

   Secrets: developer token, OAuth client + refresh token, customer ID.
3. Optional: the same Worker sends `booking_completed` to GA4 via the Measurement Protocol (API secret as a Worker secret), with the same `booking_id`.
4. Turn on **Enhanced conversions for leads** in Google Ads → Conversions → Settings.

The current site already sends `transaction_id = invitee UUID`, so it is ready for this without changes.

---

## 8. Running QA locally

```bash
cd tools && npm install
npx serve -l 8787 ../public &      # clean URLs like Cloudflare Pages
node qa.js                         # 166 checks; screenshots in tools/.shots/
```

The suite covers:
- 5 pages × 4 viewports (375/390/768/1440): overflow, JS errors and missing assets
- axe WCAG A/AA checks
- internal links, UTM and click-ID propagation
- Calendly popup and fallback (Calendly and Google are stubbed)
- the full booking → conversion → de-duplication flow, including spoofed `postMessage` rejection
- thank-you rules and PII scrubbing
- sticky CTA, consent, keyboard access, and scans for secrets or fabricated claims

---

## 9. Content notes

- Pricing, add-ons, catch-up fee ranges, scope ("Not included") and process details are carried over from the previous site unchanged.
- The hero P&L card is the previous site's sample, still labeled "Sample report. Figures are illustrative."
- There are **no testimonials, ratings, client counts or guarantees**. A commented placeholder in `index.html` (after the trust strip) marks where to add *real*, permissioned testimonials later.
- `privacy.html` is a draft updated for the new tracking (Consent Mode, click IDs, Calendly, Cloudflare). Have your attorney review it.
