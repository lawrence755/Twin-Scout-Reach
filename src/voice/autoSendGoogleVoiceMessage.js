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
const {
  getOutreachQueueRows,
  updateOutreachQueueRow,
  appendAutoOutreachLog,
  getSuppressionList
} = require('../sheets/sheetsClient');
const initialSmsTemplate = require('../../templates/initial-sms.v1.json');

const GOOGLE_VOICE_URL = 'https://voice.google.com/u/0/messages';

function isAutoSmsSendEnabled() {
  return String(process.env.ENABLE_AUTO_SMS_SEND || '').trim().toLowerCase() === 'true';
}

async function buildEligibleMessages() {
  const rows = await getOutreachQueueRows((row) => row.agentPhone && row.status !== 'Handed Off');
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
      doNotAutomate: coerceBoolean(row.doNotAutomate)
    };

    const qualification = evaluateQualification(lead);
    if (qualification.status !== QUALIFICATION_STATUS.READY) {
      results.push({ row, blocked: true, reason: qualification.reasons.join(' ') || qualification.status });
      continue;
    }

    const outreachKey = row.outreachKey || buildOutreachKey(row.agentPhone, row.propertyAddress, row.campaign || 'flip-scout');
    try {
      const rendered = renderTemplate(initialSmsTemplate, {
        ...mergeBase,
        agentFirstName: (row.agentName || '').trim().split(/\s+/)[0] || '',
        propertyAddress: row.propertyAddress,
        city: row.city
      });
      results.push({ row, blocked: false, outreachKey, body: rendered.body });
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
  await page.getByRole('button', { name: /send a new message|start a new conversation/i }).click();
  const recipientInput = page.getByRole('combobox', { name: /type a name or phone number/i });
  await recipientInput.fill(item.row.agentPhone);
  await page.getByText(item.row.agentPhone, { exact: false }).first().click();

  const composeBox = page.getByRole('textbox', { name: /type a message/i });
  await composeBox.fill(item.body);

  const enteredText = (await composeBox.inputValue().catch(() => null)) ?? (await composeBox.innerText());
  if (enteredText.trim() !== item.body.trim()) {
    return { result: 'Blocked', notes: 'Compose box did not match the approved SMS body exactly -- did not send.' };
  }

  // The one line in this file that actually sends. No operator
  // confirmation gates this -- see the file header.
  await page.getByRole('button', { name: /send message/i }).click();

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
    await updateOutreachQueueRow(item.row.__rowNumber, {
      status: item.reason.toLowerCase().includes('duplicate') ? 'Duplicate' : 'Needs Review',
      qualificationReasons: item.reason
    });
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
    await updateOutreachQueueRow(item.row.__rowNumber, {
      status: outcome.result === 'Sent' ? 'Contacted' : 'Needs Review',
      qualificationReasons: outcome.notes
    });
    await appendAutoOutreachLog({
      timestamp: new Date().toISOString(),
      outreachKey: item.outreachKey,
      propertyAddress: item.row.propertyAddress,
      agentName: item.row.agentName,
      agentPhone: item.row.agentPhone,
      agentEmail: item.row.agentEmail,
      redfinLink: item.row.redfinLink,
      channel: 'SMS',
      templateId: 'initial-sms.v' + initialSmsTemplate.version,
      messageBody: item.body,
      result: outcome.result,
      notes: outcome.notes
    });
    console.log(item.row.agentPhone + ': ' + outcome.result);
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
