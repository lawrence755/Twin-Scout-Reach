const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanText, cleanAddress, isUrlLikeName, isUsableName, safeFirstName,
  isValidEmail, isValidPhone, validateContact
} = require('../shared/contactValidation');

describe('contact hygiene', () => {
  test('cleanText collapses whitespace/newlines and trims', () => {
    assert.equal(cleanText('  Jane   Smith \n '), 'Jane Smith');
  });

  test('cleanAddress removes line breaks and edge commas', () => {
    assert.equal(cleanAddress('100 Palm Avenue \n'), '100 Palm Avenue');
    assert.equal(cleanAddress(' 123 Main St,\n'), '123 Main St');
  });

  test('isUrlLikeName flags URLs / web paths, not real names', () => {
    assert.equal(isUrlLikeName('https://my.reiblackbook.com/contacts/17683261'), true);
    assert.equal(isUrlLikeName('www.example.com'), true);
    assert.equal(isUrlLikeName('acme.com'), true);
    assert.equal(isUrlLikeName('/contacts/123'), true);
    assert.equal(isUrlLikeName('Jane Smith'), false);
  });

  test('safeFirstName returns first name, or "there" for junk/empty/URL', () => {
    assert.equal(safeFirstName('Jane Smith'), 'Jane');
    assert.equal(safeFirstName(''), 'there');
    assert.equal(safeFirstName('   '), 'there');
    assert.equal(safeFirstName('https://my.reiblackbook.com/contacts/1'), 'there');
  });

  test('email validation', () => {
    assert.equal(isValidEmail('jane@brokerage.com'), true);
    assert.equal(isValidEmail('not-an-email'), false);
    assert.equal(isValidEmail('a@b'), false);
    assert.equal(isValidEmail(''), false);
  });

  test('phone validation (10 digits, tolerates formatting + leading 1)', () => {
    assert.equal(isValidPhone('(408) 555-1234'), true);
    assert.equal(isValidPhone('1-408-555-1234'), true);
    assert.equal(isValidPhone('555-1234'), false);
    assert.equal(isValidPhone(''), false);
  });
});

describe('validateContact', () => {
  test('drops a URL-like agent name and notes it, greeting falls back to "there"', () => {
    const v = validateContact({ agentName: 'https://my.reiblackbook.com/contacts/1', agentPhone: '(408) 555-1234' });
    assert.equal(v.agentName, '');
    assert.equal(v.agentFirstName, 'there');
    assert.equal(v.phoneValid, true);
    assert.equal(v.hasValidChannel, true);
    assert.ok(v.reasons.some((r) => /URL/i.test(r)));
  });

  test('valid name + email + phone passes with a real first name', () => {
    const v = validateContact({ agentName: 'Jane Smith', agentEmail: 'jane@x.com', agentPhone: '408.555.1234' });
    assert.equal(v.agentFirstName, 'Jane');
    assert.equal(v.emailValid, true);
    assert.equal(v.phoneValid, true);
    assert.equal(v.hasValidChannel, true);
  });

  test('invalid email is dropped; a valid phone still gives a channel', () => {
    const v = validateContact({ agentName: 'Bob', agentEmail: 'bogus', agentPhone: '4085551234' });
    assert.equal(v.agentEmail, '');
    assert.equal(v.emailValid, false);
    assert.equal(v.hasValidChannel, true); // phone
  });

  test('no valid email or phone -> no channel', () => {
    const v = validateContact({ agentName: 'Bob', agentEmail: 'bogus', agentPhone: '123' });
    assert.equal(v.hasValidChannel, false);
    assert.ok(v.reasons.some((r) => /cannot contact/i.test(r)));
  });
});
