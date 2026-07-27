const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeReviewDecisionFields } = require('../src/outreach/actions');

// The Sheet-driven flow's safety-critical rule set: how a human's
// "Ready for Automated Outreach?" decision (and any hand edits) in the
// Outreach Review tab map onto a working row. See computeReviewDecisionFields.

describe('computeReviewDecisionFields', () => {
  test('"Yes" clears a review-only block and marks the row cleared', () => {
    const row = { doNotAutomate: 'TRUE', doNotAutomateReason: 'Outreach Review sheet: not yet reviewed' };
    const fields = computeReviewDecisionFields(row, { readyForAutomatedOutreach: 'Yes' });
    assert.equal(fields.reviewCleared, 'TRUE');
    assert.equal(fields.doNotAutomate, undefined);
    assert.ok('doNotAutomate' in fields, 'must explicitly unset the block, not just omit it');
    assert.equal(fields.doNotAutomateReason, undefined);
  });

  test('"Yes" NEVER lifts a do-not-automate block that came from a REI BlackBook note', () => {
    const row = { doNotAutomate: 'TRUE', doNotAutomateReason: 'REI BlackBook note: "Do not begin automated seller outreach"' };
    const fields = computeReviewDecisionFields(row, { readyForAutomatedOutreach: 'Yes' });
    assert.equal(fields.reviewCleared, 'TRUE');
    // The compliance block must be preserved untouched.
    assert.ok(!('doNotAutomate' in fields), 'REI-note block must not be cleared');
    assert.ok(!('doNotAutomateReason' in fields));
  });

  test('case/whitespace-insensitive "  yES  " still counts as cleared', () => {
    const fields = computeReviewDecisionFields({}, { readyForAutomatedOutreach: '  yES  ' });
    assert.equal(fields.reviewCleared, 'TRUE');
  });

  test('a blank decision blocks the row and clears any prior clearance', () => {
    const row = { reviewCleared: 'TRUE' };
    const fields = computeReviewDecisionFields(row, { readyForAutomatedOutreach: '' });
    assert.equal(fields.reviewCleared, undefined);
    assert.equal(fields.doNotAutomate, 'TRUE');
    assert.match(fields.doNotAutomateReason, /not yet reviewed/);
  });

  test('"No" blocks and quotes the actual decision in the reason', () => {
    const fields = computeReviewDecisionFields({}, { readyForAutomatedOutreach: 'No' });
    assert.equal(fields.doNotAutomate, 'TRUE');
    assert.match(fields.doNotAutomateReason, /"No"/);
  });

  test('"No" does not overwrite an existing stricter REI-notes block reason', () => {
    const row = { doNotAutomate: 'TRUE', doNotAutomateReason: 'REI BlackBook note: "opted out verbally"' };
    const fields = computeReviewDecisionFields(row, { readyForAutomatedOutreach: 'No' });
    assert.ok(!('doNotAutomate' in fields));
    assert.ok(!('doNotAutomateReason' in fields));
  });

  test('non-empty sheet agent info is authoritative and overwrites the row', () => {
    const row = { agentName: 'Old Name', agentPhone: '', agentEmail: 'old@x.com' };
    const fields = computeReviewDecisionFields(row, {
      readyForAutomatedOutreach: 'Yes',
      agentName: 'New Name', agentPhone: '510-555-0199', agentEmail: 'new@x.com'
    });
    assert.equal(fields.agentName, 'New Name');
    assert.equal(fields.agentPhone, '510-555-0199');
    assert.equal(fields.agentEmail, 'new@x.com');
  });

  test('blank sheet agent info does not clobber info already on the row', () => {
    const row = { agentName: 'Keep Me', agentPhone: '510-555-0100', agentEmail: 'keep@x.com' };
    const fields = computeReviewDecisionFields(row, {
      readyForAutomatedOutreach: 'Yes', agentName: '', agentPhone: '', agentEmail: ''
    });
    assert.ok(!('agentName' in fields));
    assert.ok(!('agentPhone' in fields));
    assert.ok(!('agentEmail' in fields));
  });

  test('an already-cleared row with "Yes" and no block is left untouched (idempotent)', () => {
    const row = { reviewCleared: 'TRUE', agentName: 'A', agentPhone: '510-555-0100', agentEmail: 'a@x.com' };
    const fields = computeReviewDecisionFields(row, {
      readyForAutomatedOutreach: 'Yes', agentName: 'A', agentPhone: '510-555-0100', agentEmail: 'a@x.com'
    });
    assert.deepEqual(fields, {});
  });
});
