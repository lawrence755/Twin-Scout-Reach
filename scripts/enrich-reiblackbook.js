#!/usr/bin/env node
/**
 * Fills in agent phone/email for every Outreach Queue row that has a
 * REI BlackBook contact link (from "REI Link & Agent Name" on Flip
 * Scout Leads) but no phone yet -- see
 * src/outreach/actions.js#enrichFromReiBlackBook.
 *
 * Requires a human to have logged into REI BlackBook at least once
 * via `npm run reiblackbook:login` -- this script never logs in
 * itself, and reuses that saved session headlessly.
 */
const actions = require('../src/outreach/actions');

actions.enrichFromReiBlackBook()
  .then(({ updated, failed, results }) => {
    if (results.length === 0) {
      console.log('No rows need REI BlackBook enrichment (need a REI contact link and no Agent Phone yet).');
      return;
    }
    results.forEach((r) => {
      if (r.ok) console.log(r.propertyAddress + ': ' + r.agentPhone + (r.agentEmail ? ' / ' + r.agentEmail : ''));
      else console.warn(r.propertyAddress + ' failed: ' + r.error);
    });
    console.log('Done. ' + updated + ' enriched, ' + failed + ' failed.');
  })
  .catch((err) => {
    console.error('Failed to enrich from REI BlackBook:', err.message);
    process.exitCode = 1;
  });
