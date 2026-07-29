/**
 * All outreach business logic, backed by the local data store
 * (src/outreach/store.js) instead of a Google Sheet. Reuses the exact
 * same shared/ rule engine (qualification, statusFlow, templateEngine,
 * keys) that used to back the Apps Script "Outreach" menu, so
 * behavior is unchanged -- only where the data lives has changed.
 *
 * Flip Scout Leads itself stays in the Sheet, read-only, owned by
 * Bryan's FlipScoutSheet.js -- listFlipScoutLeads()/addFromFlipScout()
 * are the only functions here that touch the Sheet at all.
 */
const { chromium } = require('playwright');
const config = require('../config');
const { evaluateQualification } = require('../../shared/qualification');
const { isSuppressed, buildOutreachKey, buildContactKey, normalizeAddress } = require('../../shared/keys');
const { canTransition } = require('../../shared/statusFlow');
const { renderTemplate, extractMergeFields } = require('../../shared/templateEngine');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const initialEmailTemplate = require('../../templates/initial-email.v2.json');
const store = require('./store');
const { getFlipScoutLeads, GOOD_FLIP_QUALITY, writeOutreachStatusSnapshot, getRedfinAgentContacts, getOutreachReviewRows, writeOutreachReviewDetails, syncGoodFlipToOutreachReview } = require('../sheets/sheetsClient');
const { loadFeedAgentContacts } = require('../feed/flipScoutFeed');
const goodFlipPipeline = require('./goodFlipPipeline');
const gmailClient = require('../gmail/gmailClient');
const { postToGoogleChat } = require('../notifications/googleChat');
const { scrapeReiBlackBookContact, checkNotesForDoNotAutomate, getChatHistory, isInboundActivity, REI_PROFILE_DIR } = require('../reiblackbook/scrapeReiBlackBook');
const { scrapeListingAgent, MLS_PROFILE_DIR } = require('../mlslistings/scrapeMlsListings');

const PRE_APPROVAL_STATUSES = ['Information Needed', 'Needs Review', 'Ready for Drafting'];

function coerceBoolean(value) {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'TRUE' || normalized === 'YES') return true;
  if (normalized === 'FALSE' || normalized === 'NO' || normalized === '') return false;
  return undefined;
}

/**
 * Lists Flip Scout Leads for the app's browse/select panel. Read-only
 * -- never writes back to that tab.
 */
async function listFlipScoutLeads() {
  const leads = await getFlipScoutLeads();
  await enrichLeadsWithFeedContact(leads);
  return leads.map((l) => ({
    sheetRow: l.__sheetRow,
    score: l.score,
    recommendation: l.recommendation,
    address: l.propertyAddress,
    city: l.city,
    arv: l.arv,
    grossProfitLight: l.grossProfitLight,
    risks: l.risks,
    redfinLink: l.redfinLink,
    reiContactLink: l.reiContactLink,
    reiAgentName: l.reiAgentName,
    // Listing-agent contact carried straight from the Paragon-sourced
    // feed (blank until Juan's agent + Bryan's sheet emit these columns).
    agentName: l.agentName,
    agentPhone: l.agentPhone,
    agentEmail: l.agentEmail,
    flipQuality: l.flipQuality,
    isGoodFlip: l.flipQuality === GOOD_FLIP_QUALITY
  }));
}

/**
 * Loose address match (case/whitespace/street-suffix-insensitive, via
 * shared/keys.js's normalizeAddress) against rows Cowork has fetched
 * into the "Redfin Agent Contacts" tab. Returns null if nothing
 * matches -- callers must not treat that as an error, just "no data
 * yet for this address."
 */
function findRedfinAgentContact(propertyAddress, contacts) {
  const target = normalizeAddress(propertyAddress);
  if (!target) return null;
  return (contacts || []).find((c) => normalizeAddress(c.propertyAddress) === target) || null;
}

/**
 * Resolves listing-agent contact for a Flip Scout lead, in trust order:
 *
 *   1. Agent contact carried on the lead itself -- captured upstream on
 *      Paragon/MLS by Juan's Flip Scout Agent and delivered through the
 *      Flip Scout Leads feed (agentName/agentPhone/agentEmail). This is
 *      the authoritative, no-scrape source; when present it wins.
 *   2. Bryan's REI BlackBook, when the lead has an "REI Link & Agent
 *      Name" -- name comes across now; phone/email land later via
 *      enrichFromReiBlackBook() (a separate page visit).
 *   3. Cowork's "Redfin Agent Contacts" tab (matched by address) -- a
 *      fallback only, used when neither source above supplies a value.
 *
 * Each field falls through independently, so a lead can take its name
 * from the feed while its phone/email (until the feed carries them) come
 * from a fallback. Pure -- no I/O -- so the precedence is unit-testable.
 * See docs/AGENT_CONTACT_SOURCING.md.
 */
function resolveAgentContact(lead, redfinMatch) {
  const l = lead || {};
  const rf = redfinMatch || {};
  const hasReiLink = !!l.reiContactLink;
  const clean = (v) => (v === '' || v == null ? undefined : v);
  return {
    agentName: clean(l.agentName)
      || (hasReiLink ? clean(l.reiAgentName) : undefined)
      || clean(rf.agentName),
    agentPhone: clean(l.agentPhone) || clean(rf.agentPhone) || '',
    agentEmail: clean(l.agentEmail) || clean(rf.agentEmail)
  };
}

/**
 * Enriches Flip Scout leads with the listing-agent contact from Juan's
 * Paragon-sourced feed (src/feed/flipScoutFeed.js), matched by address.
 * Feed contact is written onto lead.agentName/agentPhone/agentEmail
 * WITHOUT overwriting anything the lead already carries, so a later
 * resolveAgentContact() treats it as the authoritative source and only
 * falls back to REI/Redfin for fields the feed didn't supply. Best-effort
 * -- if the feed can't be read, leads pass through unchanged (they just
 * fall back to the existing sources). Mutates the leads in place and
 * returns them.
 */
