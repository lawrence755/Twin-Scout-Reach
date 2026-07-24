/**
 * Node-side equivalents of the Apps Script "Outreach" menu items, so
 * the desktop app can drive the Outreach Queue directly instead of
 * requiring a trip to the Sheet for every step. Reuses the exact same
 * shared/ rule engine Apps Script uses, so the two stay behaviorally
 * identical.
 *
 * Deliberately does NOT include Gmail sending -- GmailApp in Apps
 * Script needs no separate OAuth setup, while sending from Node would
 * require a whole new Gmail API OAuth flow. "Send approved emails"
 * stays a Sheet-menu action for now; see README.md.
 */
const config = require('../config');
const { evaluateQualification } = require('../../shared/qualification');
const { isSuppressed, buildOutreachKey, buildContactKey } = require('../../shared/keys');
const { canTransition } = require('../../shared/statusFlow');
const { renderTemplate, extractMergeFields } = require('../../shared/templateEngine');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const initialEmailTemplate = require('../../templates/initial-email.v1.json');
const {
  getOutreachQueueRows,
  updateOutreachQueueRow,
  appendOutreachQueueRow,
  getSuppressionList,
  getSettings,
  appendCommunicationLog
} = require('./sheetsClient');
const gmailClient = require('../gmail/gmailClient');

const PRE_APPROVAL_STATUSES = ['Information Needed', 'Needs Review', 'Ready for Drafting'];

function coerceBoolean(value) {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'TRUE' || normalized === 'YES') return true;
  if (normalized === 'FALSE' || normalized === 'NO' || normalized === '') return false;
  return undefined;
}

/**
 * Adds one row to Outreach Queue -- used by the app's "Add row" form
 * for both real leads (pasted in by hand) and internal test rows.
 */
