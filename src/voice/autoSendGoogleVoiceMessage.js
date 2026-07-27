#!/usr/bin/env node
/**
 * Auto-send Google Voice SMS: opens Google Voice, enters the message,
 * and clicks Send itself -- no operator confirmation. This is a
 * separate, more dangerous capability from
 * src/voice/prepareGoogleVoiceMessage.js (which is untouched and still
 * always stops before Send). It exists because it was explicitly
 * requested (2026-07-23) as a deliberate change from Phase 7 of the
 * plan. Read docs/AUTO_MODE_RISKS.md before turning this on --
 * TCPA/compliance exposure and Google account automation risk are
 * real and are not mitigated by anything in this file.
 *
 * Gated by ENABLE_AUTO_SMS_SEND (default false), independent of
 * ENABLE_VOICE_AUTOMATION. What is NOT skipped even in this mode:
 * fresh qualification, suppression list, duplicate outreach key, and
 * unresolved-merge-field checks -- those are correctness/compliance
 * guards, not "approval," and are never bypassed.
 */
const { chromium } = require('playwright');
const config = require('../config');
const { evaluateQualification, QUALIFICATION_STATUS } = require('../../shared/qualification');
const { buildOutreachKey, isSuppressed } = require('../../shared/keys');
const { renderTemplate } = require('../../shared/templateEngine');
const store = require('../outreach/store');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const followupSmsTemplate = require('../../templates/followup-sms.v1.json');
const finalSmsTemplate = require('../../templates/final-sms.v1.json');

// Phase 9 sequence: initial -> followup -> final -> stop (Failed
// Contact). followupCount tracks how many of the two follow-ups have
// gone out for a given row (0 = none yet, 1 = followup sent, 2 = final
// sent -- sequence exhausted after that).
const MAX_FOLLOWUPS = 2;

function getOutreachQueueRows(filterFn) {
  return store.getQueueRows(filterFn);
}
function updateOutreachQueueRow(id, fields) {
  return store.updateQueueRow(id, { ...fields, lastUpdated: new Date().toISOString() });
}
function appendAutoOutreachLog(fields) {
  return store.appendCommunicationLog({ ...fields, autoSent: true });
}
function getSuppressionList() {
  return store.getSuppressionList();
}

const GOOGLE_VOICE_URL = 'https://voice.google.com/u/0/messages';

function isAutoSmsSendEnabled() {
  // config.isLiveEnabled reads the .env FILE fresh, not this spawned
  // process's inherited (and possibly stale) process.env -- so flipping
  // the Settings toggle off takes effect on the very next run, no app
  // restart. See src/config/index.js.
  return config.isLiveEnabled('ENABLE_AUTO_SMS_SEND');
}

/**
 * Picks the right template for a row's current point in the sequence.
 * Returns null (with a reason) once both follow-ups have already gone
 * out -- Phase 9's "limit the sequence to two follow-ups," after which
 * outreach stops rather than texting indefinitely.
 *
 * Checks !row.smsSentAt (not just status === 'Approved') for the
 * initial send -- a real bug found live on the REI BlackBook channel,
 * same code shape here: if email sends first for a row with both
 * agentEmail and agentPhone, it moves status straight to 'Contacted',
 * which used to make this silently skip the SMS side entirely
 * (whichever channel ran first "stole" the shared Approved status).
 * smsSentAt is this channel's own independent completion marker.
 */
function pickTemplateForRow(row) {
  if (!row.smsSentAt && (row.status === 'Approved' || row.status === 'Contacted')) {
    return { template: initialSmsTemplate, nextFollowupCount: 0 };
  }
  if (row.status !== 'Follow-Up Due') return null;
  const followupCount = Number(row.followupCount || 0);
  if (followupCount >= MAX_FOLLOWUPS) return null; // sequence exhausted
  return followupCount === 0
    ? { template: followupSmsTemplate, nextFollowupCount: 1 }
    : { template: finalSmsTemplate, nextFollowupCount: 2 };
}

async function buildEligibleMessages() {
  // Must match sendApprovedEmails()'s gate for the initial send --
  // Approved, or already Contacted via the other channel but not yet
  // sent on THIS one (!smsSentAt). Still excludes anything not
  // actually approved (Information Needed, Needs Review, etc.) --
  // that was the earlier, separate bug ("anything not Handed Off" was
  // too loose); this is narrower; a row only reaches Contacted after
  // passing through Approved in the first place.
  const rows = await getOutreachQueueRows((row) =>
    row.agentPhone && (row.status === 'Approved' || row.status === 'Follow-Up Due' || (row.status === 'Contacted' && !row.smsSentAt)));
  const suppressionList = await getSuppressionList();
  const allOutreachKeys = rows.map((row) => row.outreachKey);
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

    const qualification = evaluateQualification(lead);
    if (qualification.status !== QUALIFICATION_STATUS.READY) {
      results.push({ row, blocked: true, reason: qualification.reasons.join(' ') || qualification.status });
      continue;
    }

    const picked = pickTemplateForRow(row);
    if (!picked) {
      results.push({ row, blocked: true, reason: 'Follow-up sequence exhausted (final message already sent).' });
      continue;
    }

    const outreachKey = row.outreachKey || buildOutreachKey(row.agentPhone, row.propertyAddress, row.campaign || 'flip-scout');
    try {
      const rendered = renderTemplate(picked.template, {
        ...mergeBase,
        agentFirstName: (row.agentName || '').trim().split(/\s+/)[0] || '',
        propertyAddress: row.propertyAddress,
        city: row.city
      });
      results.push({
        row, blocked: false, outreachKey, body: rendered.body,
        templateId: picked.template.id + '.v' + picked.template.version,
        nextFollowupCount: picked.nextFollowupCount
      });
    } catch (err) {
      results.push({ row, blocked: true, reason: 'SMS: ' + err.message });
    }
  }
  return results;
}

