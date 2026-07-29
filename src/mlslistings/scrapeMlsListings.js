/**
 * Pulls the listing agent's name/phone/email off MLSListings Pro
 * Dashboard (https://prodashboard.mlslistings.com/), searched by
 * property address. This is the authoritative, at-the-source contact:
 * the agent's details are on the MLS listing itself, so we never have to
 * scrape Redfin for them. Uses an already-logged-in persistent browser
 * profile (see scripts/login-mlslistings.js) -- this module never
 * handles credentials or login itself.
 *
 * COMPLIANCE: this runs against our OWN authenticated MLSListings
 * subscription, pulling listing-agent contact info that the MLS provides
 * to members to facilitate transactions. Keep it to that use -- reasonable
 * rate limits (MLS_SCRAPE_DELAY_MS), one lead at a time, no bulk export
 * or redistribution beyond our outreach. Respect MLSListings' Terms of
 * Use; stop and surface anything that looks like a block rather than
 * working around it.
 *
 * SELECTORS ARE NOT YET VERIFIED against the live logged-in pages. Every
 * spot that needs a real selector/label from the actual UI is marked
 * `TODO(selectors)`. The extraction helper (extractAgentContact) is pure,
 * text-pattern based, and unit-tested; the navigation helpers are the
 * part to confirm once someone inspects the pages while logged in.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { cleanAddress } = require('../../shared/contactValidation');

const MLS_PROFILE_DIR = '.mlslistings-profile';
// Failure screenshots land here (gitignored) so a broken run leaves a
// diagnosable image instead of just a stack trace.
const MLS_DEBUG_DIR = path.join(__dirname, '..', '..', '.mls-debug');

// Phrases that only appear when the session has dropped back to a login
// screen. Used to fail loudly ("go log in") instead of silently
// returning empty contact info. TODO(selectors): confirm against the
// real MLSListings sign-in page and tighten if needed.
function looksLoggedOut(pageText) {
  const t = String(pageText || '');
  return /sign\s*in|log\s*in|username|password/i.test(t) && !/sign\s*out|log\s*out/i.test(t);
}

// --- Pure extraction --------------------------------------------------

const PHONE_RE = /(?:\(\d{3}\)\s?|\d{3}[.\-\s])\d{3}[.\-\s]?\d{4}/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// Confirmed via a live recorded flow (2026-07-29, real listing 807
// Teresita Blvd / Michael Freethy): the Matrix detail page does NOT use
// one shared "Contact Information" block -- the listing AGENT's name,
// phone, and email each sit right after their own short label:
//   "LA:"     -> agent name        (e.g. "Michael Freethy")
//   "LA Lic#:" -> agent DRE/license number
//   "LA Ph:"  -> agent phone       (e.g. "(415) 823-7917")
//   "LA Em:"  -> agent email, as a mailto link (e.g. "mfreethy@yahoo.com")
// "LO:" / "LO Ph:" are the listing OFFICE/brokerage, not the agent --
// never read those for agentName/agentPhone/agentEmail.
const SHORT_FIELD_LABELS = { name: 'LA:', phone: 'LA Ph:', email: 'LA Em:' };

// Fallback block labels, kept in case a different Matrix layout/page
// (e.g. a different MLS board config) doesn't use the short LA:/LA Ph:
// labels above -- order matters, first one found wins.
const AGENT_LABELS = ['Contact Information', 'Listing Agent', 'List Agent', 'Listing Member', 'Presented By'];

/** Reads the short text immediately following an exact label like "LA Ph:". */
function extractAfterShortLabel(text, label, windowChars) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idx = text.search(new RegExp(escaped));
  if (idx === -1) return '';
  return text.slice(idx + label.length, idx + label.length + windowChars);
}

/**
 * Pulls { agentName, agentPhone, agentEmail } out of a listing detail
 * page's visible text. Tries the confirmed short per-field labels
 * first (SHORT_FIELD_LABELS -- "LA:"/"LA Ph:"/"LA Em:", each read
 * independently since they aren't grouped in one block); falls back
 * to scanning a block after a broader AGENT_LABELS anchor for a
 * differently-laid-out page. Mirrors the text-pattern approach used
 * for REI BlackBook (class names on these apps are build-generated
 * and unstable, so visible-text anchors are sturdier than CSS
 * selectors). Returns blanks for anything not found -- never throws
 * on a merely-incomplete page.
 *
 * `opts.labels` overrides AGENT_LABELS; `opts.windowChars` the slice size.
 */
