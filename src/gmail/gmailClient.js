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

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

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

module.exports = { sendEmail, runInteractiveAuthorization };
