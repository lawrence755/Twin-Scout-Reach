#!/usr/bin/env node
/**
 * Scans every Outreach Queue row with a REI BlackBook contact link for
 * a "do not automate" directive in that contact's Notes -- see
 * src/outreach/actions.js#checkReiBlackBookNotes. A match sets the
 * row's doNotAutomate flag, which blocks it from any auto-send path.
 *
 * Requires a human to have logged into REI BlackBook at least once
 * via `npm run reiblackbook:login`.
 */
const actions = require('../src/outreach/actions');

actions.checkReiBlackBookNotes()
  .then(({ checked, flagged, results }) => {
    if (results.length === 0) {
      console.log('No rows have a REI BlackBook contact link yet -- nothing to check.');
      return;
    }
    results.forEach((r) => {
      if (!r.ok) console.warn(r.propertyAddress + ' failed: ' + r.error);
      else if (r.flagged) console.log(r.propertyAddress + ': FLAGGED -- "' + r.matchedText + '"');
      else console.log(r.propertyAddress + ': ok, no do-not-automate note found');
    });
    console.log('Done. ' + checked + ' checked, ' + flagged + ' newly flagged.');
  })
  .catch((err) => {
    console.error('Failed to check REI BlackBook notes:', err.message);
    process.exitCode = 1;
  });