async function enrichLeadsWithFeedContact(leads) {
  const { contacts } = await loadFeedAgentContacts();
  if (!contacts || contacts.size === 0) return leads;
  for (const lead of leads) {
    const c = contacts.get(normalizeAddress(lead.propertyAddress || ''));
    if (!c) continue;
    if (!lead.agentName && c.agentName) lead.agentName = c.agentName;
    if (!lead.agentPhone && c.agentPhone) lead.agentPhone = c.agentPhone;
    if (!lead.agentEmail && c.agentEmail) lead.agentEmail = c.agentEmail;
  }
  return leads;
}

/**
 * Looks up one address in the "Outreach Review" tab -- the authoritative,
 * human-set gate for whether a lead is actually clear for automated
 * outreach (separate from Flip Scout Leads itself, which stays owned
 * by Bryan's script -- see docs). Anything other than an explicit
 * "Yes" blocks automation, including a blank/not-yet-reviewed row --
 * the safer default is "not cleared" until a human says otherwise.
 */
function findOutreachReviewStatus(propertyAddress, reviewRows) {
  const target = normalizeAddress(propertyAddress);
  if (!target) return null;
  return (reviewRows || []).find((r) => normalizeAddress(r.propertyAddress) === target) || null;
}

/**
 * Looks up one address in "Redfin Agent Contacts" -- used by the Add/
 * Edit Row form's "Fill from Redfin sheet" button so a human can pull
 * Cowork's fetched data into an existing or in-progress row, review
 * it, and edit/save it themselves rather than have it applied silently.
 */
async function lookupRedfinAgentContact(propertyAddress) {
  const contacts = await getRedfinAgentContacts();
  return findRedfinAgentContact(propertyAddress, contacts);
}

/**
 * Pulls selected Flip Scout Leads rows (by sheetRow) into the local
 * Outreach Queue -- the app-side equivalent of "Add selected Flip
 * Scout rows." Property/city/Redfin link/campaign are always
 * prefilled; agent contact info is best-effort prefilled too, in this
 * order of trust:
 *
 *   1. Bryan's REI BlackBook, when the lead has a "REI Link & Agent
 *      Name" -- his real CRM contact for this agent. Agent name comes
 *      across immediately; phone/email land later via
 *      enrichFromReiBlackBook() (that's a separate page visit, not
 *      part of this Sheet read).
 *   2. Otherwise, whatever Cowork has already fetched into "Redfin
 *      Agent Contacts" (matched by address) -- name, phone, and email
 *      all available immediately, since that data's already scraped.
 *
 * Either way this lands in the row exactly like hand-typed agent info
 * would: still editable, still needing a human to review it before
 * outreach is sent. If neither source has a match, leads still get
 * added with agent info blank for manual entry, same as always.
 *
 * Also checks the "Outreach Review" tab (separate from Flip Scout
 * Leads/REI BlackBook) for an explicit "Ready for Automated Outreach?"
 * decision, keyed by address. Anything other than exactly "Yes" --
 * including no row at all yet -- sets doNotAutomate on the new row, so
 * a lead is blocked from any auto-send path by default until a human
 * clears it there.
 */
async function addFromFlipScout(sheetRows, campaign) {
  const leads = await getFlipScoutLeads((l) => sheetRows.includes(l.__sheetRow));
  await enrichLeadsWithFeedContact(leads);
  const existingKeys = store.getQueueRows().map((r) => r.outreachKey).filter(Boolean);
  const added = [];
  const skipped = [];

  let redfinContacts = [];
  try {
    redfinContacts = await getRedfinAgentContacts();
  } catch (err) {
    // Best-effort only -- see doc comment above.
  }
  let reviewRows = [];
  try {
    reviewRows = await getOutreachReviewRows();
  } catch (err) {
    // Best-effort only -- if the Outreach Review tab isn't reachable,
    // fall through to the safer default below (blocked) rather than
    // silently treating every lead as cleared.
  }

  for (const lead of leads) {
    const hasReiLink = !!lead.reiContactLink;
    const redfinMatch = hasReiLink ? null : findRedfinAgentContact(lead.propertyAddress, redfinContacts);
    const { agentName, agentPhone, agentEmail } = resolveAgentContact(lead, redfinMatch);
    const outreachKey = buildOutreachKey(agentPhone, lead.propertyAddress, campaign || 'flip-scout');

    const review = findOutreachReviewStatus(lead.propertyAddress, reviewRows);
    const isCleared = review && String(review.readyForAutomatedOutreach || '').trim().toLowerCase() === 'yes';
    const doNotAutomate = isCleared ? undefined : 'TRUE';
    const doNotAutomateReason = isCleared ? undefined
      : (review ? 'Outreach Review sheet: "' + review.readyForAutomatedOutreach + '"' : 'Outreach Review sheet: not yet reviewed');
    // If agent phone is still unknown, outreachKey/contactKey are
    // placeholders -- refreshValidation recomputes duplicate-detection
    // once agent phone is filled in; this just prevents re-adding the
    // exact same address+campaign combo before that happens.
    if (outreachKey && existingKeys.includes(outreachKey)) {
      skipped.push(lead.propertyAddress);
      continue;
    }
    const now = new Date().toISOString();
    const row = store.appendQueueRow({
      status: 'Information Needed',
      propertyAddress: lead.propertyAddress,
      city: lead.city,
      redfinLink: lead.redfinLink,
      campaign: campaign || 'flip-scout',
      flipScoutRowRef: lead.__sheetRow,
      agentName,
      agentPhone: agentPhone || undefined,
      agentEmail,
      reiContactLink: lead.reiContactLink || undefined,
      doNotAutomate,
      doNotAutomateReason,
      // Bryan + Juan already curate which leads to pursue -- a "Yes"
      // here (see evaluateQualification's own comment on this) means
      // the granular Phase 3 property/listing checks get skipped
      // entirely for this row, since that curation already covers it.
      reviewCleared: isCleared ? 'TRUE' : undefined,
      outreachKey,
      contactKey: agentPhone ? buildContactKey(agentPhone) : undefined,
      dateAdded: now,
      lastUpdated: now
    });
    existingKeys.push(outreachKey);
    added.push(row);
  }
  return { added, skipped };
}

