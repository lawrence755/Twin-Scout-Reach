#!/usr/bin/env node
/**
 * Checks Gmail for Google Voice reply notifications matching any row
 * currently "Contacted", and routes each one forward (see
 * src/outreach/actions.js#checkReplies for the exact rules) or moves
 * it to Follow-Up Due once three days have passed with no reply.
 *
 * Requires Gmail to already be authorized (`npm run gmail:authorize`)
 * with the widened scope that includes gmail.readonly -- re-run
 * authorize once if this was authorized before that scope was added.
 */
const actions = require('../src/outreach/actions');

actions.checkReplies()
  .then((results) => {
    if (results.length === 0) {
      console.log('No rows are currently "Contacted" -- nothing to check.');
    } else {
      results.forEach((r) => {
        console.log(r.address + ' -> ' + r.result + (r.replyText ? ' -- reply: "' + r.replyText + '"' : ''));
        if (r.notifyError) console.warn('  Google Chat notification failed: ' + r.notifyError);
      });
    }
    if (results.sheetSync) {
      if (results.sheetSync.error) console.warn('Sheet sync failed: ' + results.sheetSync.error);
      else console.log('Sheet sync: updated ' + results.sheetSync.updated + ' "Contacted?" cell(s).');
    }
  })
  .catch((err) => {
    console.error('Failed to check replies:', err.message);
    process.exitCode = 1;
  });
