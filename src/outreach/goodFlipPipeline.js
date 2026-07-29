/**
 * Good Flip -> outreach pipeline.
 *
 * The trigger is "Good Flip = Yes" ALONE -- no "Ready for Automated
 * Outreach?" gate. For each Good Flip lead it: validates the property,
 * resolves the listing agent's contact through the source chain
 * (feed -> REI BlackBook -> MLS -> enrichment -> human research), validates
 * and cleans that contact, prevents duplicate sends, respects the
 * ENABLE_* kill switches, renders the approved template, sends (email
 * inline; SMS handed to the existing SMS jobs), and records everything.
 *
 * Statuses are recoverable: a lead that is missing data or fails a send is
 * parked in a status it can re-enter from later, never permanently rejected.
 *
 * decideOutreach() is a PURE function (no I/O) so the whole decision matrix
 * -- trigger, validation, dedup, kill switch, channel choice -- is
 * unit-testable. processGoodFlipLeads() does the I/O around it.
 */
const config = require('../config');
const store = require('./store');
const { renderTemplate, extractMergeFields } = require('../../shared/templateEngine');
const { normalizeAddress, isSuppressed } = require('../../shared/keys');
const { validateContact, cleanAddress } = require('../../shared/contactValidation');
const { resolveContact, CONTACT_SOURCE } = require('../../shared/contactResolution');
const initialEmailTemplate = require('../../templates/initial-email.v2.json');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');
const gmailClient = require('../gmail/gmailClient');

// Recoverable pipeline statuses. None is a dead end: an Invalid Data /
// Needs Review / Assisted Research / Send Failed lead re-enters as soon as
// its inputs are corrected or a retry runs.
const PIPELINE_STATUS = {
  PROCESSING: 'Processing',
  INVALID_DATA: 'Invalid Data',
  FINDING_CONTACT: 'Finding Contact',
  MLS_ASSISTED_RESEARCH: 'MLS Assisted Research',
  READY_TO_SEND: 'Ready to Send',
  SENDING: 'Sending',
  SENT: 'Sent',
  SEND_FAILED: 'Send Failed',
  REPLY_RECEIVED: 'Reply Received',
  DUPLICATE_PREVENTED: 'Duplicate Prevented',
  NEEDS_REVIEW: 'Needs Review'
};

// A send is never re-attempted from these; everything else is retryable.
const NON_RETRYABLE = [PIPELINE_STATUS.SENT, PIPELINE_STATUS.DUPLICATE_PREVENTED, PIPELINE_STATUS.REPLY_RECEIVED];

function isGoodFlip(value) {
  return String(value == null ? '' : value).trim().toLowerCase() === 'yes'
    || String(value == null ? '' : value).trim().toLowerCase() === 'good flip';
}

/** Duplicate key: address + recipient + channel + stage. */
function buildSendKey(propertyAddress, recipient, channel, stage) {
  const addr = normalizeAddress(propertyAddress);
  const to = String(recipient || '').replace(/\s+/g, '').toLowerCase();
  if (!addr || !to || !channel) return '';
  return ['send', addr, to, channel, stage || 'initial'].join('|');
}

/** Pick the channel: email when a valid email exists, else SMS when a valid phone exists. */
function chooseChannel(contact) {
  if (contact.emailValid) return 'email';
  if (contact.phoneValid) return 'sms';
  return null;
}

/**
 * PURE decision for one lead. Returns the plan; no sending, no store writes.
 * `ctx` = { sendingEnabled: {email,sms}, sentKeys: Set, suppressionList, stage }.
 */