/**
 * Automated equivalent of a human browsing Flip Scout Leads, checking
 * the "Good Flip" leads, and clicking "Add selected to Outreach
 * Queue" -- used by the continuous automation loop (app/automationLoop.js)
 * so new leads keep flowing into the queue without that manual step.
 *
 * Filters by flipScoutRowRef (the sheet row reference every queued
 * row already carries) BEFORE calling addFromFlipScout(), not after --
 * addFromFlipScout()'s own duplicate check only compares outreachKey,
 * which is blank until a phone number exists. A freshly auto-queued
 * lead has no phone yet, so its blank key would never match anything,
 * and without this pre-filter the same Flip Scout row would get
 * re-added as a brand new queue row on every single cycle.
 */
async function autoQueueFromFlipScout() {
  const leads = await listFlipScoutLeads();
  const existingRefs = new Set(store.getQueueRows().map((r) => r.flipScoutRowRef).filter(Boolean));
  const candidates = leads.filter((l) => l.isGoodFlip && !existingRefs.has(l.sheetRow));
  if (candidates.length === 0) return { added: [], skipped: [] };
  return addFromFlipScout(candidates.map((l) => l.sheetRow), 'auto-queue');
}

/**
 * Front of the Sheet-driven flow: writes every "Good Flip" lead from
 * Bryan's Flip Scout Leads tab into the human-owned "Outreach Review"
 * tab, so a person can mark each "Ready for Automated Outreach? = Yes"
 * there. Good Flip is the trigger; Outreach Review is the decision
 * surface. Idempotent -- upserts by address, never overwrites a row a
 * human has already touched (see syncGoodFlipToOutreachReview). Agent
 * name is pre-filled from the lead's "REI Link & Agent Name" when
 * present; phone/email get filled in later by enrichment.
 */
async function syncGoodFlipLeadsToReview() {
  const leads = await getFlipScoutLeads((l) => l.flipQuality === GOOD_FLIP_QUALITY);
  await enrichLeadsWithFeedContact(leads);
  const payload = leads.map((l) => {
    // Paragon-sourced feed contact is authoritative; the REI link's
    // agent name is the fallback for the name only. Phone/email pre-fill
    // the Outreach Review tab straight from the feed when present, so a
    // reviewer sees them without any scrape/enrichment step.
    const { agentName, agentPhone, agentEmail } = resolveAgentContact(l, null);
    return {
      propertyAddress: l.propertyAddress,
      agentName,
      agentPhone: agentPhone || undefined,
      agentEmail
    };
  });
  return syncGoodFlipToOutreachReview(payload);
}

// Statuses still ahead of an actual send -- the only ones where a change
// to the Outreach Review "Ready?" decision (or hand-edited agent info)
// should still be pulled in. Once a row is Contacted or terminal, the
// reply/follow-up logic owns it and re-reading the sheet must not reopen
// it.
const REVIEW_SYNCABLE_STATUSES = ['Information Needed', 'Needs Review', 'Ready for Drafting', 'Pending Approval', 'Approved', 'Do Not Automate'];

/**
 * Re-reads the human-owned "Outreach Review" tab every cycle and pulls
 * its current state into the local working rows (the Sheet is
 * authoritative). This is what makes a human marking "Ready for
 * Automated Outreach? = Yes" AFTER a lead was auto-queued actually take
 * effect: addFromFlipScout() only reads that decision once, at add-time,
 * which in this flow is always before the human has decided.
 *
 * Matched by normalized address. For each pre-send row:
 *  - "Yes"  -> reviewCleared = TRUE, and a block that existed only
 *              because the lead wasn't cleared yet is lifted. A
 *              do-not-automate flag set from a REI BlackBook *note* (a
 *              compliance signal, not a clearance question) is NEVER
 *              lifted here.
 *  - anything else (blank / "No" / ...) -> reviewCleared cleared and the
 *              lead re-blocked with doNotAutomate, unless a stricter
 *              REI-notes block is already the reason.
 *  - hand-edited agent name/phone/email on the sheet overwrite the row
 *    (recomputing the contact/outreach keys if the phone changed).
 */
/**
 * Pure decision function (no I/O) for one working row against its
 * matching "Outreach Review" record -- extracted so the safety-critical
 * rules here are unit-testable. Returns the set of fields to change on
 * the row (empty object = leave the row alone).
 *
 * Rules, in order of importance:
 *  - A do-not-automate flag whose reason is a REI BlackBook *note* is a
 *    compliance signal and is NEVER lifted here, even on "Yes".
 *  - "Yes" clears the review-based block and marks reviewCleared.
 *  - Anything else re-blocks with doNotAutomate (unless a stricter
 *    REI-notes block is already the reason) and clears reviewCleared.
 *  - Non-empty agent name/phone/email on the sheet are authoritative and
 *    overwrite the row.
 */
function computeReviewDecisionFields(row, review) {
  const isCleared = String(review.readyForAutomatedOutreach || '').trim().toLowerCase() === 'yes';
  const reiNoteBlocked = coerceBoolean(row.doNotAutomate) &&
    /REI BlackBook note/i.test(row.doNotAutomateReason || '');
  const fields = {};

  // Sheet-authoritative agent info: a human correcting a phone/email in
  // Outreach Review wins over whatever the row currently holds.
  if (review.agentName && review.agentName !== row.agentName) fields.agentName = review.agentName;
  if (review.agentPhone && review.agentPhone !== row.agentPhone) fields.agentPhone = review.agentPhone;
  if (review.agentEmail && review.agentEmail !== row.agentEmail) fields.agentEmail = review.agentEmail;

  if (isCleared) {
    if (coerceBoolean(row.reviewCleared) !== true) fields.reviewCleared = 'TRUE';
    if (coerceBoolean(row.doNotAutomate) && !reiNoteBlocked) {
      fields.doNotAutomate = undefined;
      fields.doNotAutomateReason = undefined;
    }
  } else {
    if (row.reviewCleared) fields.reviewCleared = undefined;
    if (!reiNoteBlocked) {
      fields.doNotAutomate = 'TRUE';
      fields.doNotAutomateReason = review.readyForAutomatedOutreach
        ? 'Outreach Review sheet: "' + review.readyForAutomatedOutreach + '"'
        : 'Outreach Review sheet: not yet reviewed';
    }
  }
  return fields;
}