function extractAgentContact(pageText, opts = {}) {
  const text = String(pageText || '');
  const windowChars = opts.windowChars || 150;

  const shortName = extractAfterShortLabel(text, SHORT_FIELD_LABELS.name, windowChars).trim().split(/\n+/)[0] || '';
  const shortPhoneText = extractAfterShortLabel(text, SHORT_FIELD_LABELS.phone, windowChars);
  const shortEmailText = extractAfterShortLabel(text, SHORT_FIELD_LABELS.email, windowChars);
  const shortPhoneMatch = shortPhoneText.match(PHONE_RE);
  const shortEmailMatch = shortEmailText.match(EMAIL_RE);

  if (shortName || shortPhoneMatch || shortEmailMatch) {
    return {
      agentName: shortName,
      agentPhone: shortPhoneMatch ? shortPhoneMatch[0] : '',
      agentEmail: shortEmailMatch ? shortEmailMatch[0] : ''
    };
  }

  // Fallback: broader block-scan for a differently-laid-out page.
  const labels = opts.labels || AGENT_LABELS;
  const blockWindow = opts.windowChars || 400;
  let start = -1;
  let labelLen = 0;
  for (const label of labels) {
    const idx = text.search(new RegExp(label, 'i'));
    if (idx !== -1 && (start === -1 || idx < start)) {
      start = idx;
      labelLen = label.length;
    }
  }
  const slice = start === -1 ? text : text.slice(start + labelLen, start + labelLen + blockWindow);

  const phoneMatch = slice.match(PHONE_RE) || (start !== -1 ? text.match(PHONE_RE) : null);
  const emailMatch = slice.match(EMAIL_RE) || (start !== -1 ? text.match(EMAIL_RE) : null);

  let agentName = '';
  if (start !== -1) {
    const lines = slice.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    agentName = lines.find((l) =>
      !PHONE_RE.test(l) && !EMAIL_RE.test(l) &&
      !labels.some((lab) => new RegExp('^' + lab, 'i').test(l))
    ) || '';
  }

  return {
    agentName,
    agentPhone: phoneMatch ? phoneMatch[0] : '',
    agentEmail: emailMatch ? emailMatch[0] : ''
  };
}

// --- Navigation (wired from a live recording of the real flow) --------
// Login is Azure B2C (Username/Password/Sign in) with a concurrent-session
// gate ("End Oldest Inactive Session"). Search is a multi-field address
// FORM (Street Number / Street Name / City / Zip) at Matrix Default.aspx;
// results list each listing under an ML# link (e.g. "SF426146208"); the
// detail page shows the agent under "Contact Information".

async function debugShot(page, name) {
  try {
    fs.mkdirSync(MLS_DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: path.join(MLS_DEBUG_DIR, name + '.png'), fullPage: true });
  } catch (err) { /* screenshots are best-effort */ }
}

// Confirmed live (2026-07-29): Matrix's "Street Name" field does a
// "starts with" match against the base street name ONLY -- passing
// the full "Teresita Blvd" (suffix included) into it returned "No
// Listings were found" for a real, existing listing. Strip the
// trailing suffix so the search field gets just "Teresita".
const STREET_SUFFIX_RE = /\s+(blvd|boulevard|ave|avenue|st|street|dr|drive|rd|road|ln|lane|way|ct|court|pl|place|ter|terrace|cir|circle|pkwy|parkway|hwy|highway)\.?$/i;

/**
 * Splits a street address (+ optional city, and optionally explicit
 * zip/beds/baths/sqft -- all already present as their own columns on
 * a real Flip Scout Leads row, not something that needs guessing)
 * into the Matrix search form fields.
 */
function parseAddressParts(address, city, opts = {}) {
  const clean = cleanAddress(address);
  const zip = cleanAddress(opts.zip || '') || (clean.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1] || '';
  const streetNumber = (clean.match(/^\s*(\d+)\s+/) || [])[1] || '';
  let streetName = clean.replace(/^\s*\d+\s+/, '').split(',')[0];
  streetName = streetName.replace(/\b\d{5}\b.*$/, '').trim();
  streetName = streetName.replace(STREET_SUFFIX_RE, '').trim();
  return {
    streetNumber: streetNumber,
    streetName: streetName,
    city: cleanAddress(city || '').split(',')[0],
    zip: zip,
    beds: opts.beds != null ? String(opts.beds) : '',
    baths: opts.baths != null ? String(opts.baths) : '',
    sqft: opts.sqft != null ? String(opts.sqft) : ''
  };
}

