const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractAgentContact, looksLoggedOut } = require('../src/mlslistings/scrapeMlsListings');

// extractAgentContact is the pure, text-pattern part of the MLSListings
// enricher -- it turns a listing detail page's visible text into the
// listing agent's { agentName, agentPhone, agentEmail }. The navigation/
// selector part is verified live, not here. See src/mlslistings/.

describe('extractAgentContact', () => {
  test('pulls name/phone/email from the block after a "Listing Agent" label', () => {
    const text = [
      '3 Beds  2 Baths  1,850 SqFt',
      'Listing Agent',
      'Jane Smith',
      '(408) 555-1234',
      'jane.smith@brokerage.com',
      'Listing Office: Acme Realty'
    ].join('\n');
    const out = extractAgentContact(text);
    assert.equal(out.agentName, 'Jane Smith');
    assert.equal(out.agentPhone, '(408) 555-1234');
    assert.equal(out.agentEmail, 'jane.smith@brokerage.com');
  });

  test('handles a dotted/dashed phone format and an alternate label', () => {
    const text = 'List Agent\nBob Jones\n408.555.9999\nbob@realty.co\n';
    const out = extractAgentContact(text);
    assert.equal(out.agentName, 'Bob Jones');
    assert.equal(out.agentPhone, '408.555.9999');
    assert.equal(out.agentEmail, 'bob@realty.co');
  });

  test('with no agent label present, still recovers a phone/email from the page', () => {
    const text = 'Some detail page\nContact: (650) 555-0000  info@x.com\n';
    const out = extractAgentContact(text);
    assert.equal(out.agentPhone, '(650) 555-0000');
    assert.equal(out.agentEmail, 'info@x.com');
    // No reliable name without a label -- blank rather than a wrong guess.
    assert.equal(out.agentName, '');
  });

  test('returns blanks (never throws) on a page with no contact at all', () => {
    const out = extractAgentContact('Just some text with no contact info.');
    assert.deepEqual(out, { agentName: '', agentPhone: '', agentEmail: '' });
  });

  test('does not mistake the label itself for the agent name', () => {
    const text = 'Listing Agent\n(408) 555-1234\nagent@x.com';
    const out = extractAgentContact(text);
    assert.notEqual(out.agentName, 'Listing Agent');
  });
});

describe('looksLoggedOut', () => {
  test('true on a sign-in page, false on a logged-in page', () => {
    assert.equal(looksLoggedOut('Please sign in with your username and password'), true);
    assert.equal(looksLoggedOut('Welcome back  |  Sign Out  |  Search Listings'), false);
  });
});
