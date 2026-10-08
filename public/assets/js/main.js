/*
 * Sumify page behaviour
 * - Booking CTAs: Calendly popup (lazy-loaded on intent) with direct-link fallback
 * - Calendly embed events -> funnel events + de-duplicated booking conversion
 * - Sticky mobile CTA
 *
 * Every booking button is a real <a href="https://calendly.com/..."> link, so
 * booking still works with JavaScript disabled or if Calendly's script fails.
 */
(function () {
  "use strict";

  var C = window.SUMIFY_CONFIG || {};
  var S = window.Sumify || { track: function () {}, recordBooking: function () { return Promise.resolve(false); }, getAttribution: function () { return {}; }, log: function () {} };
  var CALENDLY_ORIGIN = "https://calendly.com";
  var WIDGET_JS = "https://assets.calendly.com/assets/external/widget.js";
  var WIDGET_CSS = "https://assets.calendly.com/assets/external/widget.css";
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  /* ---------- Booking URL (carries UTMs into Calendly's own reporting) ---------- */
  function bookingUrl() {
    var base = C.calendlyUrl || "https://calendly.com/alex-atlanticbay/15min";
    try {
      var u = new URL(base);
      var a = S.getAttribution();
      UTM_KEYS.forEach(function (k) { if (a[k]) u.searchParams.set(k, a[k]); });
      return u.toString();
    } catch (e) { return base; }
  }

  /* ---------- Lazy Calendly loader ---------- */
  var calendlyPromise = null;
  function loadCalendly() {
    if (window.Calendly && window.Calendly.initPopupWidget) return Promise.resolve(window.Calendly);
    if (calendlyPromise) return calendlyPromise;
    calendlyPromise = new Promise(function (resolve, reject) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = WIDGET_CSS;
      document.head.appendChild(css);
      var s = document.createElement("script");
      s.src = WIDGET_JS;
      s.async = true;
      s.onload = function () { window.Calendly ? resolve(window.Calendly) : reject(new Error("Calendly missing")); };
      s.onerror = function () { calendlyPromise = null; reject(new Error("Calendly failed to load")); };
      document.head.appendChild(s);
    });
    return calendlyPromise;
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, ms); })]);
  }

  /* ---------- CTA wiring ---------- */
  function ctaLabel(el) { return (el.getAttribute("data-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100); }

  function onCtaClick(e) {
    var el = e.currentTarget;
    var url = bookingUrl();
    el.href = url;
    var params = {
      cta_location: el.getAttribute("data-book") || "unknown",
      cta_text: ctaLabel(el),
      page_path: window.location.pathname
    };

    // New tab / modified click: let the browser handle it, just record intent.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      S.track("book_call_click", Object.assign({ open_mode: "new_tab" }, params));
      return;
    }

    e.preventDefault();
    S.track("book_call_click", Object.assign({ open_mode: "popup" }, params));
    el.setAttribute("aria-busy", "true");

    withTimeout(loadCalendly(), 4000)
      .then(function (Calendly) {
        Calendly.initPopupWidget({ url: url });
      })
      .catch(function (err) {
        S.log("Calendly popup unavailable, opening direct link", err && err.message);
        S.track("booking_popup_fallback", params);
        window.location.href = url;
      })
      .then(function () { el.removeAttribute("aria-busy"); });
  }

  function preload() { loadCalendly().catch(function () {}); }

  function initCtas() {
    var ctas = document.querySelectorAll("a[data-book]");
    var url = bookingUrl();
    for (var i = 0; i < ctas.length; i++) {
      var el = ctas[i];
      el.href = url;
      el.addEventListener("click", onCtaClick);
      // Warm the Calendly script only when someone shows intent to book.
      el.addEventListener("pointerenter", preload, { once: true, passive: true });
      el.addEventListener("touchstart", preload, { once: true, passive: true });
      el.addEventListener("focus", preload, { once: true });
    }

    document.addEventListener("click", function (e) {
      var m = e.target.closest && e.target.closest('a[href^="mailto:"]');
      if (m) S.track("contact_email_click", { page_path: window.location.pathname });
    });
  }

  /* ---------- Calendly embed events ---------- */
  function inviteeIdFromUri(uri) {
    // https://api.calendly.com/scheduled_events/<event>/invitees/<invitee_uuid>
    if (!uri || typeof uri !== "string") return "";
    var parts = uri.split("?")[0].replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || "";
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== CALENDLY_ORIGIN || !e.data || typeof e.data.event !== "string" || e.data.event.indexOf("calendly.") !== 0) return;
    var name = e.data.event;
    var payload = e.data.payload || {};

    if (name === "calendly.event_type_viewed") S.track("booking_widget_viewed", { page_path: window.location.pathname });
    if (name === "calendly.date_and_time_selected") S.track("booking_time_selected", { page_path: window.location.pathname });

    if (name === "calendly.event_scheduled") {
      // The ONLY place on the landing pages a booking conversion is recorded.
      var id = inviteeIdFromUri(payload.invitee && payload.invitee.uri);
      S.recordBooking(id, "calendly_embed").then(function () {
        if (C.redirectAfterEmbedBooking && id) {
          window.location.href = "/thank-you?invitee_uuid=" + encodeURIComponent(id) + "&via=embed";
        }
      });
    }
  });

  /* ---------- Sticky mobile CTA ---------- */
  function initSticky() {
    var bar = document.querySelector(".sticky-cta");
    var hero = document.getElementById("hero-cta");
    var finalSection = document.getElementById("book");
    if (!bar || !hero || !("IntersectionObserver" in window)) return;
    var heroVisible = true, finalVisible = false;
    function update() {
      var show = !heroVisible && !finalVisible;
      bar.classList.toggle("is-visible", show);
      bar.setAttribute("aria-hidden", show ? "false" : "true");
      var link = bar.querySelector("a");
      if (link) link.tabIndex = show ? 0 : -1;
    }
    new IntersectionObserver(function (entries) { heroVisible = entries[0].isIntersecting; update(); }).observe(hero);
    if (finalSection) new IntersectionObserver(function (entries) { finalVisible = entries[0].isIntersecting; update(); }).observe(finalSection);
    update();
  }

  function init() { initCtas(); initSticky(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
