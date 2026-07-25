/**
 * Gmail API client using a standard OAuth "installed app" consent
 * flow -- not a service account (service accounts can't send Gmail as
 * a real person without Workspace domain-wide delegation, which
 * doesn't apply to a personal-style Gmail account).
 *
 * One-time setup: Google Cloud Console -> enable the Gmail API ->
 * create an OAuth client of type "Desktop app" -> download its JSON
 * -> point GMAIL_OAUTH_CLIENT_PATH at it -> run
 * `npm run gmail:authorize` once. After that, sendEmail() just works,
 * refreshing its token silently.
 */
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');
const config = require('../config');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
];

function loadClientSecrets() {
  const raw = JSON.parse(fs.readFileSync(config.gmail.oauthClientPath, 'utf8'));
  const creds = raw.installed || raw.web;
  if (!creds) throw new Error('Unrecognized OAuth client JSON shape at ' + config.gmail.oauthClientPath);
  return creds;
}

function buildOAuth2Client(redirectUri) {
  const { client_id, client_secret } = loadClientSecrets();
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

function loadStoredTokens() {
  if (!fs.existsSync(config.gmail.tokenPath)) return null;
  return JSON.parse(fs.readFileSync(config.gmail.tokenPath, 'utf8'));
}

function saveTokens(tokens) {
  fs.writeFileSync(config.gmail.tokenPath, JSON.stringify(tokens, null, 2));
}

/**
 * Returns an authorized OAuth2 client, refreshing the access token via
 * the stored refresh token as needed. Throws with a clear message if
 * `npm run gmail:authorize` hasn't been run yet.
 */
async function getAuthorizedClient() {
  const tokens = loadStoredTokens();
  if (!tokens) {
    throw new Error('Gmail is not authorized yet -- run `npm run gmail:authorize` once.');
  }
  const client = buildOAuth2Client('http://localhost');
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    saveTokens({ ...tokens, ...newTokens });
  });
  return client;
}

/**
 * One-time interactive authorization: opens a local loopback server,
 * prints/opens the Google consent URL, and saves the resulting tokens
 * (including a refresh token) once the user approves. Not called
 * automatically by sendEmail() -- run via scripts/authorize-gmail.js
 * so a browser popup never happens mid-automated-run unexpectedly.
 */
function runInteractiveAuthorization() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (!url.searchParams.has('code')) {
          res.writeHead(400).end('No authorization code in callback.');
          return;
        }
        const code = url.searchParams.get('code');
        const redirectUri = 'http://localhost:' + server.address().port;
        const client = buildOAuth2Client(redirectUri);
        const { tokens } = await client.getToken(code);
        saveTokens(tokens);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Gmail authorized.</h2><p>You can close this window and return to the terminal.</p>');
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(500).end('Authorization failed: ' + err.message);
        server.close();
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = 'http://localhost:' + port;
      const client = buildOAuth2Client(redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      });
      console.log('Open this URL in a browser and approve access (it should open automatically):\n');
      console.log(authUrl + '\n');
      openInBrowser(authUrl);
    });
  });
}

function openInBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best-effort; the printed URL is the real fallback
}

function encodeMimeMessage({ to, subject, body }) {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body
  ].join('\r\n');
  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail({ to, subject, body }) {
  const client = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth: client });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodeMimeMessage({ to, subject, body }) }
  });
}

function decodeBase64Url(data) {
  return Buffer.from(data, 'base64').toString('utf8');
}

function extractPlainTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const text = extractPlainTextBody(part);
    if (text) return text;
  }
  if (payload.body && payload.body.data) return decodeBase64Url(payload.body.data);
  return '';
}

function getHeader(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/**
 * Google Voice's own "email me when I get a text" notifications come
 * from an address shaped like
 * "<your-voice-number>.<their-number>.<token>@txt.voice.google.com" --
 * the other party's number is embedded directly in the sender address,
 * which is far more reliable for matching than parsing a display name
 * out of the subject line. The real "From" header includes a display
 * name too (e.g. "John Decena (SMS) <15....@txt.voice.google.com>"),
 * so the address must be pulled out of the angle brackets (or used
 * bare, for the no-display-name case) before this pattern is applied.
 */
const VOICE_NOTIFICATION_SENDER_PATTERN = /^\d+\.(\d+)\.[^.]+@txt\.voice\.google\.com$/i;

function extractEmailAddress(fromHeader) {
  const angleMatch = String(fromHeader || '').match(/<([^>]+)>/);
  return (angleMatch ? angleMatch[1] : fromHeader).trim();
}

/**
 * Searches for Google Voice "new text message" notification emails
 * newer than `after` (a Date), and returns each one's sender-embedded
 * phone number alongside the message body (the actual reply content)
 * and timestamp. Does not filter by recipient/outreach row -- that's
 * the caller's job, since this inbox receives Voice notifications for
 * every number on the account, not just outreach ones.
 */
async function searchVoiceReplyEmails(after) {
  const client = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth: client });
  const afterClause = after ? ' after:' + Math.floor(after.getTime() / 1000) : '';
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:(txt.voice.google.com)' + afterClause,
    maxResults: 100
  });

  const results = [];
  for (const ref of data.messages || []) {
    const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: ref.id, format: 'full' });
    const from = extractEmailAddress(getHeader(msg.payload.headers, 'From'));
    const subject = getHeader(msg.payload.headers, 'Subject');
    const match = from.match(VOICE_NOTIFICATION_SENDER_PATTERN);
    if (!match) continue; // not a Voice text notification (could be a different Voice email type)
    results.push({
      messageId: ref.id,
      fromPhoneDigits: match[1],
      subject,
      body: extractPlainTextBody(msg.payload).trim(),
      date: new Date(Number(msg.internalDate))
    });
  }
  return results;
}

module.exports = { sendEmail, runInteractiveAuthorization, searchVoiceReplyEmails };
