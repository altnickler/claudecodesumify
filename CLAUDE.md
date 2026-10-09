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
- Run `tools/qa.js` (and `tools/qa-lp.js` for landing pages) before pushing. See `README.md` §8.

## Creating a niche landing page
Requests look like: *"Create a new Sumify landing page targeting [INDUSTRY], businesses generating [REVENUE], with [PAIN POINT]."*

Follow `lp/README.md`. In short:
1. Create a development branch. Copy `lp/niches/template-preview.json` to `lp/niches/<slug>.json`, with `status: "draft"`, a unique `campaign.id` (e.g. `lp_<slug>_v1`), and `icp.approved: false`.
2. Put the owner's ICP values in `icp.*`. Any value they didn't give (decision-maker, revenue, Calendly event) is either asked about or written as a clearly proposed value, with `icp.revenue.approved: false`. Never present proposed criteria as confirmed policy.
3. Write copy specific to that buyer: the hero (who, problem, how), the before/after, the fit and not-fit lists, and 1–3 niche FAQs. Don't just swap the industry name into generic copy.
4. Use only verified Sumify capabilities (see `lp/README.md`, "Content rules"). If a niche implies something unverified (e.g. job costing, practice-management integrations, industry reports), handle it in an FAQ as "we'll tell you on the call whether it's in scope". Never promise it, never collect sensitive data, and never claim industry experience.
5. `node tools/lp/build.mjs`, then `tools/qa-lp.js` and `tools/qa.js`, then screenshots at 1440px and 390px. Review them visually.
6. Commit, push the branch, and report:
   - the URL `/lp/<slug>/` (and the Cloudflare branch preview);
   - every proposed or unapproved setting;
   - the Calendly questions to add manually.
7. Only after the owner approves: set `icp.approved` and `icp.revenue.approved` to true and `status: "live"`, rebuild, re-test, and merge to `main` when told to.

Never add `/lp/` pages to navigation, the footer or `sitemap.xml`, and never block `/lp/` in `robots.txt`.