async function syncOutreachReviewDecisions() {
  let reviewRows;
  try {
    reviewRows = await getOutreachReviewRows();
  } catch (err) {
    return { updated: 0, error: err.message };
  }
  const rows = store.getQueueRows((r) => REVIEW_SYNCABLE_STATUSES.includes(r.status));
  let updated = 0;

  for (const row of rows) {
    const review = findOutreachReviewStatus(row.propertyAddress, reviewRows);
    if (!review) continue;
    const fields = computeReviewDecisionFields(row, review);
    if (Object.keys(fields).length === 0) continue;

    // Recompute contact/outreach keys if the phone changed (same
    // reasoning as updateRow()); a blank phone leaves them blank.
    if (fields.agentPhone !== undefined) {
      fields.contactKey = buildContactKey(fields.agentPhone);
      fields.outreachKey = buildOutreachKey(fields.agentPhone, row.propertyAddress, row.campaign);
    }
    fields.lastUpdated = new Date().toISOString();
    store.updateQueueRow(row.id, fields);
    updated++;
  }

  const sheetSync = await syncOutreachStatusTab();
  return { updated, sheetSync };
}

/**
 * Visits every Outreach Queue row that has a REI BlackBook contact
 * link but no agent phone yet, and fills in phone/email read off that
 * contact's real page (see src/reiblackbook/scrapeReiBlackBook.js).
 * Also writes those same details into the "Outreach Review" Sheet tab
 * (see writeOutreachReviewDetails) -- so whoever reviews a lead there
 * to decide "Ready for Automated Outreach?" already has what REI
 * BlackBook knows about the agent, without needing to separately open
 * REI BlackBook themselves. Requires a human to have already logged
 * into REI BlackBook once via scripts/login-reiblackbook.js -- this
 * never logs in itself, and stops per-row (not the whole run) if a
 * row can't be read, so one bad link doesn't block the rest of the
 * batch.
 */
async function enrichFromReiBlackBook() {
  const rows = store.getQueueRows((r) => r.reiContactLink && !r.agentPhone);
  if (rows.length === 0) return { updated: 0, failed: 0, results: [] };

  // Visible, not headless -- same reasoning as the Redfin scraper: if
  // the session has quietly expired or REI BlackBook's layout changed,
  // a human watching the window notices immediately instead of just
  // getting a cryptic per-row failure.
  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  const results = [];
  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const row of rows) {
      try {
        const info = await scrapeReiBlackBookContact(page, row.reiContactLink);
        // Goes through updateRow(), not a direct store write -- agent
        // phone is changing here, and outreachKey/contactKey must be
        // recomputed from it (see updateRow()'s own comment on this;
        // a direct store write would leave both permanently blank,
        // same false-duplicate bug fixed earlier for manual edits).
        await updateRow(row.id, {
          agentPhone: info.agentPhone || row.agentPhone,
          agentEmail: info.agentEmail || row.agentEmail
        });
        try {
          await writeOutreachReviewDetails(row.propertyAddress, {
            agentName: row.agentName,
            agentPhone: info.agentPhone || row.agentPhone,
            agentEmail: info.agentEmail || row.agentEmail
          });
        } catch (sheetErr) {
          // Best-effort -- the local queue row is already correct
          // either way; the Sheet is a convenience mirror for reviewers.
        }
        results.push({ propertyAddress: row.propertyAddress, ok: true, ...info });
      } catch (err) {
        results.push({ propertyAddress: row.propertyAddress, ok: false, error: err.message });
      }
    }
  } finally {
    await context.close();
  }
  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
}

/**
 * Fills in agent phone/email for every Outreach Queue row still missing
 * one, by searching MLSListings Pro Dashboard for the property by address
 * and reading the listing agent's contact straight off the MLS detail
 * page (see src/mlslistings/scrapeMlsListings.js). This is the
 * authoritative, at-the-source contact -- no Redfin scraping.
 *
 * Requires a human to have logged into MLSListings once via
 * `npm run mlslistings:login` -- this never logs in itself, reuses that
 * saved session, rate-limits between rows (config.mls.scrapeDelayMs), and
 * stops per-row (not the whole run) so one address that can't be found
 * doesn't block the rest of the batch. Also mirrors what it finds into
 * the "Outreach Review" tab, same as the REI BlackBook enricher.
 */
async function enrichFromMlsListings() {
  const rows = store.getQueueRows((r) => r.propertyAddress && (!r.agentPhone || !r.agentEmail));
  if (rows.length === 0) return { updated: 0, failed: 0, results: [] };

  // Visible, not headless -- same reasoning as the other scrapers: a
  // human watching notices an expired session or a changed layout
  // immediately instead of getting cryptic per-row failures.
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  const results = [];
  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const row of rows) {
      try {
        const info = await scrapeListingAgent(page, row.propertyAddress, row.city);
        if (!info.found || (!info.agentPhone && !info.agentEmail)) {
          results.push({ propertyAddress: row.propertyAddress, ok: false, error: info.reason || (info.found ? 'listing found but no agent contact parsed' : 'no matching listing found') });
        } else {
          // Through updateRow() (not a direct store write) so a changed
          // agent phone recomputes outreachKey/contactKey -- same reason
          // as the REI BlackBook enricher above.
          await updateRow(row.id, {
            agentName: row.agentName || info.agentName || undefined,
            agentPhone: info.agentPhone || row.agentPhone,
            agentEmail: info.agentEmail || row.agentEmail
          });
          try {
            await writeOutreachReviewDetails(row.propertyAddress, {
              agentName: row.agentName || info.agentName,
              agentPhone: info.agentPhone || row.agentPhone,
              agentEmail: info.agentEmail || row.agentEmail
            });
          } catch (sheetErr) {
            // Best-effort -- the local queue row is already correct.
          }
          results.push({ propertyAddress: row.propertyAddress, ok: true, ...info });
        }
      } catch (err) {
        results.push({ propertyAddress: row.propertyAddress, ok: false, error: err.message });
      }
      await page.waitForTimeout(config.mls.scrapeDelayMs);
    }
  } finally {
    await context.close();
  }
  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
}