function decideOutreach(lead, candidates, ctx) {
  ctx = ctx || {};
  const stage = ctx.stage || 'initial';
  const address = cleanAddress(lead && lead.propertyAddress);

  // 1. Trigger: Good Flip = Yes only.
  if (!isGoodFlip(lead && lead.flipQuality)) {
    return { action: 'skip', status: null, reasons: ['Not marked Good Flip -- no outreach.'] };
  }
  // 2. Property validation.
  if (!address) {
    return { action: 'invalid', status: PIPELINE_STATUS.INVALID_DATA, reasons: ['Property address is missing/invalid.'] };
  }
  // 3. Resolve + validate contact through the source chain.
  const resolution = resolveContact(candidates);
  if (resolution.needsHumanResearch) {
    return {
      action: 'assisted-research',
      status: PIPELINE_STATUS.MLS_ASSISTED_RESEARCH,
      source: CONTACT_SOURCE.HUMAN,
      attempts: resolution.attempts,
      reasons: ['No valid contact from feed/REI/MLS/enrichment -- needs human research.']
    };
  }
  const contact = resolution.contact;

  // 4. Suppression / do-not-contact.
  if (contact.phoneValid && isSuppressed(contact.agentPhoneDigits, ctx.suppressionList)) {
    return { action: 'suppressed', status: PIPELINE_STATUS.NEEDS_REVIEW, source: resolution.source, contact, reasons: ['Agent is on the suppression list.'] };
  }

  // 5. Channel selection.
  const channel = chooseChannel(contact);
  if (!channel) {
    return { action: 'assisted-research', status: PIPELINE_STATUS.MLS_ASSISTED_RESEARCH, source: resolution.source, contact, reasons: ['No usable channel (no valid email or phone).'] };
  }
  const recipient = channel === 'email' ? contact.agentEmail : contact.agentPhoneDigits;

  // 6. Duplicate protection.
  const sendKey = buildSendKey(address, recipient, channel, stage);
  if (sendKey && ctx.sentKeys && ctx.sentKeys.has(sendKey)) {
    return { action: 'duplicate', status: PIPELINE_STATUS.DUPLICATE_PREVENTED, source: resolution.source, contact, channel, recipient, sendKey, reasons: ['Already sent this message (same address/recipient/channel/stage).'] };
  }

  // 7. Kill switch: if this channel's sending is disabled, stop at Ready to Send.
  const sendingEnabled = (ctx.sendingEnabled || {})[channel] === true;
  if (!sendingEnabled) {
    return { action: 'blocked-killswitch', status: PIPELINE_STATUS.READY_TO_SEND, source: resolution.source, contact, channel, recipient, sendKey, reasons: ['Validated and ready; ' + channel + ' sending is OFF (kill switch).'] };
  }

  return { action: 'send', status: PIPELINE_STATUS.SENDING, source: resolution.source, contact, channel, recipient, sendKey, reasons: [] };
}

/** Builds the { feed, rei, mls, enrichment } candidate set from a working row + feed map. */
function candidatesForRow(row, feedMap) {
  const feed = feedMap && feedMap.get(normalizeAddress(row.propertyAddress || ''));
  const rei = row.reiContactLink
    ? { agentName: row.reiAgentName || row.agentName, agentPhone: row.agentPhone, agentEmail: row.agentEmail }
    : null;
  const mls = row.mlsAgentPhone || row.mlsAgentEmail
    ? { agentName: row.mlsAgentName, agentPhone: row.mlsAgentPhone, agentEmail: row.mlsAgentEmail }
    : null;
  // Whatever contact already sits on the row (from a prior enrichment) is the
  // enrichment fallback.
  const enrichment = (row.agentPhone || row.agentEmail || row.agentName)
    ? { agentName: row.agentName, agentPhone: row.agentPhone, agentEmail: row.agentEmail }
    : null;
  return { feed: feed || null, rei, mls, enrichment };
}

function mergeData(contact, address, city) {
  return {
    senderName: config.sender.name,
    senderPhone: config.sender.phone,
    senderEmail: config.sender.email,
    handoffPerson: config.sender.handoffPerson,
    companyWebsite: config.sender.companyWebsite,
    yearsInBusiness: config.sender.yearsInBusiness,
    googleReviewLink: config.sender.googleReviewLink,
    agentFirstName: contact.agentFirstName, // already "there" when unknown
    propertyAddress: address,
    city: city || ''
  };
}

/**
 * Processes every Good Flip working row through the pipeline. Email sends
 * happen inline (kill-switch gated); SMS-eligible leads are marked Ready to
 * Send for the existing SMS jobs. Returns a per-lead log array (also
 * appended to the communication log).
 */
