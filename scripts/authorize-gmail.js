#!/usr/bin/env node
/**
 * One-time interactive Gmail authorization. Run this once after
 * setting GMAIL_OAUTH_CLIENT_PATH in .env to a downloaded OAuth
 * "Desktop app" client JSON from Google Cloud Console. Opens a
 * browser for consent and saves the resulting token to
 * GMAIL_TOKEN_PATH (default ./gmail-token.json) -- after that,
 * sendEmail() in src/gmail/gmailClient.js just works.
 */
const { runInteractiveAuthorization } = require('../src/gmail/gmailClient');

runInteractiveAuthorization()
  .then(() => {
    console.log('Saved. Gmail sending is now authorized for this app.');
  })
  .catch((err) => {
    console.error('Authorization failed:', err.message);
    process.exitCode = 1;
  });