/**
 * Visits every Outreach Queue row that has a REI BlackBook contact
 * link and checks its Notes tab for an explicit directive against
 * automating outreach (e.g. "Do not begin automated seller outreach"
 * -- a real note found on a live contact, not a hypothetical). This
 * is a compliance gate, not informational: a match sets the row's
 * existing doNotAutomate flag, which evaluateQualification() already
 * checks everywhere outreach gets sent. Only ever sets the flag on --
 * never clears it back off automatically, since a human may have set
 * it for other reasons this scan wouldn't know about. Re-checking
 * (not just once at enrichment time) matters because new notes can
 * get added to a contact after the row was first added.
 */
async function checkReiBlackBookNotes() {
  const rows = store.getQueueRows((r) => r.reiContactLink);
  if (rows.length === 0) return { checked: 0, flagged: 0, results: [] };

  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  const results = [];
  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const row of rows) {
      try {
        const signal = await checkNotesForDoNotAutomate(page, row.reiContactLink);
        if (signal.doNotAutomate && !coerceBoolean(row.doNotAutomate)) {
          await updateRow(row.id, {
            doNotAutomate: 'TRUE',
            doNotAutomateReason: 'REI BlackBook note: "' + signal.matchedText + '"'
          });
        }
        try {
          await writeOutreachReviewDetails(row.propertyAddress, {
            agentName: row.agentName,
            agentPhone: row.agentPhone,
            agentEmail: row.agentEmail,
            reiNotesFlag: signal.doNotAutomate ? signal.matchedText : ''
          });
        } catch (sheetErr) {
          // Best-effort -- see enrichFromReiBlackBook()'s identical note.
        }
        results.push({ propertyAddress: row.propertyAddress, ok: true, flagged: signal.doNotAutomate, matchedText: signal.matchedText });
      } catch (err) {
        results.push({ propertyAddress: row.propertyAddress, ok: false, error: err.message });
      }
    }
  } finally {
    await context.close();
  }
  return {
    checked: results.length,
    flagged: results.filter((r) => r.flagged).length,
    results
  };
}

/**
 * Adds one row directly (real lead entered by hand, or an internal
 * test row) -- doesn't go through Flip Scout at all.
 */
async function addRow(fields) {
  const campaign = fields.campaign || 'internal-test';
  const now = new Date().toISOString();
  const row = store.appendQueueRow({
    status: 'Information Needed',
    dateAdded: now,
    lastUpdated: now,
    ...fields,
    campaign,
    outreachKey: buildOutreachKey(fields.agentPhone, fields.propertyAddress, campaign),
    contactKey: buildContactKey(fields.agentPhone)
  });
  await syncOutreachStatusTab();
  return row;
}

/**
 * Updates an existing row by id -- used when filling in agent contact
 * info / Phase 3 verification fields after adding from Flip Scout.
 */
async function updateRow(id, fields) {
  if (fields.agentPhone !== undefined) {
    fields.contactKey = buildContactKey(fields.agentPhone);
  }
  // outreachKey must be recomputed whenever anything it's built from
  // changes -- not just at row-creation time. addFromFlipScout() adds
  // a row with no agent phone yet (outreachKey ends up blank, since
  // buildOutreachKey requires one), and the app's own UI explicitly
  // expects agent info to be filled in later via this exact function
  // ("fill in agent info after adding from Flip Scout" -- see the note
  // above index.html's outreach table). Without this, every such row
  // permanently keeps a blank outreachKey, and refreshValidation()'s
  // duplicate check flags it as a false duplicate (multiple rows all
  // sharing the same blank key).
  if (fields.agentPhone !== undefined || fields.propertyAddress !== undefined || fields.campaign !== undefined) {
    const existing = store.getQueueRows((r) => r.id === id)[0] || {};
    const phone = fields.agentPhone !== undefined ? fields.agentPhone : existing.agentPhone;
    const address = fields.propertyAddress !== undefined ? fields.propertyAddress : existing.propertyAddress;
    const campaign = fields.campaign !== undefined ? fields.campaign : existing.campaign;
    fields.outreachKey = buildOutreachKey(phone, address, campaign);
  }
  const row = store.updateQueueRow(id, { ...fields, lastUpdated: new Date().toISOString() });
  await syncOutreachStatusTab();
  return row;
}

async function refreshValidation() {
  const rows = store.getQueueRows();
  const suppressionList = store.getSuppressionList();
  const allOutreachKeys = rows.map((r) => r.outreachKey);
  const results = [];

  for (const row of rows) {
    if (!PRE_APPROVAL_STATUSES.includes(row.status)) continue;
    const duplicateCount = allOutreachKeys.filter((k) => k === row.outreachKey).length;
    const lead = {
      listingStatus: row.listingStatus,
      daysOnMarket: row.daysOnMarket,
      tenantOccupied: coerceBoolean(row.tenantOccupied),
      needsWork: coerceBoolean(row.needsWork),
      appearsRenovated: coerceBoolean(row.appearsRenovated),
      compReviewCompleted: coerceBoolean(row.compReviewCompleted),
      agentName: row.agentName,
      agentPhone: row.agentPhone,
      agentEmail: row.agentEmail,
      isDuplicate: duplicateCount > 1,
      isSuppressed: isSuppressed(row.agentPhone, suppressionList),
      doNotAutomate: coerceBoolean(row.doNotAutomate),
      reviewCleared: coerceBoolean(row.reviewCleared)
    };

    const result = evaluateQualification(lead);
    const nextStatus = canTransition(row.status, result.status) ? result.status : row.status;
    store.updateQueueRow(row.id, {
      status: nextStatus,
      qualificationReasons: result.reasons.join(' '),
      lastUpdated: new Date().toISOString()
    });
    results.push({ id: row.id, address: row.propertyAddress, status: nextStatus, reasons: result.reasons });
  }
  results.sheetSync = await syncOutreachStatusTab();
  return results;
}

