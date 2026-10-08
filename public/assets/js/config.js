/*
 * Sumify site configuration — the ONLY file you need to edit for integrations.
 *
 * Everything here is public by design (it ships to the browser). Never put
 * API keys, Calendly personal access tokens, webhook signing keys or Google
 * Ads developer tokens in this file.
 *
 * Leave an ID as an empty string to disable that integration. The site works
 * (and every booking button still opens Calendly) with all IDs empty.
 */
window.SUMIFY_CONFIG = {
  // Calendly event type used by every "Book a free 15-minute call" button.
  calendlyUrl: "https://calendly.com/alex-atlanticbay/15min",

  // ---- Google tags ------------------------------------------------------
  // Option A (recommended for this site): gtag.js directly. Fill these in.
  ga4MeasurementId: "",          // e.g. "G-XXXXXXXXXX"   (GA4 > Admin > Data streams)
  googleAdsId: "",               // e.g. "AW-1234567890"  (Google Ads > Goals > Conversions > tag setup)
  googleAdsBookingLabel: "",     // e.g. "AbCdEfGhIjKlMnOp" — label of the "Booked discovery call" conversion action

  // Option B: Google Tag Manager. If set, gtag.js is NOT loaded by this site;
  // GTM receives the same dataLayer events (book_call_click, booking_completed,
  // generate_lead) and you configure GA4/Ads tags inside GTM instead.
  gtmContainerId: "",            // e.g. "GTM-XXXXXXX"

  // Optional: Meta Pixel (from your previous site's setup). Loaded only when
  // ad storage is allowed. Fires PageView, BookClick (custom) and Lead — Lead
  // ONLY on a confirmed booking, with eventID = Calendly invitee UUID so it can
  // be de-duplicated against a future Conversions API integration.
  metaPixelId: "",               // e.g. "123456789012345"

  // ---- Consent Mode v2 --------------------------------------------------
  // Visitors in these regions (ISO 3166-1/2 codes, resolved by Google from IP)
  // start with ad/analytics storage DENIED until they accept the banner.
  // Everyone else starts GRANTED and can opt out via "Privacy choices".
  // Have your counsel confirm this matches your obligations.
  consentRequiredRegions: [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
    "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO",
    "SK", "SI", "ES", "SE", "CH", "GB"
  ],

  // ---- Booking flow -----------------------------------------------------
  // After a booking completes inside the on-page Calendly popup, send the
  // visitor to /thank-you with next steps. The conversion is recorded before
  // navigating and is de-duplicated, so this never double counts.
  redirectAfterEmbedBooking: true,

  // Log tracking calls to the browser console (useful with Tag Assistant).
  debug: false
};
