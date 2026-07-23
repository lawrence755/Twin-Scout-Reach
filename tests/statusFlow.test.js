const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, isTerminal, TERMINAL_STATUSES, ALL_STATUSES } = require('../shared/statusFlow');

describe('canTransition', () => {
  test('allows each step of the main flow in order', () => {
    assert.equal(canTransition('Information Needed', 'Ready for Drafting'), true);
    assert.equal(canTransition('Ready for Drafting', 'Pending Approval'), true);
    assert.equal(canTransition('Pending Approval', 'Approved'), true);
    assert.equal(canTransition('Approved', 'Contacted'), true);
    assert.equal(canTransition('Contacted', 'Follow-Up Due'), true);
    assert.equal(canTransition('Follow-Up Due', 'Replied'), true);
    assert.equal(canTransition('Replied', 'Handed Off'), true);
  });

  test('rejects skipping the human approval step', () => {
    assert.equal(canTransition('Pending Approval', 'Contacted'), false);
    assert.equal(canTransition('Ready for Drafting', 'Approved'), false);
  });

  test('rejects moving backward through the main flow', () => {
    assert.equal(canTransition('Approved', 'Ready for Drafting'), false);
  });

  test('every terminal status refuses to transition anywhere, including exceptions', () => {
    TERMINAL_STATUSES.forEach((status) => {
      ALL_STATUSES.forEach((target) => {
        if (target === status) return;
        assert.equal(
          canTransition(status, target),
          false,
          `expected ${status} -> ${target} to be blocked (terminal)`
        );
      });
    });
  });

  test('a non-terminal status can always be force-moved to Opted Out', () => {
    assert.equal(canTransition('Contacted', 'Opted Out'), true);
    assert.equal(canTransition('Information Needed', 'Opted Out'), true);
  });

  test('a non-terminal status can always be force-moved to Do Not Automate', () => {
    assert.equal(canTransition('Follow-Up Due', 'Do Not Automate'), true);
  });

  test('rejects an unknown status on either side', () => {
    assert.equal(canTransition('Made Up Status', 'Approved'), false);
    assert.equal(canTransition('Approved', 'Made Up Status'), false);
  });

  test('rejects a no-op transition to the same status', () => {
    assert.equal(canTransition('Approved', 'Approved'), false);
  });
});

describe('isTerminal', () => {
  test('Handed Off, Rejected, and Opted Out are terminal', () => {
    assert.equal(isTerminal('Handed Off'), true);
    assert.equal(isTerminal('Rejected'), true);
    assert.equal(isTerminal('Opted Out'), true);
  });

  test('Contacted is not terminal', () => {
    assert.equal(isTerminal('Contacted'), false);
  });
});