async function submitForApproval() {
  const rows = store.getQueueRows((r) => r.status === 'Ready for Drafting');
  const mergeBase = {
    senderName: config.sender.name,
    senderPhone: config.sender.phone,
    senderEmail: config.sender.email,
    handoffPerson: config.sender.handoffPerson,
    companyWebsite: config.sender.companyWebsite,
    yearsInBusiness: config.sender.yearsInBusiness,
    googleReviewLink: config.sender.googleReviewLink
  };
  const results = [];

  for (const row of rows) {
    const mergeData = {
      ...mergeBase,
      agentFirstName: (row.agentName || '').trim().split(/\s+/)[0] || '',
      propertyAddress: row.propertyAddress,
      city: row.city
    };
    const fields = { lastUpdated: new Date().toISOString() };
    const problems = [];

    try {
      const sms = renderTemplate(initialSmsTemplate, mergeData);
      fields.smsTemplateId = 'initial-sms.v' + initialSmsTemplate.version;
      fields.renderedSmsBody = sms.body;
    } catch (err) {
      problems.push('SMS: ' + err.message);
    }

    if (row.agentEmail) {
      try {
        const email = renderTemplate(initialEmailTemplate, mergeData);
        fields.emailTemplateId = 'initial-email.v' + initialEmailTemplate.version;
        fields.renderedEmailSubject = email.subject;
        fields.renderedEmailBody = email.body;
      } catch (err) {
        problems.push('Email: ' + err.message);
      }
    }

    if (problems.length > 0) {
      fields.status = 'Needs Review';
      fields.qualificationReasons = problems.join(' ');
    } else {
      fields.status = 'Pending Approval';
    }
    store.updateQueueRow(row.id, fields);
    results.push({ id: row.id, address: row.propertyAddress, status: fields.status, problems });
  }
  results.sheetSync = await syncOutreachStatusTab();
  return results;
}

/**
 * Approves every row currently Pending Approval -- the human approval
 * gate. All-or-nothing (no per-row selection UI yet).
 */
async function approveOutreach() {
  const rows = store.getQueueRows((r) => r.status === 'Pending Approval');
  const results = [];
  for (const row of rows) {
    store.updateQueueRow(row.id, { status: 'Approved', lastUpdated: new Date().toISOString() });
    results.push({ id: row.id, address: row.propertyAddress });
  }
  results.sheetSync = await syncOutreachStatusTab();
  return results;
}

/**
 * Sends approved emails via the Gmail API. Gated solely by
 * ENABLE_EMAIL_SENDING in .env now that there's no separate Sheet
 * Settings tab -- one flag, one source of truth. Every other safety
 * check (suppression, Do Not Automate, unresolved merge fields)
 * re-runs immediately before sending regardless of that flag.
 */
async function sendApprovedEmails() {
  const sendingEnabled = config.flags.emailSendingEnabled;
  const suppressionList = store.getSuppressionList();
  // Also picks up a row already moved to 'Contacted' by the SMS side,
  // as long as THIS channel hasn't sent yet (!emailSentAt) -- a real
  // bug found live: both channels used to gate purely on
  // status === 'Approved', so whichever channel ran first in a cycle
  // flipped status to 'Contacted' and silently starved the other one.
  const rows = store.getQueueRows((r) =>
    (r.status === 'Approved' || r.status === 'Contacted') && r.agentEmail && r.renderedEmailBody && !r.emailSentAt);

  const results = [];
  for (const row of rows) {
    const problems = [];
    if (coerceBoolean(row.doNotAutomate)) problems.push('Do Not Automate is set.');
    if (isSuppressed(row.agentPhone, suppressionList)) problems.push('Agent is on the Suppression List.');
    if (extractMergeFields(row.renderedEmailSubject).length > 0 || extractMergeFields(row.renderedEmailBody).length > 0) {
      problems.push('Rendered email still has unresolved merge fields.');
    }

    const logBase = {
      outreachKey: row.outreachKey, contactKey: row.contactKey, propertyAddress: row.propertyAddress,
      agentName: row.agentName, agentPhone: row.agentPhone, agentEmail: row.agentEmail, channel: 'email',
      templateId: row.emailTemplateId, subject: row.renderedEmailSubject, messageBody: row.renderedEmailBody,
      sender: config.sender.email
    };

    if (problems.length > 0) {
      store.updateQueueRow(row.id, { status: 'Needs Review', qualificationReasons: problems.join(' '), lastUpdated: new Date().toISOString() });
      store.appendCommunicationLog({ ...logBase, result: 'Blocked', notes: problems.join(' ') });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Blocked', notes: problems.join(' ') });
      continue;
    }

    if (sendingEnabled) {
      await gmailClient.sendEmail({ to: row.agentEmail, subject: row.renderedEmailSubject, body: row.renderedEmailBody });
      store.updateQueueRow(row.id, {
        status: 'Contacted',
        contactedAt: row.contactedAt || new Date().toISOString(),
        emailSentAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });
      store.appendCommunicationLog({ ...logBase, result: 'Sent', notes: '' });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Sent' });
    } else {
      store.appendCommunicationLog({ ...logBase, result: 'Dry Run', notes: 'ENABLE_EMAIL_SENDING is false in .env -- no message was actually sent.' });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Dry Run' });
    }
  }
  const sheetSync = await syncOutreachStatusTab();
  return { sendingEnabled, results, sheetSync };
}

const FOLLOWUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function last10Digits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

/**
 * Google Voice's notification email body wraps the actual reply in a
 * leading logo-link line, an optional "Google Voice" banner, and a
 * long account/help-center footer -- strip all of that so what's left
 * is just what the agent actually typed. Verified against real
 * plaintext notification bodies: the footer's anchor words aren't
 * adjacent ("YOUR ACCOUNT <url> HELP CENTER"), so the footer markers
 * below allow anything (including embedded links) between them.
 */
