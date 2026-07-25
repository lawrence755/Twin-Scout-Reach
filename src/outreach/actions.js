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
const config = require('../config');
const { evaluateQualification } = require('../../shared/qualification');
const { isSuppressed, buildOutreachKey, buildContactKey } = require('../../shared/keys');
const { canTransition } = require('../../shared/statusFlow');
const { renderTemplate, extractMergeFields } = require('../../shared/templateEngine');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const initialEmailTemplate = require('../../templates/initial-email.v1.json');
const store = require('./store');
const { getFlipScoutLeads, GOOD_FLIP_QUALITY, updateContactedColumn, writeOutreachStatusSnapshot } = require('../sheets/sheetsClient');
const gmailClient = require('../gmail/gmailClient');
const { postToGoogleChat } = require('../notifications/googleChat');

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
    flipQuality: l.flipQuality,
    isGoodFlip: l.flipQuality === GOOD_FLIP_QUALITY
  }));
}

/**
 * Pulls selected Flip Scout Leads rows (by sheetRow) into the local
 * Outreach Queue -- the app-side equivalent of "Add selected Flip
 * Scout rows." Only property/city/Redfin link/campaign are prefilled;
 * agent contact info and the Phase 3 verification fields are still
 * added by hand afterward (same as the original design -- a human
 * verifies those, nothing here guesses at them).
 */
async function addFromFlipScout(sheetRows, campaign) {
  const leads = await getFlipScoutLeads((l) => sheetRows.includes(l.__sheetRow));
  const existingKeys = store.getQueueRows().map((r) => r.outreachKey).filter(Boolean);
  const added = [];
  const skipped = [];

  for (const lead of leads) {
    const outreachKey = buildOutreachKey('', lead.propertyAddress, campaign || 'flip-scout');
    // No agent phone yet at this point, so outreachKey/contactKey are
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
      flipScoutRowRef: lead.sheetRow,
      outreachKey,
      dateAdded: now,
      lastUpdated: now
    });
    existingKeys.push(outreachKey);
    added.push(row);
  }
  return { added, skipped };
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
      doNotAutomate: coerceBoolean(row.doNotAutomate)
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
  const rows = store.getQueueRows((r) => r.status === 'Approved' && r.agentEmail && r.renderedEmailBody);

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
      store.updateQueueRow(row.id, { status: 'Contacted', contactedAt: new Date().toISOString(), lastUpdated: new Date().toISOString() });
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
 * Mirrors current outreach status back into the Flip Scout Leads
 * sheet's "Contacted?" column so Bryan/the team can see progress
 * without opening the app -- Handed Off wins if two Outreach Queue
 * rows share an address with different statuses (more informative
 * than "Following Up" once a human has actually taken over). Runs
 * regardless of whether there were any new Gmail replies to check,
 * since existing rows' status can still need re-syncing.
 */
async function syncContactedColumn() {
  const statusByAddress = {};
  for (const r of store.getQueueRows(() => true)) {
    let sheetStatus = null;
    if (r.status === 'Handed Off') sheetStatus = 'Handed Off';
    else if (['Contacted', 'Follow-Up Due', 'Replied'].includes(r.status)) sheetStatus = 'Following Up';
    if (!sheetStatus) continue;
    if (statusByAddress[r.propertyAddress] !== 'Handed Off') {
      statusByAddress[r.propertyAddress] = sheetStatus;
    }
  }
  try {
    return await updateContactedColumn(statusByAddress);
  } catch (err) {
    return { error: err.message };
  }
}

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
    results.sheetSync = await syncContactedColumn();
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

  results.sheetSync = await syncContactedColumn();
  results.statusTabSync = await syncOutreachStatusTab();
  return results;
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
  addRow,
  updateRow,
  getRow,
  refreshValidation,
  submitForApproval,
  approveOutreach,
  sendApprovedEmails,
  checkReplies,
  listRows,
  extractReplyText,
  classifyReply
};
