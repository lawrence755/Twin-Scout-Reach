#!/usr/bin/env node
/**
 * One-shot: transfer every "Good Flip" lead from Bryan's Flip Scout
 * Leads tab into the "Outreach Review" tab, where a human then marks
 * each "Ready for Automated Outreach? = Yes". This is the front of the
 * Sheet-driven flow and the safe first checkpoint -- it only writes
 * lead rows into the Outreach Review tab. It sends NO messages and
 * flips no send switches; nothing here can contact anyone.
 *
 * Run with: npm run transfer:good-flip
 */
const { syncGoodFlipLeadsToReview } = require('../src/outreach/actions');

async function main() {
  const { added, existing } = await syncGoodFlipLeadsToReview();
  console.log('Outreach Review already had ' + existing + ' address(es).');
  if (added.length === 0) {
    console.log('No new Good Flip leads to add -- everything is already in the Outreach Review tab.');
    return;
  }
  console.log('Added ' + added.length + ' new Good Flip lead(s) to the Outreach Review tab:');
  added.forEach((address) => console.log('  - ' + address));
  console.log('\nNext: open the Outreach Review tab and set "Ready for Automated Outreach? = Yes" on the ones you want to start.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
