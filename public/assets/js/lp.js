/*
 * Sumify niche landing pages (/lp/*): inline Calendly scheduler.
 *
 * - Loads Calendly's official widget on page load and mounts the INLINE
 *   scheduler in #lp-calendly (no popup, no click required).
 * - Passes campaign attribution into Calendly: incoming UTMs are preserved;
 *   missing utm_content / utm_campaign are filled with this page's labels so
 *   bookings can be told apart in Calendly reports.
 * - Shows a fallback (direct scheduler link) if the widget can't load.
 * - Booking events (calendly.event_scheduled) are handled by main.js, which
 *   records ONE de-duplicated conversion and redirects to /thank-you.
 *   Nothing in this file records a conversion.
 */
(function () {
  "use strict";

  var S = window.Sumify || { track: function () {}, getAttribution: function () { return {}; }, log: function () {} };
  var WIDGET_JS = "https://assets.calendly.com/assets/external/widget.js";
  var WIDGET_CSS = "https://assets.calendly.com/assets/external/widget.css";
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  var body = document.body;
  var slug = body.getAttribute("data-lp") || "";
  var campaign = body.getAttribute("data-lp-campaign") || "";
  var mount = document.getElementById("lp-calendly");
  var loading = document.getElementById("lp-cal-loading");
  var failed = document.getElementById("lp-cal-failed");

  function camel(k) { return k.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function utm() {
    var a = S.getAttribution() || {};
    var out = {};
    UTM_KEYS.forEach(function (k) { if (a[k]) out[k] = a[k]; });
    if (!out.utm_content && slug) out.utm_content = "lp_" + slug;
    if (!out.utm_campaign && campaign) out.utm_campaign = campaign;
    return out;
  }

  function schedulerUrl(base) {
    try {
      var u = new URL(base);
      var t = utm();
      Object.keys(t).forEach(function (k) { u.searchParams.set(k, t[k]); });
      u.searchParams.set("hide_gdpr_banner", "0");
      u.searchParams.set("primary_color", "087f8c");
      return u.toString();
    } catch (e) { return base; }
  }

  function showFailed() {
    if (loading) loading.hidden = true;
    if (failed) failed.hidden = false;
    S.track("booking_embed_failed", { page_path: location.pathname });
  }

  // Give the scheduler iframe an accessible name if Calendly didn't.
  function titleFrame(n) {
    var f = mount.querySelector("iframe");
    if (f) { if (!f.getAttribute("title")) f.setAttribute("title", "Calendly scheduler: pick a time for your free 15-minute call"); return; }
    if (n < 40) setTimeout(function () { titleFrame(n + 1); }, 100);
  }

  function mountWidget() {
    if (!mount) return;
    var base = mount.getAttribute("data-url");
    var url = schedulerUrl(base);
    // Keep every direct scheduler link in sync with the attributed URL.
    var links = document.querySelectorAll("[data-lp-fallback]");
    for (var i = 0; i < links.length; i++) links[i].href = url;

    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = WIDGET_CSS;
    document.head.appendChild(css);

    var done = false;
    var timer = setTimeout(function () { if (!done) showFailed(); }, parseInt(mount.getAttribute("data-timeout") || "10000", 10));

    var s = document.createElement("script");
    s.src = WIDGET_JS; s.async = true;
    s.onload = function () {
      if (!window.Calendly || !window.Calendly.initInlineWidget) { done = true; clearTimeout(timer); showFailed(); return; }
      var t = utm(), u = {};
      Object.keys(t).forEach(function (k) { u[camel(k)] = t[k]; });
      window.Calendly.initInlineWidget({ url: url, parentElement: mount, utm: u, resize: true });
      titleFrame(0);
    };
    s.onerror = function () { done = true; clearTimeout(timer); showFailed(); };
    document.head.appendChild(s);

    // The scheduler is "ready" once Calendly reports the event type view.
    window.addEventListener("message", function (e) {
      if (e.origin !== "https://calendly.com" || !e.data || typeof e.data.event !== "string") return;
      if (e.data.event === "calendly.event_type_viewed" || e.data.event === "calendly.profile_page_viewed") {
        done = true; clearTimeout(timer);
        if (loading) loading.hidden = true;
        if (failed) failed.hidden = true;
      }
      if (e.data.event === "calendly.page_height" && e.data.payload && e.data.payload.height) {
        var h = parseInt(e.data.payload.height, 10);
        if (h > 400 && h < 2400) mount.style.height = h + "px";
      }
    });
  }

  function initCtas() {
    // "Pick a time" buttons scroll to the scheduler. They are interactions,
    // never conversions.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-lp-cta]");
      if (a) S.track("lp_cta_click", { cta_location: a.getAttribute("data-lp-cta"), page_path: location.pathname });
      var f = e.target.closest && e.target.closest("[data-lp-fallback]");
      if (f) S.track("booking_fallback_click", { cta_location: f.getAttribute("data-lp-fallback"), page_path: location.pathname });
    });
  }

  function init() {
    S.track("lp_view", { page_path: location.pathname });
    initCtas();
    mountWidget();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
