#!/usr/bin/env node
/**
 * Assisted enrichment -- results TODAY, no MLS selectors required.
 *
 * You drive the browser (you know how to search MLSListings); the script
 * does everything else. For each lead missing agent contact it:
 *   1. shows you the address,
 *   2. waits while YOU search + open that listing in the open window,
 *   3. on Enter, scrapes the listing agent off whatever page is showing,
 *   4. writes it back to the "Outreach Review" tab,
 *   5. POSTs it to the Zapier webhook (REI BlackBook, tagged agent),
 *   6. saves the page's HTML to enrichment/captures/ so the fully
 *      automatic selectors can be built from real pages later.
 *
 * This needs no search/detail selectors because extraction is text-based
 * over the visible page. Run:  npm run enrichment:assisted
 * (Log in when the window opens, or beforehand via `npm run mlslistings:login`.)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const config = require('../src/config');
const { MLS_PROFILE_DIR, extractAgentContact } = require('../src/mlslistings/scrapeMlsListings');
const { getRowsNeedingEnrichment, saveAgentContact } = require('./sheets');
const { sendToBlackBook } = require('./blackbook');

const CAPTURE_DIR = path.join(__dirname, 'captures');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function safeName(address) {
  return String(address).replace(/[^\w-]+/g, '_').slice(0, 80);
}

async function main() {
  console.log('=== MLSListings assisted enrichment ===');
  const rows = await getRowsNeedingEnrichment();
  if (rows.length === 0) {
    console.log('Nothing to enrich -- every lead already has an agent phone and email.');
    return;
  }
  console.log('Found ' + rows.length + ' lead(s) needing agent contact.\n');

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  await ask('Log into MLSListings in the window if needed, then press Enter to begin... ');

  const summary = { enriched: 0, skipped: 0, failed: 0, webhookOk: 0 };
  try {
    for (const row of rows) {
      console.log('\n──────────────────────────────────────────');
      console.log('ADDRESS: ' + row.address);
      const cmd = await ask('Search + open this listing in the browser, then press Enter to grab it (or "s" to skip): ');
      if (cmd.toLowerCase() === 's') { console.log('  skipped.'); summary.skipped++; continue; }

      try {
        const bodyText = await page.innerText('body').catch(() => '');
        const html = await page.content().catch(() => '');
        // Save the raw page so the automatic selectors can be built from it.
        if (html) fs.writeFileSync(path.join(CAPTURE_DIR, safeName(row.address) + '.html'), html);

        const found = extractAgentContact(bodyText);
        console.log('  parsed: ' + (found.agentName || '(no name)') + ' | ' + (found.agentPhone || '-') + ' | ' + (found.agentEmail || '-'));

        // Let you correct anything the parser missed before it's saved.
        const ok = await ask('  Save this? Enter=yes, or type "name | phone | email" to correct, "s" to skip: ');
        if (ok.toLowerCase() === 's') { console.log('  skipped.'); summary.skipped++; continue; }

        let { agentName: name, agentPhone: phone, agentEmail: email } = found;
        if (ok.includes('|')) {
          const [n, p, e] = ok.split('|').map((x) => x.trim());
          name = n || name; phone = p || phone; email = e || email;
        }
        name = name || row.agentName || '';

        if (!phone && !email) { console.warn('  no phone/email -- skipping save.'); summary.failed++; continue; }

        await saveAgentContact(row.address, { name, phone, email });
        console.log('  ✓ saved to Outreach Review tab');
        const hook = await sendToBlackBook({ name, phone, email, address: row.address });
        if (hook.ok) summary.webhookOk++;
        summary.enriched++;
      } catch (err) {
        console.warn('  failed: ' + err.message);
        summary.failed++;
      }
    }
  } finally {
    await context.close();
  }

  console.log('\n=== Done. ' + summary.enriched + ' enriched, ' + summary.skipped + ' skipped, ' +
    summary.failed + ' failed, ' + summary.webhookOk + ' sent to REI BlackBook. ===');
  console.log('Saved page HTML in enrichment/captures/ -- send me one of those and I\'ll wire the fully automatic search/extract.');
}

if (require.main === module) {
  main().catch((err) => { console.error('Assisted run failed:', err.message); process.exitCode = 1; });
}

module.exports = { main };
