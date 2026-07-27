/**
 * Sends an enriched agent contact to the Zapier catch-hook, which creates
 * the contact in REI BlackBook and tags them "Real Estate Agent".
 *
 * Payload (exactly as the Zap expects):
 *   { name, phone, email, address, source: "MLSListings Enrichment" }
 *
 * Best-effort: if ZAPIER_WEBHOOK_URL is unset, or the POST fails, it logs
 * and returns a non-ok result rather than throwing -- a webhook hiccup
 * must never lose the contact we already wrote back to the Sheet.
 */
const config = require('../src/config');

const SOURCE = 'MLSListings Enrichment';

async function sendToBlackBook({ name, phone, email, address }) {
  const url = config.zapier.blackbookWebhookUrl;
  if (!url) {
    console.warn('  [blackbook] ZAPIER_WEBHOOK_URL not set -- skipping REI BlackBook webhook.');
    return { ok: false, skipped: true };
  }

  const payload = { name, phone, email, address, source: SOURCE };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    console.log('  [blackbook] sent to REI BlackBook (Zapier) for ' + (name || address));
    return { ok: true };
  } catch (err) {
    console.warn('  [blackbook] webhook failed for ' + address + ': ' + err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendToBlackBook, SOURCE };
