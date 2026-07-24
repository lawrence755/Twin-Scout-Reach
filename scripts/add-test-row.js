#!/usr/bin/env node
/**
 * Adds one internal test row to the Outreach Queue, using your own
 * phone number and email as the "agent" contact -- so test sends land
 * in your own inbox/phone instead of a real listing agent's. Doesn't
 * touch Flip Scout or the Sheet at all.
 *
 * Usage:
 *   node scripts/add-test-row.js "<your phone>" "<your email>"
 * or set TEST_AGENT_PHONE / TEST_AGENT_EMAIL in .env and run with no args.
 *
 * Phone/email are read from argv or .env, never hardcoded here, so
 * nothing personal ends up committed to the repo.
 *
 * The row is pre-filled with values that already pass Phase 3
 * qualification (Active listing, 10 days on market, not tenant
 * occupied, needs work, comp review done) and run through
 * refreshValidation() + submitForApproval() immediately, so it lands
 * in Pending Approval -- one "Approve outreach" click away from a
 * real test send.
 */
const actions = require('../src/outreach/actions');

async function main() {
  const phone = process.argv[2] || process.env.TEST_AGENT_PHONE;
  const email = process.argv[3] || process.env.TEST_AGENT_EMAIL;

  if (!phone) {
    console.error('Missing phone number. Usage: node scripts/add-test-row.js "<your phone>" "<your email>"');
    process.exitCode = 1;
    return;
  }

  const row = await actions.addRow({
    propertyAddress: '123 Test St',
    city: 'Test City',
    agentName: 'Test (You)',
    agentPhone: phone,
    agentEmail: email || '',
    listingStatus: 'Active',
    daysOnMarket: 10,
    tenantOccupied: false,
    needsWork: true,
    appearsRenovated: false,
    compReviewCompleted: true,
    campaign: 'internal-test'
  });
  console.log('Added test row:', row.id, row.propertyAddress);

  const validated = await actions.refreshValidation();
  console.log('Validation result:', validated.find((r) => r.id === row.id) || '(not in pre-approval statuses -- check status above)');

  const submitted = await actions.submitForApproval();
  const mine = submitted.find((r) => r.id === row.id);
  if (mine) {
    console.log('Submitted for approval, status:', mine.status, mine.problems.length ? '-- ' + mine.problems.join(' ') : '');
  }

  console.log('\nNext: open the app and click "Approve outreach", then "Send approved emails" / run npm run voice:prepare or voice:autosend to test.');
}

main().catch((err) => {
  console.error('Failed to add test row:', err.message);
  process.exitCode = 1;
});
