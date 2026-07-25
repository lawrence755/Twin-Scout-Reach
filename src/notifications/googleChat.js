/**
 * Posts a plain-text message to a Google Chat space via an incoming
 * webhook -- no OAuth, just an HTTPS POST to the URL the space's
 * "Apps & integrations -> Webhooks" panel generates. Node 18+'s global
 * fetch is enough here; no extra dependency needed.
 */
const config = require('../config');

async function postToGoogleChat(text) {
  if (!config.notifications.googleChatWebhookUrl) {
    throw new Error('GOOGLE_CHAT_WEBHOOK_URL is not set -- see .env.example.');
  }
  const res = await fetch(config.notifications.googleChatWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    throw new Error('Google Chat webhook returned ' + res.status + ': ' + (await res.text()));
  }
}

module.exports = { postToGoogleChat };