function coerceBoolean(value) {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'TRUE' || normalized === 'YES') return true;
  if (normalized === 'FALSE' || normalized === 'NO' || normalized === '') return false;
  return undefined;
}

async function sendOne(page, item) {
  await page.getByRole('button', { name: /send (a )?new message|start a new conversation/i }).click();
  await page.waitForTimeout(1500);
  const recipientInput = page.getByPlaceholder(/type a name or phone number/i);
  await recipientInput.fill(item.row.agentPhone);
  await page.waitForTimeout(1500);
  // Verified against the live UI via Playwright's recorder: the correct
  // recipient-suggestion control is a proper ARIA button named
  // "Send to <number>". CAUTION: Google Voice's persistent right-side
  // call panel shows a sidebar list of frequently-contacted people as
  // plain <li> elements with no ARIA role at all -- clicking one of
  // THOSE calls them instead of adding a message recipient (this
  // previously placed a real, live call to a real contact). Targeting
  // getByRole('button', ...) is what makes this safe: the call panel's
  // rows aren't buttons, so this can't match them. Do not change this to
  // a bare text/li selector.
  await page.getByRole('button', { name: /^send to/i }).click();
  // Running the fill/click steps back-to-back with no pause caused a
  // real, confirmed bug: a stale/leftover draft in the compose box got
  // sent instead of the freshly-filled text, even though the in-script
  // verification check (below) read back the correct value. Adding a
  // pause here before interacting with the compose box is what fixed it
  // -- verified against the live UI by deliberately re-running slowly.
  await page.waitForTimeout(1500);

  const composeBox = page.getByRole('textbox', { name: /type a message/i });
  await composeBox.fill(item.body);
  await page.waitForTimeout(1500);

  const enteredText = (await composeBox.inputValue().catch(() => null)) ?? (await composeBox.innerText());
  if (enteredText.trim() !== item.body.trim()) {
    return { result: 'Blocked', notes: 'Compose box did not match the approved SMS body exactly -- did not send.' };
  }

  // The one line in this file that actually sends. No operator
  // confirmation gates this -- see the file header.
  await page.getByRole('button', { name: /send message/i }).click();
  // Confirmed real bug: clicking Send only triggers the actual network
  // request async -- with no wait here, main()'s context.close() (right
  // after this returns, for the last/only item) could kill the browser
  // before that request completes, so Playwright sees a successful click
  // but the text never actually goes out. Verified against the live UI:
  // manual runs with a pause after the click delivered every time; this
  // function with no pause silently failed to deliver more than once.
  await page.waitForTimeout(3000);

  return { result: 'Sent', notes: '' };
}

async function main() {
  if (!isAutoSmsSendEnabled()) {
    const items = await buildEligibleMessages();
    const ready = items.filter((i) => !i.blocked);
    console.log('ENABLE_AUTO_SMS_SEND is not "true" -- no browser opened, nothing sent.');
    console.log(ready.length + ' message(s) would be eligible to auto-send once enabled:');
    ready.forEach((i) => console.log('  - ' + i.row.agentName + ' (' + i.row.agentPhone + ') -- ' + i.row.propertyAddress));
    return;
  }

  const items = await buildEligibleMessages();
  const ready = items.filter((i) => !i.blocked);

  for (const item of items.filter((i) => i.blocked)) {
    let status = 'Needs Review';
    if (item.reason.toLowerCase().includes('duplicate')) status = 'Duplicate';
    else if (item.reason.toLowerCase().includes('sequence exhausted')) status = 'Failed Contact';
    await updateOutreachQueueRow(item.row.id, { status, qualificationReasons: item.reason });
  }

  if (ready.length === 0) {
    console.log('No rows are eligible to auto-send.');
    return;
  }

  const context = await chromium.launchPersistentContext(config.voice.profileDir, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(GOOGLE_VOICE_URL);

  for (const item of ready) {
    const outcome = await sendOne(page, item);
    // Built conditionally, not with every key always present -- an
    // explicit `undefined` spread into a stored row erases whatever
    // was already there for that field (e.g. wiping out a contactedAt
    // the email side had already set), even on a failed attempt.
    const updateFields = { qualificationReasons: outcome.notes };
    if (outcome.result === 'Sent') {
      updateFields.status = 'Contacted';
      updateFields.contactedAt = item.row.contactedAt || new Date().toISOString();
      updateFields.smsSentAt = new Date().toISOString();
      updateFields.followupCount = item.nextFollowupCount;
    } else {
      updateFields.status = 'Needs Review';
    }
    await updateOutreachQueueRow(item.row.id, updateFields);
    await appendAutoOutreachLog({
      timestamp: new Date().toISOString(),
      outreachKey: item.outreachKey,
      propertyAddress: item.row.propertyAddress,
      agentName: item.row.agentName,
      agentPhone: item.row.agentPhone,
      agentEmail: item.row.agentEmail,
      redfinLink: item.row.redfinLink,
      channel: 'SMS',
      templateId: item.templateId,
      messageBody: item.body,
      result: outcome.result,
      notes: outcome.notes
    });
    console.log(item.row.agentPhone + ' (' + item.templateId + '): ' + outcome.result);
  }

  await context.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { buildEligibleMessages };