// Azure B2C's own domains -- confirmed live (2026-07-29) that right
// after a fresh process launch redirects here, the SPA can take a beat
// to render the actual username/password fields; in that gap
// page.innerText('body') is near-blank and doesn't match any of
// looksLoggedOut()'s sign-in keywords, so a text-only check wrongly
// concludes "not logged out" and skips the login form entirely. The
// URL itself is a reliable, immediate signal that doesn't have this
// race -- being on this domain always means a login is required.
const LOGIN_DOMAIN_RE = /b2clogin\.com|mlsllogin\.mlslistings\.com/i;

/**
 * Ensures the persistent session is authenticated. If a login page is
 * showing, signs in with MLS_USERNAME/MLS_PASSWORD from .env (read fresh)
 * and clears the concurrent-session gate. Auto-login always -- per the
 * operator's instruction -- so a batch run never stalls on a dropped
 * session. Throws only if the login page is shown but no creds are set.
 */
async function ensureLoggedIn(page) {
  const text = await page.innerText('body').catch(() => '');
  if (!looksLoggedOut(text) && !LOGIN_DOMAIN_RE.test(page.url())) return true;

  const user = config.liveEnvValue('MLS_USERNAME');
  const pass = config.liveEnvValue('MLS_PASSWORD');
  if (!user || !pass) {
    throw new Error('MLSListings shows a login page but MLS_USERNAME/MLS_PASSWORD are not set in .env for auto-login.');
  }
  const username = page.getByRole('textbox', { name: /Username/i }).first();
  await username.waitFor({ state: 'visible', timeout: 20000 });
  await username.fill(user);
  await page.getByRole('textbox', { name: /Password/i }).first().fill(pass);
  await page.getByRole('button', { name: /^Sign in$/i }).first().click();

  // Azure B2C does a multi-hop redirect back to the dashboard after
  // Sign in -- a single fixed wait isn't reliable (confirmed live: a
  // 6s wait left the page on an intermediate screen that doesn't
  // itself look "logged out", so looksLoggedOut() passed while the
  // real dashboard -- and its "Quick Action link for Matrix Search"
  // link -- hadn't rendered yet). Poll instead: click through the
  // concurrent-session gate whenever it shows up, and keep going
  // until the dashboard's own quick-action link actually appears.
  const dashboardReady = () => page.getByRole('link', { name: /Quick Action link for Matrix Search/i }).first().count().catch(() => 0);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await dashboardReady()) return true;
    const endBtn = page.getByRole('button', { name: /End Oldest Inactive Session/i }).first();
    if (await endBtn.count().catch(() => 0)) {
      await endBtn.click();
    }
    await page.waitForTimeout(2000);
  }
  return true;
}

/**
 * Opens the real Matrix search interface -- confirmed via TWO separate
 * live recordings (2026-07-29) that this is NOT a directly-navigable
 * URL. Matrix's own search-page URLs are session-tied deep links that
 * show "Error: URL is Old" once the session that generated them ends
 * (confirmed live) -- there is no stable URL to just goto(). The real,
 * repeatable path is: from the Pro Dashboard, click the link named
 * "Quick Action link for Matrix Search", which opens Matrix in a NEW
 * POPUP window. Every subsequent step (search form, results, ML#
 * detail page) happens in that popup, not the original page -- a
 * previous version of this file tried to run the whole flow on the
 * original `page` and never worked because of exactly this.
 */
