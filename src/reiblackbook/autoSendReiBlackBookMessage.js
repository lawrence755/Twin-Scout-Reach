#!/usr/bin/env node
/**
 * Auto-send SMS through REI BlackBook's own Chat feature instead of
 * Google Voice -- an alternative channel for rows sourced from REI
 * BlackBook (i.e. row.reiContactLink is set), while Google Voice
 * (src/voice/autoSendGoogleVoiceMessage.js) stays available for
 * everything else (Cowork/Redfin-sourced rows, or any row without an
 * REI link). A row only ever goes out one channel or the other --
 * buildEligibleMessages() here requires reiContactLink, and
 * autoSendGoogleVoiceMessage.js's own filter excludes rows that have
 * one, so a lead can't get double-texted through both.
 *
 * Gated by ENABLE_REI_SMS_SEND (default false), independent of
 * ENABLE_AUTO_SMS_SEND. Same correctness/compliance guards as the
 * Google Voice path are never skipped: fresh qualification,
 * suppression list, duplicate outreach key, unresolved-merge-field
 * checks. On top of those, REI BlackBook enforces its own TCPA
 * opt-in gate -- see sendReiBlackBookText.js -- which this also never
 * bypasses; a not-opted-in contact is routed to Needs Review instead.
 */
const { chromium } = require('playwright');
const config = require('../config');
const { evaluateQualification, QUALIFICATION_STATUS } = require('../../shared/qualification');
const { buildOutreachKey, isSuppressed } = require('../../shared/keys');
const { renderTemplate } = require('../../shared/templateEngine');
const store = require('../outreach/store');
const outreachActions = require('../outreach/actions');
const { sendReiBlackBookText, REI_PROFILE_DIR } = require('./sendReiBlackBookText');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const followupSmsTemplate = require('../../templates/followup-sms.v1.json');
const finalSmsTemplate = require('../../templates/final-sms.v1.json');

const MAX_FOLLOWUPS = 2;

function getOutreachQueueRows(filterFn) {
  return store.getQueueRows(filterFn);
}
// Goes through actions.js's updateRow(), not a direct store write --
// that's what actually keeps the "Outreach Status" Sheet tab synced
// after a real send (a direct store.updateQueueRow() call, like the
// Google Voice script still uses, silently skips that sync -- the
// Sheet stays stale until some other action happens to trigger one).
function updateOutreachQueueRow(id, fields) {
  return outreachActions.updateRow(id, fields);
}
function appendAutoOutreachLog(fields) {
  return store.appendCommunicationLog({ ...fields, autoSent: true });
}
function getSuppressionList() {
  return store.getSuppressionList();
}

function isReiSmsSendEnabled() {
  // config.isLiveEnabled reads the .env FILE fresh, not this spawned
  // process's inherited (and possibly stale) process.env -- so flipping
  // the Settings toggle off takes effect on the very next run, no app
  // restart. See src/config/index.js.
  return config.isLiveEnabled('ENABLE_REI_SMS_SEND');
}

function coerceBoolean(value) {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'TRUE' || normalized === 'YES') return true;
  if (normalized === 'FALSE' || normalized === 'NO' || normalized === '') return false;
  return undefined;
}

/**
 * Same sequencing as the Google Voice path -- see its own comment for
 * the table. Checks !row.smsSentAt (not just status === 'Approved')
 * for the initial send -- a real bug found live: if email sends
 * first for a row with both agentEmail and agentPhone, it moves
 * status straight to 'Contacted', which used to make this function
 * silently skip the SMS side entirely (whichever channel ran first
 * "stole" the shared Approved status). smsSentAt is this channel's
 * own independent completion marker, so it no longer depends on the
 * other channel not having already advanced status.
 */
function pickTemplateForRow(row) {
  if (!row.smsSentAt && (row.status === 'Approved' || row.status === 'Contacted')) {
    return { template: initialSmsTemplate, nextFollowupCount: 0 };
  }
  if (row.status !== 'Follow-Up Due') return null;
  const followupCount = Number(row.followupCount || 0);
  if (followupCount >= MAX_FOLLOWUPS) return null;
  return followupCount === 0
    ? { template: followupSmsTemplate, nextFollowupCount: 1 }
    : { template: finalSmsTemplate, nextFollowupCount: 2 };
}

async function buildEligibleMessages() {
  const rows = await getOutreachQueueRows((row) =>
    row.agentPhone && row.reiContactLink &&
    (row.status === 'Approved' || row.status === 'Follow-Up Due' || (row.status === 'Contacted' && !row.smsSentAt)));
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

async function main() {
  if (!isReiSmsSendEnabled()) {
    const items = await buildEligibleMessages();
    const ready = items.filter((i) => !i.blocked);
    console.log('ENABLE_REI_SMS_SEND is not "true" -- no browser opened, nothing sent.');
    console.log(ready.length + ' message(s) would be eligible to auto-send via REI BlackBook once enabled:');
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
    console.log('No rows are eligible to auto-send via REI BlackBook.');
    return;
  }

  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());

  for (const item of ready) {
    let outcome;
    try {
      await sendReiBlackBookText(page, item.row.reiContactLink, item.body);
      outcome = { result: 'Sent', notes: '' };
    } catch (err) {
      outcome = { result: 'Needs Review', notes: err.message };
    }
    // Built conditionally rather than always including every key --
    // spreading an explicit `undefined` into a stored row (the old
    // code always did, even on failure) erases whatever was already
    // there for that field, e.g. wiping out a contactedAt the email
    // side had already set.
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
      channel: 'SMS (REI BlackBook)',
      templateId: item.templateId,
      messageBody: item.body,
      result: outcome.result,
      notes: outcome.notes
    });
    console.log(item.row.agentPhone + ' (' + item.templateId + '): ' + outcome.result + (outcome.notes ? ' -- ' + outcome.notes : ''));
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
