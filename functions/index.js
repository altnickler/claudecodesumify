/*
 * Cloudflare Pages Function for the "/" route ONLY (file-based routing:
 * functions/index.js matches exactly "/").
 *
 * Purpose: make this branch's preview URL
 *   https://claude-sumify-niche-landing.sumify.pages.dev/
 * open directly on the trucking landing page for review.
 *
 * Safety: it redirects only when the hostname is a preview alias of the
 * landing-page branch. Every other host (getsumify.com, www, sumify.pages.dev,
 * other branch previews) passes straight through to the static homepage, so
 * production behaviour is unchanged even if this file is merged.
 * Remove it once the landing page is approved (see CLAUDE.md).
 */
const PREVIEW_HOST = /^claude-sumify-niche[a-z0-9-]*\.sumify\.pages\.dev$/;
const TARGET = "/lp/owner-operator-trucking/";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname === "/" && PREVIEW_HOST.test(url.hostname)) {
    return Response.redirect(new URL(TARGET + url.search, url.origin).toString(), 302);
  }
  return context.next();
}
