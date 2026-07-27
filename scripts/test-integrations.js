#!/usr/bin/env node
/**
 * Manual integration smoke test -- proves the two OUTBOUND integrations
 * work end to end, independent of the queue / approval / do-not-automate
 * logic. This is a test tool, not part of the real outreach pipeline.
 *
 *   node scripts/test-integrations.js
 *       -> posts a test message to the Google Chat webhook only.
 *
 *   node scripts/test-integrations.js name@twinhomebuyer.com
 *       -> ALSO sends a real test email to that address via Gmail.
 *
 * It sends real things, so the email recipient must be passed explicitly
 * -- nothing goes out by accident. The email test ignores
 * ENABLE_EMAIL_SENDING on purpose (it calls the Gmail client directly);
 * that flag only gates the automated queue path, not this manual test.
 */
const gmailClient = require('../src/gmail/gmailClient');
const { postToGoogleChat } = require('../src/notifications/googleChat');

async function main() {
  const to = process.argv[2];
  const stamp = new Date().toISOString();

  // 1. Google Chat webhook
  try {
    await postToGoogleChat('Outreach Control Panel test notification (' + stamp + '). If you can read this, the Google Chat webhook works.');
    console.log('Webhook: posted OK.');
  } catch (err) {
    console.log('Webhook: FAILED -- ' + err.message);
  }

  // 2. Gmail send (only if a recipient was given)
  if (!to) {
    console.log('No recipient argument -- skipped the email test.');
    console.log('To also test sending, re-run with an address, e.g.:');
    console.log('  node scripts/test-integrations.js name@twinhomebuyer.com');
    return;
  }
  try {
    await gmailClient.sendEmail({
      to,
      subject: 'Twin Home Buyer -- test email (' + stamp + ')',
      body: 'This is a test email from the Outreach Control Panel, sent to confirm Gmail sending works. No action needed.'
    });
    console.log('Email: sent to ' + to + '.');
  } catch (err) {
    console.log('Email: FAILED -- ' + err.message);
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
