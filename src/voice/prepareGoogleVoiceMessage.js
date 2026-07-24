#!/usr/bin/env node
/**
 * Phase 7 Google Voice preparation.
 *
 * This script NEVER clicks Google Voice's Send control, under any
 * flag or condition. It: opens Google Voice, selects the recipient,
 * types the exact approved text, verifies what landed in the compose
 * box matches the Sheet, and then stops and waits for a human. The
 * human checks the recipient and message in the real browser window,
 * clicks Send themselves, and answers this script's prompt so the
 * outcome gets written back to the Sheet.
 *
 * Selector note: Google Voice's DOM is not publicly documented and
 * changes over time. The selectors below are a starting point --
 * verify and adjust them against the live UI during the Phase 10
 * pilot before relying on this for real outreach.
 */
const readline = require('readline');
const { chromium } = require('playwright');
const config = require('../config');
const store = require('../outreach/store');

function getApprovedSmsRows() {
  return store.getQueueRows((r) => r.status === 'Approved' && r.renderedSmsBody);
}

function writeVoiceOutcome(id, { status, notes }) {
  return store.updateQueueRow(id, { status, qualificationReasons: notes, lastUpdated: new Date().toISOString() });
}

const GOOGLE_VOICE_URL = 'https://voice.google.com/u/0/messages';

async function promptOperator(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function prepareOne(page, row) {
  console.log('\n--- Preparing SMS for %s (%s) ---', row.agentName, row.agentPhone);

  // Start a new conversation. This selector targets the "Send new
  // message" compose button in the Google Voice messages list.
  await page.getByRole('button', { name: /send a new message|start a new conversation/i }).click();

  // Type the recipient phone number into the "To" field and select it
  // from the suggestion list rather than trusting free text alone.
  const recipientInput = page.getByRole('combobox', { name: /type a name or phone number/i });
  await recipientInput.fill(row.agentPhone);
  await page.getByText(row.agentPhone, { exact: false }).first().click();

  // Type the exact approved message into the compose box.
  const composeBox = page.getByRole('textbox', { name: /type a message/i });
  await composeBox.fill(row.renderedSmsBody);

  // Verify the compose box holds exactly what was approved before
  // handing off to the human -- if Google Voice mangled or truncated
  // anything, stop and flag it instead of asking a human to eyeball a
  // long message character-by-character.
  const enteredText = (await composeBox.inputValue().catch(() => null)) ?? (await composeBox.innerText());
  if (enteredText.trim() !== row.renderedSmsBody.trim()) {
    console.warn('WARNING: entered text does not exactly match the approved message. Do not send -- flagging for review.');
    return { status: 'Needs Review', notes: 'Google Voice compose box did not match the approved SMS body exactly.' };
  }

  console.log('Recipient and message are entered and verified. Nothing has been sent.');
  console.log('Review the open browser window: confirm the recipient is correct, then click Send yourself if it looks right.');

  const answer = await promptOperator(
    "Type 'sent' once you've clicked Send in the browser, 'skip' to leave it prepared without sending, or 'reject' if something is wrong: "
  );

  if (answer === 'sent') {
    return { status: 'Contacted', notes: 'Operator confirmed manual Send in Google Voice.' };
  }
  if (answer === 'reject') {
    return { status: 'Needs Review', notes: 'Operator rejected the prepared message in Google Voice.' };
  }
  return { status: 'Approved', notes: 'Prepared in Google Voice but not sent this run.' };
}

async function main() {
  if (!config.flags.voiceAutomationEnabled) {
    let rows = [];
    try {
      rows = getApprovedSmsRows();
    } catch (err) {
      console.log('Voice automation is OFF (ENABLE_VOICE_AUTOMATION=false). Could not preview rows: ' + err.message);
    }
    console.log('Voice automation is OFF (ENABLE_VOICE_AUTOMATION=false). No browser will be opened.');
    console.log(rows.length + ' row(s) are Approved and ready to prepare once this is turned on:');
    rows.forEach((row) => console.log('  - ' + row.agentName + ' (' + row.agentPhone + ') -- ' + row.propertyAddress));
    return;
  }

  const rows = getApprovedSmsRows();
  if (rows.length === 0) {
    console.log('No Approved rows with a rendered SMS body found.');
    return;
  }

  const context = await chromium.launchPersistentContext(config.voice.profileDir, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(GOOGLE_VOICE_URL);
  console.log('If this is the first run, log into the correct Google account in the opened window, then re-run this script.');

  for (const row of rows) {
    const result = await prepareOne(page, row);
    writeVoiceOutcome(row.id, result);
    console.log('Recorded outcome for row ' + row.id + ': ' + result.status);
  }

  await context.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { prepareOne };