function extractReplyText(rawBody) {
  let text = String(rawBody || '');
  const footerMarkers = [
    /YOUR ACCOUNT[\s\S]*?HELP CENTER[\s\S]*?HELP FORUM/i,
    /To respond to this text message/i,
    /This email was sent to you because/i
  ];
  for (const marker of footerMarkers) {
    const cut = text.search(marker);
    if (cut !== -1) { text = text.slice(0, cut); break; }
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const contentLines = lines.filter((l) => !/^<https?:\/\/\S+>$/.test(l) && !/^Google Voice$/i.test(l));
  return contentLines.join('\n').trim();
}

function classifyReply(text) {
  const normalized = text.trim().toUpperCase();
  if (/^YES\b/.test(normalized)) return 'yes';
  if (/^NO\b/.test(normalized) || /\b(STOP|UNSUBSCRIBE|REMOVE ME)\b/.test(normalized)) return 'no';
  return 'ambiguous';
}

/**
 * Posts to Google Chat and swallows any failure (webhook not
 * configured yet, network error, etc.) into a returned error string
 * instead of throwing -- a notification problem must never stop the
 * actual reply-routing above, which already happened by the time this
 * runs.
 */
async function notifyGoogleChat(text) {
  try {
    await postToGoogleChat(text);
    return null;
  } catch (err) {
    return err.message;
  }
}

/**
 * Checks Gmail for Google Voice reply notifications matching any row
 * currently "Contacted", and either routes it forward (YES -> Handed
 * Off via Replied, NO/opt-out language -> Opted Out, anything else ->
 * Replied for a human to read) or, if three days have passed with no
 * reply at all, moves it to Follow-Up Due. Never touches rows in any
 * other status -- once a row leaves Contacted, it's not reconsidered.
 */
/**
 * Full-overwrite mirror of every Outreach Queue row that has agent
 * info into the app-owned "Outreach Status" tab -- read-only
 * reporting, not a second source of truth (see writeOutreachStatusSnapshot).
 * Called from every outreach action so the tab stays essentially
 * always current. Never throws -- a sync failure must not break the
 * action that triggered it.
 */
async function syncOutreachStatusTab() {
  const now = new Date();
  const rows = store.getQueueRows((r) => r.agentPhone).map((r) => {
    const contactedAt = r.contactedAt ? new Date(r.contactedAt) : null;
    const daysSinceContacted = contactedAt ? Math.floor((now - contactedAt) / (24 * 60 * 60 * 1000)) : null;
    return {
      propertyAddress: r.propertyAddress,
      agentName: r.agentName,
      agentPhone: r.agentPhone,
      status: r.status,
      campaign: r.campaign,
      contactedAt: r.contactedAt,
      daysSinceContacted,
      lastUpdated: r.lastUpdated
    };
  });
  try {
    return await writeOutreachStatusSnapshot(rows);
  } catch (err) {
    return { error: err.message };
  }
}

async function checkReplies() {
  const rows = store.getQueueRows((r) => r.status === 'Contacted');
  if (rows.length === 0) {
    const results = [];
    results.statusTabSync = await syncOutreachStatusTab();
    return results;
  }

  const earliestContacted = rows.reduce((min, r) => {
    if (!r.contactedAt) return min;
    const t = new Date(r.contactedAt);
    return !min || t < min ? t : min;
  }, null);

  const emails = await gmailClient.searchVoiceReplyEmails(earliestContacted);
  const now = new Date();
  const results = [];

  for (const row of rows) {
    const rowDigits = last10Digits(row.agentPhone);
    const contactedAt = row.contactedAt ? new Date(row.contactedAt) : null;
    const matches = emails
      .filter((e) => e.fromPhoneDigits.slice(-10) === rowDigits && (!contactedAt || e.date >= contactedAt))
      .sort((a, b) => b.date - a.date);

    if (matches.length > 0) {
      const replyText = extractReplyText(matches[0].body);
      const classification = classifyReply(replyText);
      const timestamp = new Date().toISOString();

      if (classification === 'yes') {
        store.updateQueueRow(row.id, { status: 'Replied', lastUpdated: timestamp });
        store.updateQueueRow(row.id, { status: 'Handed Off', qualificationReasons: 'Auto-routed: reply was "' + replyText + '"', lastUpdated: timestamp });
        const notifyError = await notifyGoogleChat(
          'Positive reply: ' + row.agentName + ' (' + row.agentPhone + ') on ' + row.propertyAddress +
          ' replied "' + replyText + '" -- time to follow up directly.'
        );
        results.push({ id: row.id, address: row.propertyAddress, result: 'Handed Off', replyText, notifyError });
      } else if (classification === 'no') {
        store.updateQueueRow(row.id, { status: 'Opted Out', qualificationReasons: 'Auto-routed: reply was "' + replyText + '"', lastUpdated: timestamp });
        const notifyError = await notifyGoogleChat(
          'Opt-out: ' + row.agentName + ' (' + row.agentPhone + ') on ' + row.propertyAddress +
          ' replied "' + replyText + '" -- marked Opted Out, no further outreach will be sent.'
        );
        results.push({ id: row.id, address: row.propertyAddress, result: 'Opted Out', replyText, notifyError });
      } else {
        store.updateQueueRow(row.id, { status: 'Replied', qualificationReasons: 'Reply needs human review: "' + replyText + '"', lastUpdated: timestamp });
        results.push({ id: row.id, address: row.propertyAddress, result: 'Replied (needs review)', replyText });
      }
    } else if (contactedAt && (now - contactedAt) >= FOLLOWUP_AFTER_MS) {
      store.updateQueueRow(row.id, { status: 'Follow-Up Due', lastUpdated: new Date().toISOString() });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Follow-Up Due' });
    } else {
      results.push({ id: row.id, address: row.propertyAddress, result: 'No reply yet' });
    }
  }

  results.statusTabSync = await syncOutreachStatusTab();
  return results;
}

/**
 * REI BlackBook equivalent of checkReplies() above -- same routing
 * rules (YES -> Handed Off, NO/opt-out -> Opted Out, anything else ->
 * Replied for a human, 3 days of silence -> Follow-Up Due) and the
 * same Google Chat notification on YES/NO, but reads the reply from
 * REI BlackBook's own Chat history instead of a Gmail notification
 * email. Only touches rows reached via REI BlackBook (reiContactLink
 * set) -- checkReplies() still owns everything else. Requires a human
 * to have logged into REI BlackBook already; stops per-row, not the
 * whole run, if a contact's history can't be read.
 */
async function checkReiBlackBookReplies() {
  const rows = store.getQueueRows((r) => r.status === 'Contacted' && r.reiContactLink);
  if (rows.length === 0) {
    const results = [];
    results.statusTabSync = await syncOutreachStatusTab();
    return results;
  }

  const now = new Date();
  const results = [];
  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  try {
    const page = context.pages()[0] || (await context.newPage());
    for (const row of rows) {
      const contactedAt = row.contactedAt ? new Date(row.contactedAt) : null;
      let activity;
      try {
        activity = await getChatHistory(page, row.reiContactLink);
      } catch (err) {
        results.push({ id: row.id, address: row.propertyAddress, result: 'Error', error: err.message });
        continue;
      }
      const inboundReplies = activity
        .filter((a) => isInboundActivity(a) && (!contactedAt || new Date(a.created_at) >= contactedAt))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (inboundReplies.length > 0) {
        const replyText = String(inboundReplies[0].body || '').trim();
        const classification = classifyReply(replyText);
        const timestamp = new Date().toISOString();

        if (classification === 'yes') {
          store.updateQueueRow(row.id, { status: 'Handed Off', qualificationReasons: 'Auto-routed: reply was "' + replyText + '"', lastUpdated: timestamp });
          const notifyError = await notifyGoogleChat(
            'Positive reply (REI BlackBook): ' + row.agentName + ' (' + row.agentPhone + ') on ' + row.propertyAddress +
            ' replied "' + replyText + '" -- time to follow up directly.'
          );
          results.push({ id: row.id, address: row.propertyAddress, result: 'Handed Off', replyText, notifyError });
        } else if (classification === 'no') {
          store.updateQueueRow(row.id, { status: 'Opted Out', qualificationReasons: 'Auto-routed: reply was "' + replyText + '"', lastUpdated: timestamp });
          const notifyError = await notifyGoogleChat(
            'Opt-out (REI BlackBook): ' + row.agentName + ' (' + row.agentPhone + ') on ' + row.propertyAddress +
            ' replied "' + replyText + '" -- marked Opted Out, no further outreach will be sent.'
          );
          results.push({ id: row.id, address: row.propertyAddress, result: 'Opted Out', replyText, notifyError });
        } else {
          store.updateQueueRow(row.id, { status: 'Replied', qualificationReasons: 'Reply needs human review: "' + replyText + '"', lastUpdated: timestamp });
          results.push({ id: row.id, address: row.propertyAddress, result: 'Replied (needs review)', replyText });
        }
      } else if (contactedAt && (now - contactedAt) >= FOLLOWUP_AFTER_MS) {
        store.updateQueueRow(row.id, { status: 'Follow-Up Due', lastUpdated: new Date().toISOString() });
        results.push({ id: row.id, address: row.propertyAddress, result: 'Follow-Up Due' });
      } else {
        results.push({ id: row.id, address: row.propertyAddress, result: 'No reply yet' });
      }
    }
  } finally {
    await context.close();
  }
  results.statusTabSync = await syncOutreachStatusTab();
  return results;
}

/**
 * Read-only dashboard summary sourced straight from the "Outreach
 * Review" tab -- the authoritative, human-facing Sheet surface -- so the
 * app's Dashboard reflects exactly what a person sees in the sheet, not
 * the local working cache (which can hold older/test rows that were
 * never part of the current Sheet-driven flow). Buckets leads by their
 * "Ready for Automated Outreach?" decision.
 */
async function getOutreachReviewSummary() {
  const rows = await getOutreachReviewRows();
  const summary = {
    total: rows.length,
    ready: 0,
    awaitingReview: 0,
    notReady: 0,
    missingPhone: 0,
    byDecision: {}
  };
  rows.forEach((r) => {
    const decision = String(r.readyForAutomatedOutreach || '').trim();
    const label = decision === '' ? '(awaiting review)' : decision;
    summary.byDecision[label] = (summary.byDecision[label] || 0) + 1;
    if (decision.toLowerCase() === 'yes') summary.ready++;
    else if (decision === '') summary.awaitingReview++;
    else summary.notReady++;
    if (!String(r.agentPhone || '').trim()) summary.missingPhone++;
  });
  return summary;
}

/**
 * Good Flip -> outreach, the Sheet-driven trigger with NO "Ready" gate.
 * Computes the set of Good Flip addresses from the live Flip Scout Leads
 * tab, hands the pipeline the feed contacts, and syncs the status tab.
 * The pipeline (src/outreach/goodFlipPipeline.js) resolves each lead's
 * contact through feed -> REI -> MLS -> enrichment -> human research,
 * validates it, prevents duplicates, honors the kill switch, and records a
 * recoverable status. Sending nothing unless a Good Flip lead has a valid
 * contact and the channel's ENABLE_* flag is on.
 */
async function runGoodFlipPipeline() {
  const leads = await listFlipScoutLeads();
  const goodFlipAddresses = new Set(
    leads.filter((l) => l.isGoodFlip).map((l) => normalizeAddress(l.address))
  );
  let feedMap = new Map();
  try { feedMap = (await loadFeedAgentContacts()).contacts; } catch (err) { /* best-effort */ }
  const outcome = await goodFlipPipeline.processGoodFlipLeads({ goodFlipAddresses, feedMap });
  outcome.sheetSync = await syncOutreachStatusTab();
  return outcome;
}

function listRows() {
  return store.getQueueRows().map((r) => ({
    id: r.id,
    address: r.propertyAddress,
    status: r.status,
    agentPhone: r.agentPhone,
    agentEmail: r.agentEmail
  }));
}

function getRow(id) {
  return store.getQueueRows((r) => r.id === id)[0] || null;
}

module.exports = {
  listFlipScoutLeads,
  addFromFlipScout,
  autoQueueFromFlipScout,
  syncGoodFlipLeadsToReview,
  syncOutreachReviewDecisions,
  computeReviewDecisionFields,
  resolveAgentContact,
  runGoodFlipPipeline,
  getOutreachReviewSummary,
  lookupRedfinAgentContact,
  enrichFromReiBlackBook,
  enrichFromMlsListings,
  checkReiBlackBookNotes,
  addRow,
  updateRow,
  getRow,
  refreshValidation,
  submitForApproval,
  approveOutreach,
  sendApprovedEmails,
  checkReplies,
  checkReiBlackBookReplies,
  listRows,
  extractReplyText,
  classifyReply
};
