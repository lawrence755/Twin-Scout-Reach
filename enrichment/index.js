#!/usr/bin/env node
/**
 * MLSListings enrichment -- entry point.
 *
 * Flow:
 *   1. Read "Flip Scout Leads" and find rows missing agent phone/email
 *      (checked against the "Outreach Review" tab).           [sheets.js]
 *   2. Open MLSListings Pro Dashboard, reusing the saved login. [login.js]
 *   3. For each row: search by address, extract the listing
 *      agent's name/phone/email.                     [searchAndExtract.js]
 *   4. Write the result back to the "Outreach Review" tab.     [sheets.js]
 *   5. POST it to the Zapier webhook so REI BlackBook creates the
 *      contact tagged "Real Estate Agent".                  [blackbook.js]
 *
 * Run:  npm run enrichment      (after `npm run mlslistings:login` once)
 *
 * Headless is false (see login.js) so you can watch. Every row is
 * best-effort: a failure on one address is logged and the run continues.
 *
 * NOTE: the MLS search/detail selectors are not yet verified against the
 * live UI (TODO(selectors) in src/mlslistings/scrapeMlsListings.js).
 * Until they're filled in, step 3 will report that per row -- expected.
 */
const config = require('../src/config');
const { getRowsNeedingEnrichment, saveAgentContact } = require('./sheets');
const { openLoggedInContext } = require('./login');
const { searchAndExtract } = require('./searchAndExtract');
const { sendToBlackBook } = require('./blackbook');

async function main() {
  console.log('=== MLSListings enrichment ===');

  const rows = await getRowsNeedingEnrichment();
  if (rows.length === 0) {
    console.log('Nothing to enrich -- every lead already has an agent phone and email.');
    return;
  }
  console.log('Found ' + rows.length + ' lead(s) needing agent contact.');

  const { context, page } = await openLoggedInContext();
  const summary = { enriched: 0, failed: 0, webhookOk: 0 };

  try {
    for (const row of rows) {
      console.log('\n- ' + row.address);
      try {
        const found = await searchAndExtract(page, row.address);
        if (!found.found || (!found.phone && !found.email)) {
          console.warn('  no agent contact found on MLSListings');
          summary.failed++;
        } else {
          const name = found.name || row.agentName || '';
          console.log('  found: ' + (name || '(no name)') + ' | ' + (found.phone || '-') + ' | ' + (found.email || '-'));

          await saveAgentContact(row.address, { name, phone: found.phone, email: found.email });
          console.log('  saved to Outreach Review tab');

          const hook = await sendToBlackBook({ name, phone: found.phone, email: found.email, address: row.address });
          if (hook.ok) summary.webhookOk++;

          summary.enriched++;
        }
      } catch (err) {
        console.warn('  failed: ' + err.message);
        summary.failed++;
      }

      // Be a good MLS citizen -- pause between listings.
      await page.waitForTimeout(config.mls.scrapeDelayMs);
    }
  } finally {
    await context.close();
  }

  console.log(
    '\n=== Done. ' + summary.enriched + ' enriched, ' + summary.failed + ' failed, ' +
    summary.webhookOk + ' sent to REI BlackBook. ==='
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Enrichment run failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
