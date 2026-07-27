/**
 * Central place every Node.js entry point loads its config and
 * feature flags from. Live-sending switches default to false no
 * matter what's in the environment unless the value is exactly
 * "true" -- an unset, misspelled, or empty variable must never be
 * treated as "on".
 */
const path = require('path');
const fs = require('fs');

// Anchor to this file's own location (src/config -> repo root, or
// resources/app in the packaged Electron app), never to process.cwd().
// A path-shaped setting resolved against cwd instead broke in practice:
// double-clicking the packaged .exe gives it a cwd of dist/win-unpacked/
// (the .exe's own folder), one level above where service-account.json
// etc. actually live (resources/app/) -- so a relative default like
// './service-account.json' silently pointed at the wrong place. Every
// path-shaped setting below is resolved through resolvePath() so this
// can't happen again regardless of how or from where the process was
// launched.
const ROOT = path.resolve(__dirname, '..', '..');

const ENV_PATH = path.join(ROOT, '.env');

require('dotenv').config({ path: ENV_PATH });

// Live read of a boolean live-sending flag straight from the .env file
// on disk, EVERY call -- deliberately not from process.env. process.env
// is frozen when a process starts: for the always-running app that's app
// startup, and for a spawned job (app/jobRunner.js) it's a copy of the
// parent app's environment, which the child's own dotenv will NOT
// override (dotenv leaves already-set vars alone). Both cases meant a
// Settings toggle flipped off kept sending until a full app restart.
// Reading the file each time makes every ENABLE_* switch an immediate,
// reliable kill switch. Falls back to process.env only if the file read
// fails, so a guard can never throw here.
function isLiveEnabled(envVar, envPath = ENV_PATH) {
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    let value;
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m && m[1] === envVar) value = m[2];
    }
    if (value !== undefined) {
      return value.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'true';
    }
  } catch (err) {
    // fall through to process.env
  }
  return String(process.env[envVar] || '').trim().toLowerCase() === 'true';
}

// envValue may be unset, a relative path, or an absolute path.
// path.resolve(ROOT, x) does the right thing for all three: unset ->
// falls through to defaultRelativePath resolved against ROOT; relative
// -> resolved against ROOT (not cwd); absolute -> returned as-is
// (path.resolve discards ROOT once it hits an absolute segment).
function resolvePath(envValue, defaultRelativePath) {
  return path.resolve(ROOT, envValue || defaultRelativePath);
}

const config = {
  // Live getter: reads the .env file fresh on every access (see
  // isLiveEnabled) so config.flags is never a stale snapshot from
  // process startup.
  get flags() {
    return {
      emailSendingEnabled: isLiveEnabled('ENABLE_EMAIL_SENDING'),
      voiceAutomationEnabled: isLiveEnabled('ENABLE_VOICE_AUTOMATION')
    };
  },
  isLiveEnabled,
  sheets: {
    sheetId: process.env.GOOGLE_SHEET_ID || '',
    credentialsPath: resolvePath(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'service-account.json')
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
    profileDir: resolvePath(process.env.GOOGLE_VOICE_PROFILE_DIR, '.voice-profile')
  },
  gmail: {
    oauthClientPath: resolvePath(process.env.GMAIL_OAUTH_CLIENT_PATH, 'gmail-oauth-client.json'),
    tokenPath: resolvePath(process.env.GMAIL_TOKEN_PATH, 'gmail-token.json')
  },
  notifications: {
    googleChatWebhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL || ''
  }
};

module.exports = config;
