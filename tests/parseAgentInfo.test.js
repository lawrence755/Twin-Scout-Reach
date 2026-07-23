const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseAgentInfoFromPageText, looksBlocked } = require('../src/redfin/parseAgentInfo');

describe('parseAgentInfoFromPageText', () => {
  test('extracts agent name and a nearby phone number', () => {
    const text = 'Some listing details...\nListed by Jane Doe DRE #01234567 • Keller Williams Realty 555-123-4567\nMore page content...';
    const result = parseAgentInfoFromPageText(text);
    assert.equal(result.agentName, 'Jane Doe');
    assert.equal(result.agentPhone, '555-123-4567');
  });

  test('falls back to the first phone number on the page if none is near "Listed by"', () => {
    const text = 'Listed by Jane Doe DRE #01234567\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nContact us: (415) 555-0199';
    const result = parseAgentInfoFromPageText(text);
    assert.equal(result.agentPhone, '(415) 555-0199');
  });

  test('returns blanks when nothing matches', () => {
    const result = parseAgentInfoFromPageText('This page has no agent info on it at all.');
    assert.equal(result.agentName, '');
    assert.equal(result.agentPhone, '');
  });

  test('handles a missing/undefined page text without throwing', () => {
    assert.doesNotThrow(() => parseAgentInfoFromPageText(undefined));
  });
});

describe('looksBlocked', () => {
  test('detects common bot-check phrasing', () => {
    assert.equal(looksBlocked('Our systems have detected unusual traffic from your network.'), true);
    assert.equal(looksBlocked('Please complete the CAPTCHA to continue.'), true);
  });

  test('is false for ordinary listing text', () => {
    assert.equal(looksBlocked('Listed by Jane Doe • Keller Williams Realty 555-123-4567'), false);
  });
});
