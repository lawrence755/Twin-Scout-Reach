/**
 * Central place every Node.js entry point loads its config and
 * feature flags from. Live-sending switches default to false no
 * matter what's in the environment unless the value is exactly
 * "true" -- an unset, misspelled, or empty variable must never be
 * treated as "on".
 */
require('dotenv').config();

function isEnabled(envVar) {
  return String(process.env[envVar] || '').trim().toLowerCase() === 'true';
}

const config = {
  flags: {
    emailSendingEnabled: isEnabled('ENABLE_EMAIL_SENDING'),
    voiceAutomationEnabled: isEnabled('ENABLE_VOICE_AUTOMATION')
  },
  sheets: {
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json'
  },
  sender: {
    name: process.env.SENDER_NAME || '',
    phone: process.env.SENDER_PHONE || '',
    email: process.env.SENDER_EMAIL || '',
    handoffPerson: process.env.HANDOFF_PERSON || '',
    companyWebsite: process.env.COMPANY_WEBSITE || '',
    yearsInBusiness: process.env.YEARS_IN_BUSINESS || '',
    googleReviewLink: process.env.GOOGLE_REVIEW_LINK || ''
  },
  voice: {
    profileDir: process.env.GOOGLE_VOICE_PROFILE_DIR || './.voice-profile'
  },
  gmail: {
    oauthClientPath: process.env.GMAIL_OAUTH_CLIENT_PATH || './gmail-oauth-client.json',
    tokenPath: process.env.GMAIL_TOKEN_PATH || './gmail-token.json'
  }
};

module.exports = config;
