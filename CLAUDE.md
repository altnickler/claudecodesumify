# Sumify website: instructions for Claude Code

Static site for getsumify.com, deployed by Cloudflare Pages from GitHub. Output dir: `public/`. There is no build step on Cloudflare.

## Branches and publishing
- `main` is **production**: every push deploys the live site.
- Do all work on a development branch, push it, and report the branch preview. **Never merge to `main` until the owner explicitly approves.** When they approve publishing, merge into `main` with a normal merge and push. Never force-push or rewrite history.
- Never commit secrets, `.env` files, `dist/` or `node_modules/`.

## Must stay true
- Booking CTAs on the main site open Calendly. Conversions fire **only** on a confirmed booking (`calendly.event_scheduled` or a Calendly redirect with `invitee_uuid`), de-duplicated per invitee. A click or a selected time is never a conversion.
- Don't change the homepage's look when working on other pages. `public/assets/css/styles.css` is shared by production pages.
- No fabricated testimonials, ratings, client counts, results, credentials, guarantees or industry expertise.
- Run `tools/qa.js` (and `tools/qa-trucking.js` for the landing page) before pushing. See `README.md` §8.

## Google Ads landing pages (`/lp/`)
- There is ONE landing page: `public/lp/owner-operator-trucking/index.html` (owner-operators with 1–3 trucks). It's hand-written static HTML with page-only styles in `public/assets/css/lp-trucking.css` and the inline scheduler in `public/assets/js/lp-calendly.js`. There's no generator or template system. Don't create other niche pages unless the owner asks for a specific one.
- Fixed structure: hero → inline Calendly → before/after (3 + 3) → who it's for (3) → who it's not for (3) → FAQ (max 4, ending in one quiet "Pick a time ↑" link) → legal footer. One conversion: the free 15-minute call. Keep it restrained: no site navigation, header links, sticky bar, offer cards, pricing table, services catalog, repeated pricing or extra paragraphs.
- Landing pages are unlisted: `noindex, follow` (meta + `_headers` for `/lp/*`), never in `sitemap.xml`, navigation or the footer, and never blocked in `robots.txt` (AdsBot must crawl).
- Don't claim IFTA, DOT compliance, fuel-tax, dispatch or per-truck analytics services. Don't invent testimonials, results or ratings.
- Tests: `tools/qa-trucking.js` plus `tools/qa.js`.
- `functions/index.js` redirects "/" to the trucking page **only** on the `claude-sumify-niche*.sumify.pages.dev` branch preview. Every other host passes through, so production is unaffected. Delete it once the page is approved and before merging, since it's no longer needed then.