async function openMatrixSearchPopup(page) {
  const popupPromise = page.waitForEvent('popup', { timeout: 20000 });
  await page.getByRole('link', { name: /Quick Action link for Matrix Search/i }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(2000);

  // The popup can land on a "To home page" splash first, per the
  // recording -- dismiss it if present so the search form is visible.
  const homeLink = popup.getByRole('link', { name: /To home page/i }).first();
  if (await homeLink.count().catch(() => 0)) {
    await homeLink.click();
    await popup.waitForTimeout(2000);
  }
  return popup;
}

async function clearField(page, nameRe) {
  const box = page.getByRole('textbox', { name: nameRe }).first();
  if (await box.count().catch(() => 0)) {
    await box.fill('').catch(() => {});
    // This legacy WebForms UI live-recomputes its match count (and its
    // hidden postback state) off each field's blur/change event, not
    // the raw value -- fill() alone can leave that stale, so tab out
    // to force it before anything reads the count or navigates.
    await box.press('Tab').catch(() => {});
  }
}

async function submitSearch(page) {
  // Submit: the recorded button id first, then robust fallbacks.
  const byId = page.locator('#m_wm_w11_m_btnSearch');
  if (await byId.count().catch(() => 0)) {
    await byId.click();
  } else {
    const btn = page.getByRole('button', { name: /^Search$/i }).first();
    if (await btn.count().catch(() => 0)) await btn.click();
    else await page.locator('input[type="submit"][value*="Search" i], a[id*="btnSearch"]').first().click().catch(() => {});
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(4000);
}

/**
 * Parses the "Found N results" / "No Listings were found" line Matrix
 * prints on its results page. Returns a count, or null when neither
 * phrase is present -- confirmed live (2026-07-29) that this can happen
 * when the search click doesn't actually navigate off the entry form
 * (a rare timing flake), which must be treated as "unknown, retry" and
 * never as "some results", or a stuck search gets silently misread as
 * a hit with no listing detail to show for it.
 */
function resultsFoundCount(text) {
  const t = String(text || '');
  const m = t.match(/Found (\d+) results?/i);
  if (m) return parseInt(m[1], 10);
  if (/No Listings were found/i.test(t)) return 0;
  return null;
}

/** Fills the Matrix address search form and submits it. */
async function fillAddressSearch(page, parts) {
  const fill = async (nameRe, value) => {
    if (!value) return;
    const box = page.getByRole('textbox', { name: nameRe }).first();
    if (await box.count()) { await box.click().catch(() => {}); await box.fill(value); }
  };
  await fill(/Street Number/i, parts.streetNumber);
  await fill(/Street Name/i, parts.streetName);
  await fill(/City/i, parts.city);
  // City often shows an autocomplete cell -- click it if it appears.
  if (parts.city) {
    const cityCell = page.getByRole('cell', { name: parts.city, exact: true }).first();
    if (await cityCell.count().catch(() => 0)) await cityCell.click().catch(() => {});
  }
  await fill(/Zip Code/i, parts.zip);
  // Beds/baths/sqft: confirmed live to matter for getting a real hit
  // (a search with only street/city/zip returned "No Listings were
  // found" for a real, existing listing) -- all optional here since a
  // caller might not always have them, but fill whatever's given.
  await fill(/Number of Beds/i, parts.beds);
  await fill(/Number of Total Baths/i, parts.baths);
  await fill(/Number of SqFt/i, parts.sqft);
  // "Any Change" -- part of the confirmed working recording; broadens
  // the Change Type filter so a normal listing isn't excluded by it.
  const anyChangeBox = page.locator('nobr').filter({ hasText: 'Any Change' }).getByRole('checkbox').first();
  if (await anyChangeBox.count().catch(() => 0)) await anyChangeBox.check().catch(() => {});

  await submitSearch(page);
  // Confirmed live (2026-07-29, 1055 Cayuga Ave): the submit click can
  // land before the form is fully interactive and silently not
  // navigate, leaving the entry form filled but unsearched with no
  // "Found N results"/"No Listings" text anywhere -- retry the click
  // once in that specific ambiguous case.
  if (resultsFoundCount(await page.innerText('body').catch(() => '')) === null) {
    await submitSearch(page);
  }
}

/**
 * Runs the search, and if it comes back with a real "No Listings were
 * found" (as opposed to the ambiguous not-yet-navigated state
 * fillAddressSearch already retries once on its own), retries with
 * progressively looser numeric criteria. Confirmed live (2026-07-29,
 * 460 5th Ave / 100 Palm Avenue): exact Beds/Baths/SqFt filters can
 * return a genuine 0 results for a real, existing listing when the
 * recorded figures don't precisely match the current MLS record
 * (rounding, remodel updates, etc.) -- street + city + zip is what
 * actually identifies the property, so drop the numeric filters one at
 * a time rather than giving up on the first empty result set.
 */
async function searchWithLooseningFallback(page, parts) {
  await fillAddressSearch(page, parts);
  let count = resultsFoundCount(await page.innerText('body').catch(() => ''));
  if (count !== 0) return;

  const looseningSteps = [
    { sqft: true },
    { sqft: true, beds: true, baths: true }
  ];
  for (const drop of looseningSteps) {
    const criteriaTab = page.getByRole('link', { name: /^Criteria$/i }).first();
    if (await criteriaTab.count().catch(() => 0)) {
      await criteriaTab.click();
      await page.waitForTimeout(1500);
    }
    // Confirmed live (2026-07-29, 460 5th Ave): the "Criteria" tab is a
    // different, fuller form than the initial quick-search widget --
    // it has no "Search" button at all (it live-counts matches as you
    // type, e.g. "1 matches" next to Location), so submitSearch()'s
    // button-click logic silently does nothing here. Getting to the
    // results instead means clicking the "Results" tab directly.
    if (drop.sqft) await clearField(page, /Number of SqFt/i);
    if (drop.beds) await clearField(page, /Number of Beds/i);
    if (drop.baths) await clearField(page, /Number of Total Baths/i);
    const resultsTab = page.getByRole('link', { name: /^Results$/i }).first();
    if (await resultsTab.count().catch(() => 0)) {
      await resultsTab.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(3000);
    } else {
      await submitSearch(page);
    }
    count = resultsFoundCount(await page.innerText('body').catch(() => ''));
    if (count !== 0) return;
  }
}

/**
 * Full per-lead flow: auto-login -> open the address search form -> search
 * by address -> open the first ML# result -> read the agent's contact from
 * the detail page. Returns { found, agentName, agentPhone, agentEmail,
 * matched } (matched = the detail page confirms the street number/name), or
 * { found:false, reason } when a value is unavailable. Never throws on a
 * merely-missing listing -- one bad lead can't abort a batch. Saves a
 * screenshot to .mls-debug/ on failure.
 *
 * `opts.zip`/`opts.beds`/`opts.baths`/`opts.sqft` -- confirmed live to
 * matter for actually getting a hit (street/city/zip alone returned
 * "No Listings were found" for a real, existing listing); a real Flip
 * Scout Leads row already has all of these as their own columns, so
 * pass them through rather than guessing.
 */
async function scrapeListingAgent(page, address, city, opts = {}) {
  const parts = parseAddressParts(address, city, opts);
  let popup = null;
  try {
    await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await ensureLoggedIn(page);
    if (looksLoggedOut(await page.innerText('body').catch(() => ''))) {
      return { found: false, reason: 'still logged out after auto-login attempt' };
    }
    const quickActionLink = page.getByRole('link', { name: /Quick Action link for Matrix Search/i }).first();
    if (!(await quickActionLink.count().catch(() => 0))) {
      // Logged in, but the dashboard's own quick-action link never
      // showed up (e.g. stuck on an intermediate screen the login
      // flow doesn't fully clear) -- fail fast with a screenshot
      // instead of burning 20s on openMatrixSearchPopup's own wait.
      await debugShot(page, 'no-quick-action-' + (parts.streetNumber || 'x') + '-' + Date.now());
      return { found: false, reason: 'dashboard loaded but "Quick Action link for Matrix Search" was not found (url: ' + page.url() + ')' };
    }

    popup = await openMatrixSearchPopup(page);
    await searchWithLooseningFallback(popup, parts);

    // Open the first result's ML# link (e.g. "SF426146208"). If there
    // isn't one, we're still on the results/criteria page (a genuine
    // 0-result search, even after loosening) -- don't fall through to
    // contact parsing, which would read the criteria-echo text and
    // could false-positive "matched" against the searched street
    // number/name it's merely printing back (confirmed live,
    // 2026-07-29: 460 5th Ave / 100 Palm Avenue).
    const mlLink = popup.getByRole('link', { name: /^[A-Z]{2}\d{6,}$/ }).first();
    if (!(await mlLink.count().catch(() => 0))) {
      await debugShot(popup, 'no-results-' + (parts.streetNumber || 'x') + '-' + Date.now());
      return { found: false, reason: 'no listing results found for this address/criteria', matched: false };
    }
    await mlLink.click();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(3000);

    const detailText = await popup.innerText('body').catch(() => '');
    if (looksLoggedOut(detailText)) return { found: false, reason: 'session dropped before the detail page loaded' };

    const contact = extractAgentContact(detailText);
    const found = !!(contact.agentPhone || contact.agentEmail || contact.agentName);
    // Confirm the detail actually matches the requested property.
    const matched = !!(parts.streetNumber && detailText.indexOf(parts.streetNumber) !== -1
      && parts.streetName && new RegExp(parts.streetName.split(' ')[0], 'i').test(detailText));
    if (!found) {
      await debugShot(popup, 'no-contact-' + (parts.streetNumber || 'x') + '-' + Date.now());
      return { found: false, reason: 'listing detail found but no agent contact could be parsed', matched: matched };
    }
    return { found: true, matched: matched, ...contact };
  } catch (err) {
    await debugShot(popup || page, 'error-' + (parts.streetNumber || 'x') + '-' + Date.now());
    return { found: false, reason: 'scrape error: ' + err.message };
  } finally {
    // The popup is a per-search Matrix window -- close it so the next
    // lead in a batch opens a fresh one rather than piling up tabs.
    if (popup) await popup.close().catch(() => {});
  }
}

module.exports = {
  scrapeListingAgent,
  ensureLoggedIn,
  openMatrixSearchPopup,
  fillAddressSearch,
  searchWithLooseningFallback,
  parseAddressParts,
  extractAgentContact,
  looksLoggedOut,
  AGENT_LABELS,
  SHORT_FIELD_LABELS,
  MLS_PROFILE_DIR
};