async function processGoodFlipLeads(opts) {
  opts = opts || {};
  const feedMap = opts.feedMap || new Map();
  const sendingEnabled = {
    email: config.isLiveEnabled('ENABLE_EMAIL_SENDING'),
    sms: config.isLiveEnabled('ENABLE_AUTO_SMS_SEND') || config.isLiveEnabled('ENABLE_REI_SMS_SEND')
  };
  const suppressionList = store.getSuppressionList();

  // Everything already sent successfully -> the dedup set.
  const sentKeys = new Set(
    store.getCommunicationLog()
      .filter((e) => e.result === 'Sent' && e.sendKey)
      .map((e) => e.sendKey)
  );

  // Prefer an explicit Good-Flip address set (computed from the live sheet by
  // the caller); otherwise fall back to a Good-Flip marker on the row itself.
  const rows = store.getQueueRows((r) => {
    if (opts.goodFlipAddresses) return opts.goodFlipAddresses.has(normalizeAddress(r.propertyAddress || ''));
    return isGoodFlip(r.flipQuality) || isGoodFlip(r.goodFlip);
  });
  const results = [];

  for (const row of rows) {
    const candidates = candidatesForRow(row, feedMap);
    const plan = decideOutreach(
      { propertyAddress: row.propertyAddress, flipQuality: row.flipQuality || row.goodFlip || 'Yes' },
      candidates,
      { sendingEnabled, sentKeys, suppressionList, stage: 'initial' }
    );

    const logBase = {
      leadId: row.id,
      propertyAddress: cleanAddress(row.propertyAddress),
      goodFlip: row.flipQuality || row.goodFlip,
      contactSource: plan.source || '',
      agentName: plan.contact ? plan.contact.agentName : (row.agentName || ''),
      channel: plan.channel || '',
      templateId: '',
      processedAt: new Date().toISOString(),
      contactAttempts: plan.attempts ? plan.attempts.map((a) => a.source + ':' + (a.found ? 'ok' : a.reason)).join('; ') : ''
    };

    // Persist status + resolved contact + source onto the row (recoverable).
    const rowUpdate = {
      status: plan.status || row.status,
      contactSource: plan.source,
      qualificationReasons: (plan.reasons || []).join(' '),
      lastUpdated: new Date().toISOString()
    };
    if (plan.contact) {
      rowUpdate.agentName = plan.contact.agentName || row.agentName;
      rowUpdate.agentPhone = plan.contact.agentPhone || row.agentPhone;
      rowUpdate.agentEmail = plan.contact.agentEmail || row.agentEmail;
    }

    if (plan.action === 'skip') { results.push({ ...logBase, result: 'Skipped', notes: plan.reasons.join(' ') }); continue; }

    if (plan.action === 'send' && plan.channel === 'email') {
      try {
        const md = mergeData(plan.contact, logBase.propertyAddress, row.city);
        const rendered = renderTemplate(initialEmailTemplate, md);
        const unresolved = extractMergeFields(rendered.subject).concat(extractMergeFields(rendered.body));
        if (unresolved.length > 0) {
          store.updateQueueRow(row.id, { ...rowUpdate, status: PIPELINE_STATUS.NEEDS_REVIEW });
          store.appendCommunicationLog({ ...logBase, templateId: 'initial-email.v' + initialEmailTemplate.version, recipient: plan.recipient, result: 'Blocked', notes: 'Unresolved placeholders: ' + unresolved.join(', ') });
          results.push({ ...logBase, result: 'Blocked', notes: 'unresolved placeholders' });
          continue;
        }
        await gmailClient.sendEmail({ to: plan.contact.agentEmail, subject: rendered.subject, body: rendered.body });
        store.updateQueueRow(row.id, { ...rowUpdate, status: PIPELINE_STATUS.SENT, contactedAt: row.contactedAt || new Date().toISOString(), emailSentAt: new Date().toISOString() });
        store.appendCommunicationLog({ ...logBase, templateId: 'initial-email.v' + initialEmailTemplate.version, recipient: plan.contact.agentEmail, sendKey: plan.sendKey, result: 'Sent', sentAt: new Date().toISOString(), notes: '' });
        results.push({ ...logBase, result: 'Sent', recipient: plan.contact.agentEmail });
      } catch (err) {
        store.updateQueueRow(row.id, { ...rowUpdate, status: PIPELINE_STATUS.SEND_FAILED });
        store.appendCommunicationLog({ ...logBase, recipient: plan.recipient, sendKey: plan.sendKey, result: 'Send Failed', notes: err.message, retryable: true });
        results.push({ ...logBase, result: 'Send Failed', notes: err.message });
      }
      continue;
    }

    // Everything else (invalid, assisted-research, duplicate, suppressed,
    // blocked-killswitch, or SMS ready-to-send): just record the recoverable
    // status. SMS actually-send is handled by the existing SMS jobs.
    store.updateQueueRow(row.id, rowUpdate);
    const resultLabel = {
      invalid: 'Invalid Data', 'assisted-research': 'MLS Assisted Research',
      duplicate: 'Duplicate Prevented', suppressed: 'Blocked (suppressed)',
      'blocked-killswitch': 'Dry Run (sending off)', send: 'Ready to Send (SMS)'
    }[plan.action] || plan.status;
    store.appendCommunicationLog({ ...logBase, recipient: plan.recipient || '', sendKey: plan.sendKey || '', result: resultLabel, notes: (plan.reasons || []).join(' ') });
    results.push({ ...logBase, result: resultLabel, notes: (plan.reasons || []).join(' ') });
  }

  return { sendingEnabled, results };
}

module.exports = {
  PIPELINE_STATUS,
  NON_RETRYABLE,
  isGoodFlip,
  buildSendKey,
  chooseChannel,
  decideOutreach,
  candidatesForRow,
  processGoodFlipLeads
};
