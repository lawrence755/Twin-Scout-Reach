#!/usr/bin/env node
/**
 * REI BlackBook equivalent of scripts/check-replies.js -- checks
 * every "Contacted" row reached via REI BlackBook for a real inbound
 * reply and routes it (see src/outreach/actions.js#checkReiBlackBookReplies
 * for the exact rules) or moves it to Follow-Up Due after three days
 * of silence.
 *
 * Requires a human to have already logged into REI BlackBook once via
 * `npm run reiblackbook:login`.
 */
const actions = require('../src/outreach/actions');

actions.checkReiBlackBookReplies()
  .then((results) => {
    if (results.length === 0) {
      console.log('No rows are currently "Contacted" via REI BlackBook -- nothing to check.');
    } else {
      results.forEach((r) => {
        console.log(r.address + ' -> ' + r.result + (r.replyText ? ' -- reply: "' + r.replyText + '"' : ''));
        if (r.notifyError) console.warn('  Google Chat notification failed: ' + r.notifyError);
        if (r.error) console.warn('  Failed: ' + r.error);
      });
    }
    if (results.statusTabSync) {
      if (results.statusTabSync.error) console.warn('Outreach Status sync failed: ' + results.statusTabSync.error);
      else console.log('Outreach Status sync: wrote ' + results.statusTabSync.rows + ' row(s).');
    }
  })
  .catch((err) => {
    console.error('Failed to check REI BlackBook replies:', err.message);
    process.exitCode = 1;
  });