async function addRow(fields) {
  const campaign = fields.campaign || 'internal-test';
  const now = new Date().toISOString();
  await appendOutreachQueueRow({
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
 * Equivalent of the "Refresh validation" menu item.
 */
async function refreshValidation() {
  const rows = await getOutreachQueueRows();
  const suppressionList = await getSuppressionList();
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
    await updateOutreachQueueRow(row.__rowNumber, {
      status: nextStatus,
      qualificationReasons: result.reasons.join(' '),
      lastUpdated: new Date().toISOString()
    });
    results.push({ row: row.__rowNumber, address: row.propertyAddress, status: nextStatus, reasons: result.reasons });
  }
  return results;
}

/**
 * Equivalent of the "Submit for approval" menu item.
 */
async function submitForApproval() {
  const rows = await getOutreachQueueRows((r) => r.status === 'Ready for Drafting');
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
    await updateOutreachQueueRow(row.__rowNumber, fields);
    results.push({ row: row.__rowNumber, address: row.propertyAddress, status: fields.status, problems });
  }
  return results;
}

/**
 * Equivalent of the "Approve outreach" menu item -- approves every row
 * currently Pending Approval (the app has no per-row selection UI, so
 * this is all-or-nothing, unlike the Sheet's row-selection version).
 */
async function approveOutreach() {
  const rows = await getOutreachQueueRows((r) => r.status === 'Pending Approval');
  const results = [];
  for (const row of rows) {
    await updateOutreachQueueRow(row.__rowNumber, { status: 'Approved', lastUpdated: new Date().toISOString() });
    results.push({ row: row.__rowNumber, address: row.propertyAddress });
  }
  return results;
}

function isTruthySetting(value) {
  return String(value || '').trim().toUpperCase() === 'TRUE';
}

/**
 * Node-side equivalent of the "Send approved emails" menu item, using
 * the Gmail API (src/gmail/gmailClient.js) instead of GmailApp.
 *
 * Two independent gates, both must be true to actually send -- the
 * Sheet's "Enable Email Sending" switch (the same one Apps Script
 * reads, so there's one source of truth for intent) AND the .env
 * ENABLE_EMAIL_SENDING flag (Node-only, matches how ENABLE_VOICE_AUTOMATION
 * already works as a second independent layer). Either one being off
 * means dry-run only. Every other safety check re-runs immediately
 * before sending, same as the Apps Script version.
 */
async function sendApprovedEmails() {
  const settings = await getSettings();
  const sendingEnabled = isTruthySetting(settings['Enable Email Sending']) && config.flags.emailSendingEnabled;
  const suppressionList = await getSuppressionList();
  const rows = await getOutreachQueueRows(
    (r) => r.status === 'Approved' && r.agentEmail && r.renderedEmailBody
  );

  const results = [];
  for (const row of rows) {
    const problems = [];
    if (coerceBoolean(row.doNotAutomate)) problems.push('Do Not Automate is set.');
    if (isSuppressed(row.agentPhone, suppressionList)) problems.push('Agent is on the Suppression List.');
    if (extractMergeFields(row.renderedEmailSubject).length > 0 || extractMergeFields(row.renderedEmailBody).length > 0) {
      problems.push('Rendered email still has unresolved merge fields.');
    }

    if (problems.length > 0) {
      await updateOutreachQueueRow(row.__rowNumber, {
        status: 'Needs Review',
        qualificationReasons: problems.join(' '),
        lastUpdated: new Date().toISOString()
      });
      await appendCommunicationLog({
        timestamp: new Date().toISOString(), outreachKey: row.outreachKey, contactKey: row.contactKey,
        propertyAddress: row.propertyAddress, agentName: row.agentName, agentPhone: row.agentPhone,
        agentEmail: row.agentEmail, channel: 'email', templateId: row.emailTemplateId, templateVersion: row.emailTemplateId,
        subject: row.renderedEmailSubject, messageBody: row.renderedEmailBody, sender: config.sender.email,
        result: 'Blocked', notes: problems.join(' ')
      });
      results.push({ row: row.__rowNumber, address: row.propertyAddress, result: 'Blocked', notes: problems.join(' ') });
      continue;
    }

    if (sendingEnabled) {
      await gmailClient.sendEmail({ to: row.agentEmail, subject: row.renderedEmailSubject, body: row.renderedEmailBody });
      await updateOutreachQueueRow(row.__rowNumber, { status: 'Contacted', lastUpdated: new Date().toISOString() });
      await appendCommunicationLog({
        timestamp: new Date().toISOString(), outreachKey: row.outreachKey, contactKey: row.contactKey,
        propertyAddress: row.propertyAddress, agentName: row.agentName, agentPhone: row.agentPhone,
        agentEmail: row.agentEmail, channel: 'email', templateId: row.emailTemplateId, templateVersion: row.emailTemplateId,
        subject: row.renderedEmailSubject, messageBody: row.renderedEmailBody, sender: config.sender.email,
        result: 'Sent', notes: ''
      });
      results.push({ row: row.__rowNumber, address: row.propertyAddress, result: 'Sent' });
    } else {
      await appendCommunicationLog({
        timestamp: new Date().toISOString(), outreachKey: row.outreachKey, contactKey: row.contactKey,
        propertyAddress: row.propertyAddress, agentName: row.agentName, agentPhone: row.agentPhone,
        agentEmail: row.agentEmail, channel: 'email', templateId: row.emailTemplateId, templateVersion: row.emailTemplateId,
        subject: row.renderedEmailSubject, messageBody: row.renderedEmailBody, sender: config.sender.email,
        result: 'Dry Run', notes: 'Enable Email Sending is FALSE in the Settings tab -- no message was actually sent.'
      });
      results.push({ row: row.__rowNumber, address: row.propertyAddress, result: 'Dry Run' });
    }
  }
  return { sendingEnabled, results };
}

async function listRows() {
  const rows = await getOutreachQueueRows();
  return rows.map((r) => ({
    row: r.__rowNumber,
    address: r.propertyAddress,
    status: r.status,
    agentPhone: r.agentPhone,
    agentEmail: r.agentEmail
  }));
}

module.exports = { addRow, refreshValidation, submitForApproval, approveOutreach, sendApprovedEmails, listRows };
