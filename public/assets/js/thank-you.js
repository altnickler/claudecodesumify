/*
 * Thank-you page logic.
 *
 * Records a booking conversion ONLY when the URL carries a Calendly invitee
 * UUID, which arrives either from:
 *   - Calendly's "redirect after booking" with "pass event details" enabled
 *     (paid Calendly plans), or
 *   - our own on-page popup handler (main.js) after calendly.event_scheduled.
 * Plain visits, refreshes and bookmarks record nothing. Each invitee UUID is
 * recorded at most once per browser, and Google Ads also de-duplicates on
 * transaction_id.
 *
 * Personal fields (name, email) were already stripped from the URL by
 * tracking.js before any tag ran; we only read them from memory for display.
 */
(function () {
  "use strict";
  var S = window.Sumify;
  if (!S) return;
  var p = S.urlParams || {};
  var id = p.invitee_uuid || "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return;   // neutral state stays

  function each(sel, fn) { var els = document.querySelectorAll(sel); for (var i = 0; i < els.length; i++) fn(els[i]); }
  each('[data-state="neutral"]', function (el) { el.hidden = true; });
  each('[data-state="confirmed"]', function (el) { el.hidden = false; });

  var first = (p.invitee_first_name || (p.invitee_full_name || "").split(" ")[0] || "").trim().slice(0, 40);
  if (first) each("[data-first-name]", function (el) { el.textContent = ", " + first; });

  if (p.event_start_time) {
    var d = new Date(p.event_start_time);
    if (!isNaN(d)) {
      var el = document.querySelector("[data-start-time]");
      try {
        el.textContent = "Your call: " + d.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
      } catch (e) { el.textContent = "Your call: " + d.toString(); }
      el.hidden = false;
    }
  }

  S.recordBooking(id, p.via === "embed" ? "calendly_embed" : "calendly_redirect");
})();
