/*
 * Sumify measurement layer
 * - Google Consent Mode v2 defaults + lightweight consent banner
 * - gtag.js (GA4 + Google Ads) or Google Tag Manager, from config.js
 * - UTM / GCLID / GBRAID / WBRAID capture (first-party, consent-aware)
 * - De-duplicated booking conversion keyed on the Calendly invitee UUID
 *
 * Loaded with `defer` after config.js on every page. No inline scripts needed.
 */
(function () {
  "use strict";

  var C = window.SUMIFY_CONFIG || {};
  var useGtm = !!C.gtmContainerId;
  var useGtag = !useGtm && !!(C.ga4MeasurementId || C.googleAdsId);
  var CONSENT_KEY = "sumify_consent";          // "granted" | "denied"
  var ATTR_KEY = "sumify_attr";
  var BOOKED_PREFIX = "sumify_booked_";
  var ATTR_TTL_MS = 90 * 24 * 60 * 60 * 1000;    // matches Google Ads click-through window
  var ATTR_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid"];

  function log() {
    if (C.debug && window.console) console.log.apply(console, ["[sumify]"].concat([].slice.call(arguments)));
  }
  function store(kind) {
    try { var s = window[kind]; var k = "__t"; s.setItem(k, "1"); s.removeItem(k); return s; } catch (e) { return null; }
  }
  var local = store("localStorage");
  var session = store("sessionStorage");

  /* ------------------------------------------------------------------
   * 1. Strip personal data from the URL before any tag can read it.
   *    Calendly's "pass event details" redirect appends invitee name/email
   *    to the thank-you URL; that must never reach GA4 as page_location.
   * ------------------------------------------------------------------ */
  var PII_PARAMS = /^(invitee_email|invitee_full_name|invitee_first_name|invitee_last_name|text_reminder_number|guests|answer_\d+|invitee_payment_amount|invitee_payment_currency|assigned_to|salesforce_uuid)$/;
  var urlParams = {};
  try {
    var u = new URL(window.location.href);
    var removed = false;
    u.searchParams.forEach(function (v, k) { urlParams[k] = v; });
    Object.keys(urlParams).forEach(function (k) {
      if (PII_PARAMS.test(k)) { u.searchParams.delete(k); removed = true; }
    });
    if (removed && window.history && history.replaceState) {
      history.replaceState(history.state, "", u.pathname + (u.search ? u.search : "") + u.hash);
    }
  } catch (e) { /* very old browser: nothing to scrub that we can reach */ }

  /* ------------------------------------------------------------------
   * 2. Consent Mode v2 defaults (must run before any Google tag loads)
   * ------------------------------------------------------------------ */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  var DENIED = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" };
  var GRANTED = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" };
  function extend(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  if (C.consentRequiredRegions && C.consentRequiredRegions.length) {
    gtag("consent", "default", extend(DENIED, { region: C.consentRequiredRegions, wait_for_update: 500 }));
  }
  gtag("consent", "default", extend(GRANTED, { wait_for_update: 500 }));
  gtag("set", "ads_data_redaction", true);
  gtag("set", "url_passthrough", true);

  var storedChoice = local ? local.getItem(CONSENT_KEY) : null;
  if (storedChoice === "granted") gtag("consent", "update", GRANTED);
  if (storedChoice === "denied") gtag("consent", "update", DENIED);

  // Client-side hint only (Google resolves the real region from IP). Used to
  // decide whether to show the banner and whether we may persist identifiers.
  function likelyConsentRegion() {
    try { return /^Europe\//.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch (e) { return false; }
  }
  function storageAllowed() {
    if (storedChoice) return storedChoice === "granted";
    return !likelyConsentRegion();
  }

  /* ------------------------------------------------------------------
   * 3. Load Google tags
   * ------------------------------------------------------------------ */
  function loadScript(src) {
    var s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  if (useGtm) {
    window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
    loadScript("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(C.gtmContainerId));
    log("GTM loaded", C.gtmContainerId);
  } else if (useGtag) {
    loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(C.ga4MeasurementId || C.googleAdsId));
    gtag("js", new Date());
    if (C.ga4MeasurementId) gtag("config", C.ga4MeasurementId);      // sends page_view
    if (C.googleAdsId) gtag("config", C.googleAdsId);                // conversion linker (_gcl_* cookies)
    log("gtag loaded", C.ga4MeasurementId, C.googleAdsId);
  } else {
    log("No Google IDs configured — tracking calls are logged to dataLayer only.");
  }

  // Meta Pixel (optional). Loaded only where ad storage is allowed.
  var metaLoaded = false;
  function loadMeta() {
    if (metaLoaded || !C.metaPixelId || !storageAllowed()) return;
    metaLoaded = true;
    /* Standard Meta base code, without the inline <script>/<noscript>. */
    var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    loadScript("https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", C.metaPixelId);
    window.fbq("track", "PageView");
    log("Meta Pixel loaded", C.metaPixelId);
  }
  loadMeta();

  /* ------------------------------------------------------------------
   * 4. Attribution (UTM + click IDs)
   *    sessionStorage always (needed to hand UTMs to Calendly in-session);
   *    localStorage for 90 days only where storage is allowed.
   * ------------------------------------------------------------------ */
  function readAttr() {
    var raw = (session && session.getItem(ATTR_KEY)) || (local && local.getItem(ATTR_KEY));
    if (!raw) return null;
    try {
      var a = JSON.parse(raw);
      if (a && a.ts && Date.now() - a.ts > ATTR_TTL_MS) { if (local) local.removeItem(ATTR_KEY); return null; }
      return a;
    } catch (e) { return null; }
  }
  function writeAttr(a) {
    var raw = JSON.stringify(a);
    if (session) session.setItem(ATTR_KEY, raw);
    if (local) { if (storageAllowed()) local.setItem(ATTR_KEY, raw); else local.removeItem(ATTR_KEY); }
  }

  var incoming = {};
  var hasIncoming = false;
  ATTR_PARAMS.forEach(function (k) {
    if (urlParams[k]) { incoming[k] = String(urlParams[k]).slice(0, 200); hasIncoming = true; }
  });
  var attribution = readAttr();
  if (hasIncoming) {
    // A new ad click / tagged visit starts a new touch (last non-direct click).
    attribution = { params: incoming, landing_page: window.location.pathname, ts: Date.now() };
    writeAttr(attribution);
    log("attribution captured", attribution);
  }

  function getAttribution() { return (attribution && attribution.params) || {}; }

  /* ------------------------------------------------------------------
   * 5. Event API
   * ------------------------------------------------------------------ */
  function track(name, params) {
    params = params || {};
    // GTM / any dataLayer consumer
    window.dataLayer.push(extend({ event: name }, params));
    // gtag direct to GA4
    if (useGtag && C.ga4MeasurementId) gtag("event", name, extend(params, { send_to: C.ga4MeasurementId }));
    if (name === "book_call_click" && window.fbq) window.fbq("trackCustom", "BookClick");
    log("event", name, params);
  }

  function alreadyRecorded(id) {
    return !!((local && local.getItem(BOOKED_PREFIX + id)) || (session && session.getItem(BOOKED_PREFIX + id)));
  }
  function markRecorded(id) {
    var v = String(Date.now());
    if (local) local.setItem(BOOKED_PREFIX + id, v);   // functional: prevents duplicate conversions
    if (session) session.setItem(BOOKED_PREFIX + id, v);
  }

  /*
   * Record a CONFIRMED booking exactly once per Calendly invitee.
   * - Never called on button clicks; only on Calendly's event_scheduled
   *   message or a Calendly redirect carrying invitee_uuid.
   * - Google Ads also de-duplicates server-side on transaction_id, which
   *   covers cross-device / cleared-storage edge cases for Ads.
   * Returns a Promise that resolves when hits are sent (or after 1.5s).
   */
  function recordBooking(inviteeId, source) {
    return new Promise(function (resolve) {
      if (!inviteeId || !/^[A-Za-z0-9_-]{6,64}$/.test(inviteeId)) { log("booking ignored: bad id", inviteeId); return resolve(false); }
      if (alreadyRecorded(inviteeId)) { log("booking already recorded", inviteeId); return resolve(false); }
      markRecorded(inviteeId);

      var a = getAttribution();
      var params = {
        booking_id: inviteeId,
        booking_source: source,
        campaign_source: a.utm_source || "",
        campaign_medium: a.utm_medium || "",
        campaign_name: a.utm_campaign || "",
        campaign_term: a.utm_term || ""
      };
      track("booking_completed", params);
      track("generate_lead", extend(params, { lead_source: "calendly_discovery_call" }));

      if (window.fbq) window.fbq("track", "Lead", { content_name: "discovery_call" }, { eventID: inviteeId });

      var done = false;
      function finish() { if (!done) { done = true; resolve(true); } }
      if (useGtag && C.googleAdsId && C.googleAdsBookingLabel) {
        gtag("event", "conversion", {
          send_to: C.googleAdsId + "/" + C.googleAdsBookingLabel,
          transaction_id: inviteeId,
          event_callback: finish
        });
        log("google ads conversion", inviteeId);
      }
      setTimeout(finish, useGtag ? 1500 : 0);
    });
  }

  /* ------------------------------------------------------------------
   * 6. Consent banner (non-blocking; shown only where consent is likely
   *    required and no choice is stored; reopen via [data-consent-open])
   * ------------------------------------------------------------------ */
  function setConsent(choice) {
    storedChoice = choice;
    if (local) local.setItem(CONSENT_KEY, choice);
    gtag("consent", "update", choice === "granted" ? GRANTED : DENIED);
    if (choice === "granted" && attribution) writeAttr(attribution);
    if (choice === "granted") loadMeta();
    if (choice === "denied" && window.fbq) window.fbq("consent", "revoke");
    if (choice === "denied" && local) local.removeItem(ATTR_KEY);
    track("consent_update", { consent_choice: choice });
  }

  var banner;
  function closeBanner() {
    if (banner) banner.hidden = true;
    document.documentElement.classList.remove("consent-open");
  }
  function openBanner() {
    if (!banner) {
      banner = document.createElement("section");
      banner.className = "consent";
      banner.setAttribute("role", "region");
      banner.setAttribute("aria-label", "Cookie preferences");
      banner.innerHTML =
        '<p>We use cookies to measure our ads and improve this site. You can change this any time under “Privacy choices”. ' +
        '<a href="/privacy#cookies">Privacy policy</a></p>' +
        '<div class="consent-actions">' +
        '<button type="button" class="btn btn-primary" data-consent="granted">Accept</button>' +
        '<button type="button" class="btn btn-secondary" data-consent="denied">Decline</button>' +
        "</div>";
      banner.addEventListener("click", function (e) {
        var t = e.target.closest("[data-consent]");
        if (!t) return;
        setConsent(t.getAttribute("data-consent"));
        closeBanner();
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
    document.documentElement.classList.add("consent-open");
  }

  function initUi() {
    if (!storedChoice && likelyConsentRegion()) openBanner();
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-consent-open]");
      if (!t) return;
      e.preventDefault();
      openBanner();
      var first = banner.querySelector("button");
      if (first) first.focus();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUi);
  else initUi();

  window.Sumify = {
    config: C,
    track: track,
    recordBooking: recordBooking,
    getAttribution: getAttribution,
    urlParams: urlParams,
    setConsent: setConsent,
    log: log
  };
})();
