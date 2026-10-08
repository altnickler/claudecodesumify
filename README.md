# Sumify site: deploy guide

Files: index.html, thank-you.html, privacy.html, logo.png. No build step. It is a static site.

## 1. Fill in the placeholders (about 10 minutes)

**Booking link.** Already set to https://calendly.com/alex-atlanticbay/15min in index.html (3 places).
- In the Calendly event, add two booking questions: "Do you use QuickBooks Online?" and "How far behind are your books?"
- Once getsumify.com is live, set the event to redirect to https://getsumify.com/thank-you.html after booking. Check that your Calendly plan includes redirect-after-booking, since it may be a paid feature.
- If you change the link later, find and replace the old link in index.html.

**Email.** The site shows info@getsumify.com (index.html and privacy.html). Create that address on your email provider, or change it to the one you use.

**Tracking.** Search each file for "TRACKING SLOT" and "CONVERSION SLOT" and paste the snippets Google and Meta give you.
- index.html and thank-you.html: the Google tag and Meta Pixel base code go in the head, where marked.
- thank-you.html: the conversion events go where marked. This page loads after a booking, so it is what counts a lead.

**UTM tags.** index.html already saves utm_source, utm_medium, utm_campaign, utm_content and utm_term from the ad URL and adds them to every Calendly link, so each booking arrives labeled. Use the final-URL patterns in the Automation Spec (section 5). Test by opening https://getsumify.com/?utm_source=test&utm_campaign=check and clicking Book a call; the Calendly URL should contain those values.
- The thank-you page sends a generate_lead event to Google and a Lead event to Meta once per visit. For Google Ads, uncomment the conversion line in thank-you.html and fill in your conversion ID and label.
- Calendly must pass tracking data through to Zapier; it does this for utm_* values automatically.

**Privacy policy.** privacy.html is a draft template. Have your attorney review it before you run ads.

## 2. Deploy

Easiest: Netlify Drop (app.netlify.com/drop). Drag the whole folder onto the page and you get a live URL. Cloudflare Pages (direct upload) works the same way. Both are free at your traffic level.

## 3. Connect the domains

1. Add getsumify.com as the site's custom domain in your host and follow its DNS instructions. Make sure it is served over HTTPS.
2. Add sumify.io to the host as a domain alias, or set a permanent (301) redirect from sumify.io to https://getsumify.com. Cloudflare redirect rules and Netlify domain settings both support this.
3. Add SPF, DKIM and DMARC records for both domains using the values your email provider gives you.

## 4. Test before spending on ads

- Open the live site on your phone. Tap every button.
- Book a test call. Confirm the invite arrives, the thank-you page loads, and your conversion shows up in Google Ads and Meta (it can take a few hours).
- Visit sumify.io and confirm it lands on getsumify.com.
