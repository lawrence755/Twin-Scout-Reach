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
const { getFlipScoutLeads, GOOD_FLIP_QUALITY } = require('../sheets/sheetsClient');
const gmailClient = require('../gmail/gmailClient');

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
  return store.appendQueueRow({
    status: 'Information Needed',
    dateAdded: now,
    lastUpdated: now,
    ...fields,
    campaign,
    outreachKey: buildOutreachKey(fields.agentPhone, fields.propertyAddress, campaign),
    contactKey: buildContactKey(fields.agentPhone)
  });
}

/**
 * Updates an existing row by id -- used when filling in agent contact
 * info / Phase 3 verification fields after adding from Flip Scout.
 */
async function updateRow(id, fields) {
  if (fields.agentPhone !== undefined) {
    fields.contactKey = buildContactKey(fields.agentPhone);
  }
  return store.updateQueueRow(id, { ...fields, lastUpdated: new Date().toISOString() });
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
      store.updateQueueRow(row.id, { status: 'Contacted', lastUpdated: new Date().toISOString() });
      store.appendCommunicationLog({ ...logBase, result: 'Sent', notes: '' });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Sent' });
    } else {
      store.appendCommunicationLog({ ...logBase, result: 'Dry Run', notes: 'ENABLE_EMAIL_SENDING is false in .env -- no message was actually sent.' });
      results.push({ id: row.id, address: row.propertyAddress, result: 'Dry Run' });
    }
  }
  return { sendingEnabled, results };
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
  listRows
};
