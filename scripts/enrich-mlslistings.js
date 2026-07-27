#!/usr/bin/env node
/**
 * Fills in agent phone/email for every Outreach Queue row still missing
 * one, by searching MLSListings Pro Dashboard by address and reading the
 * listing agent's contact off the MLS detail page -- see
 * src/outreach/actions.js#enrichFromMlsListings.
 *
 * Requires a human to have logged into MLSListings at least once via
 * `npm run mlslistings:login` -- this script never logs in itself, and
 * reuses that saved session.
 *
 * NOTE: the MLSListings search/detail selectors are not yet verified
 * against the live UI (see the TODO(selectors) markers in
 * src/mlslistings/scrapeMlsListings.js). Until those are filled in, each
 * row will report "not wired to the live UI yet" -- that's expected.
 */
const actions = require('../src/outreach/actions');

actions.enrichFromMlsListings()
  .then(({ updated, failed, results }) => {
    if (results.length === 0) {
      console.log('No rows need MLSListings enrichment (need an address and a missing Agent Phone or Email).');
      return;
    }
    results.forEach((r) => {
      if (r.ok) console.log(r.propertyAddress + ': ' + (r.agentName ? r.agentName + ' -- ' : '') + r.agentPhone + (r.agentEmail ? ' / ' + r.agentEmail : ''));
      else console.warn(r.propertyAddress + ' failed: ' + r.error);
    });
    console.log('Done. ' + updated + ' enriched, ' + failed + ' failed.');
  })
  .catch((err) => {
    console.error('Failed to enrich from MLSListings:', err.message);
    process.exitCode = 1;
  });
