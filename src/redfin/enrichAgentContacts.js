#!/usr/bin/env node
/**
 * Reads Outreach Queue rows that have a Redfin Link but no agent
 * phone yet, scrapes each listing for the agent's name/phone, and
 * writes the result back. Rate-limited (REDFIN_SCRAPE_DELAY_MS,
 * default 5s between requests) and stops per-row (not the whole run)
 * on a detected block/CAPTCHA -- see scrapeRedfin.js.
 */
const store = require('../outreach/store');
const { scrapeRedfinListing } = require('./scrapeRedfin');

const DELAY_MS = Number(process.env.REDFIN_SCRAPE_DELAY_MS || 5000);

async function main() {
  const rows = store.getQueueRows((row) => row.redfinLink && !row.agentPhone);

  if (rows.length === 0) {
    console.log('No rows need Redfin enrichment (need a Redfin Link and no Agent Phone yet).');
    return;
  }

  console.log('Enriching ' + rows.length + ' row(s) from Redfin, ' + DELAY_MS + 'ms apart...');
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const info = await scrapeRedfinListing(row.redfinLink, { delayMs: DELAY_MS });
      store.updateQueueRow(row.id, {
        agentName: info.agentName || row.agentName,
        agentPhone: info.agentPhone || row.agentPhone,
        lastUpdated: new Date().toISOString()
      });
      console.log('Row ' + row.id + ': ' + info.agentName + ' / ' + info.agentPhone);
      succeeded++;
    } catch (err) {
      console.warn('Row ' + row.id + ' (' + row.redfinLink + ') failed: ' + err.message);
      failed++;
    }
  }

  console.log('Done. ' + succeeded + ' enriched, ' + failed + ' failed -- see warnings above for any blocked/unparseable pages.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { main };
