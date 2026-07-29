#!/usr/bin/env node
/**
 * Diagnostic: run the MLSListings scrape for ONE address and print what it
 * parsed, plus a slice of the page text it read (so we can confirm/refine
 * the Matrix search + agent-contact extraction against a real listing).
 * Requires an already-logged-in profile -- run `npm run mlslistings:login`
 * first (and close that window before running this; one process at a time
 * can use the profile).
 *
 *   node scripts/mlslistings-test-address.js "123 Main St, City"
 */
const { chromium } = require('playwright');
const { scrapeListingAgent, MLS_PROFILE_DIR } = require('../src/mlslistings/scrapeMlsListings');

async function main() {
  const address = process.argv.slice(2).join(' ').trim();
  if (!address) {
    console.error('Usage: node scripts/mlslistings-test-address.js "<address>"');
    process.exit(1);
  }
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  try {
    const page = context.pages()[0] || (await context.newPage());
    console.log('Searching MLSListings for: ' + address + '\n');
    const info = await scrapeListingAgent(page, address);
    console.log('=== Parsed agent contact ===');
    console.log(JSON.stringify(info, null, 2));
    if (!info.found) {
      console.log('\n(No contact parsed -- if the search actually found the listing, the results/detail');
      console.log(' page structure differs from what the extractor expects; share what you see on screen.)');
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
