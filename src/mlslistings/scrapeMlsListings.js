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
const config = require('../config');

const MLS_PROFILE_DIR = '.mlslistings-profile';

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

// Labels that tend to precede the listing agent's block on an MLS detail
// page. Order matters -- the first one found wins. TODO(selectors):
// replace/extend with the exact label(s) MLSListings uses once seen live
// (e.g. "Listing Agent", "List Agent", "Listing Office").
const AGENT_LABELS = ['Listing Agent', 'List Agent', 'Listing Member', 'Presented By'];

/**
 * Pulls { agentName, agentPhone, agentEmail } out of a listing detail
 * page's visible text. Anchors on an agent label (AGENT_LABELS) and reads
 * the phone/email out of the bounded slice after it, mirroring the
 * text-pattern approach used for REI BlackBook (class names on these apps
 * are build-generated and unstable, so visible-text anchors are sturdier
 * than CSS selectors). Returns blanks for anything not found -- never
 * throws on a merely-incomplete page.
 *
 * `opts.labels` overrides AGENT_LABELS; `opts.windowChars` the slice size.
 */
function extractAgentContact(pageText, opts = {}) {
  const text = String(pageText || '');
  const labels = opts.labels || AGENT_LABELS;
  const windowChars = opts.windowChars || 400;

  let start = -1;
  let labelLen = 0;
  for (const label of labels) {
    const idx = text.search(new RegExp(label, 'i'));
    if (idx !== -1 && (start === -1 || idx < start)) {
      start = idx;
      labelLen = label.length;
    }
  }
  // No agent label found -> fall back to scanning the whole page, so a
  // page whose label wording we didn't anticipate still yields a
  // phone/email rather than nothing.
  const slice = start === -1 ? text : text.slice(start + labelLen, start + labelLen + windowChars);

  const phoneMatch = slice.match(PHONE_RE) || (start !== -1 ? text.match(PHONE_RE) : null);
  const emailMatch = slice.match(EMAIL_RE) || (start !== -1 ? text.match(EMAIL_RE) : null);

  // Agent name: the first non-empty line inside the agent block that
  // isn't itself the label, a phone, or an email. Best-effort; the
  // caller can always fall back to the name already on the lead.
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

// --- Navigation -------------------------------------------------------
// Wired from a live recording of the real Pro Dashboard flow: search is
// the Matrix system, opened from the dashboard's "Matrix Search" quick
// action, which pops open a SEPARATE window with a "Enter Shorthand or
// MLS#" speed bar. The speed-bar address search + how a result renders
// still want one confirming live run (marked TODO(verify)), but this is
// no longer a placeholder -- it drives the real UI.

/**
 * From the dashboard, opens the Matrix Search popup and returns that page.
 * Falls back to the same tab if Matrix opens inline instead of a popup.
 */
async function openMatrixSearch(page) {
  await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const dashText = await page.innerText('body').catch(() => '');
  if (looksLoggedOut(dashText)) {
    throw new Error('Not logged into MLSListings -- run `npm run mlslistings:login`, log in, then retry.');
  }

  const popupPromise = page.context().waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await page.getByRole('link', { name: /Matrix Search/i }).first().click();
  const popup = (await popupPromise) || page;
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.waitForTimeout(3000);
  return popup;
}

/**
 * Full per-lead flow: open Matrix, search the address in the speed bar,
 * read the listing agent's contact off whatever the search lands on.
 * Opens (and closes) a fresh Matrix popup per lead so a batch can't leak
 * windows. Returns { found, agentName, agentPhone, agentEmail } -- found
 * is false (not thrown) when nothing usable was parsed, so one bad lead
 * never aborts the batch.
 *
 * TODO(verify): confirm on a live run whether the speed bar takes a street
 * address directly and whether results land on a display page (agent
 * contact visible) or a list that needs the first row opened first.
 */
async function scrapeListingAgent(page, address) {
  const popup = await openMatrixSearch(page);
  try {
    const box = popup.getByRole('textbox', { name: /Enter Shorthand or MLS/i }).first();
    await box.waitFor({ state: 'visible', timeout: 15000 });
    await box.click();
    await box.fill(String(address).trim());
    await popup.keyboard.press('Enter');
    await popup.waitForTimeout(4500);

    let detailText = await popup.innerText('body').catch(() => '');
    if (looksLoggedOut(detailText)) {
      throw new Error('Not logged into MLSListings -- run `npm run mlslistings:login`, log in, then retry.');
    }

    const contact = extractAgentContact(detailText);
    const found = !!(contact.agentPhone || contact.agentEmail || contact.agentName);
    return { found, ...contact };
  } finally {
    if (popup !== page) await popup.close().catch(() => {});
  }
}

module.exports = {
  scrapeListingAgent,
  openMatrixSearch,
  extractAgentContact,
  looksLoggedOut,
  AGENT_LABELS,
  MLS_PROFILE_DIR
};
