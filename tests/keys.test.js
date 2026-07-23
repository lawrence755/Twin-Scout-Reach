const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone,
  normalizeAddress,
  buildContactKey,
  buildOutreachKey,
  isSuppressed,
  isDuplicateOutreach
} = require('../shared/keys');

describe('normalizePhone', () => {
  test('strips formatting characters', () => {
    assert.equal(normalizePhone('(510) 555-0142'), '5105550142');
  });

  test('strips a leading country code 1', () => {
    assert.equal(normalizePhone('+1 510-555-0142'), '5105550142');
  });

  test('returns empty string for blank input', () => {
    assert.equal(normalizePhone(''), '');
    assert.equal(normalizePhone(null), '');
  });
});

describe('normalizeAddress', () => {
  test('lowercases, trims, and collapses whitespace', () => {
    assert.equal(normalizeAddress('  123  Main   Street '), '123 main st');
  });

  test('normalizes common street-type words to the same abbreviation', () => {
    assert.equal(normalizeAddress('456 Oak Avenue'), normalizeAddress('456 Oak Ave'));
  });
});

describe('contact and outreach keys', () => {
  test('buildContactKey is stable across phone formatting', () => {
    assert.equal(buildContactKey('(510) 555-0142'), buildContactKey('510-555-0142'));
  });

  test('buildContactKey is empty for a missing phone', () => {
    assert.equal(buildContactKey(''), '');
  });

  test('buildOutreachKey differs by campaign', () => {
    const a = buildOutreachKey('510-555-0142', '123 Main St', 'campaign-a');
    const b = buildOutreachKey('510-555-0142', '123 Main St', 'campaign-b');
    assert.notEqual(a, b);
  });

  test('buildOutreachKey is stable across address formatting', () => {
    const a = buildOutreachKey('510-555-0142', '123 Main Street', 'flip-scout');
    const b = buildOutreachKey('510-555-0142', '123 Main St', 'flip-scout');
    assert.equal(a, b);
  });

  test('buildOutreachKey is empty without a phone or address', () => {
    assert.equal(buildOutreachKey('', '123 Main St', 'flip-scout'), '');
    assert.equal(buildOutreachKey('510-555-0142', '', 'flip-scout'), '');
  });
});

describe('isSuppressed', () => {
  test('matches by contactKey field', () => {
    const list = [{ contactKey: buildContactKey('510-555-0142') }];
    assert.equal(isSuppressed('(510) 555-0142', list), true);
  });

  test('matches by raw agentPhone field', () => {
    const list = [{ agentPhone: '5105550142' }];
    assert.equal(isSuppressed('(510) 555-0142', list), true);
  });

  test('returns false when not on the list', () => {
    const list = [{ agentPhone: '4155550199' }];
    assert.equal(isSuppressed('(510) 555-0142', list), false);
  });

  test('returns false for an empty phone', () => {
    assert.equal(isSuppressed('', [{ agentPhone: '4155550199' }]), false);
  });
});

describe('isDuplicateOutreach', () => {
  test('detects an existing outreach key', () => {
    const key = buildOutreachKey('510-555-0142', '123 Main St', 'flip-scout');
    assert.equal(isDuplicateOutreach('510-555-0142', '123 Main St', 'flip-scout', [key]), true);
  });

  test('is false for a different property', () => {
    const key = buildOutreachKey('510-555-0142', '123 Main St', 'flip-scout');
    assert.equal(isDuplicateOutreach('510-555-0142', '999 Elm St', 'flip-scout', [key]), false);
  });
});
