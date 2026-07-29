const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolveContact, CONTACT_SOURCE } = require('../shared/contactResolution');

const GOOD = { agentName: 'Jane Smith', agentPhone: '408-555-1234', agentEmail: 'jane@x.com' };

describe('resolveContact (source chain: feed -> REI -> MLS -> enrichment -> human)', () => {
  test('uses the feed when it has a valid contact', () => {
    const r = resolveContact({ feed: GOOD, rei: GOOD, mls: GOOD });
    assert.equal(r.found, true);
    assert.equal(r.source, CONTACT_SOURCE.FEED);
  });

  test('falls to REI BlackBook when the feed has nothing', () => {
    const r = resolveContact({ feed: null, rei: GOOD });
    assert.equal(r.source, CONTACT_SOURCE.REI);
    assert.equal(r.found, true);
  });

  test('falls to MLS when feed + REI are missing', () => {
    const r = resolveContact({ feed: null, rei: null, mls: GOOD });
    assert.equal(r.source, CONTACT_SOURCE.MLS);
  });

  test('falls to enrichment last', () => {
    const r = resolveContact({ mls: null, enrichment: GOOD });
    assert.equal(r.source, CONTACT_SOURCE.ENRICHMENT);
  });

  test('skips a source whose contact is invalid and continues down the chain', () => {
    const badFeed = { agentName: 'https://x.com/1', agentPhone: '12', agentEmail: 'nope' };
    const r = resolveContact({ feed: badFeed, rei: GOOD });
    assert.equal(r.source, CONTACT_SOURCE.REI);
    // the feed attempt is recorded as tried-but-unusable
    assert.ok(r.attempts.some((a) => a.source === CONTACT_SOURCE.FEED && !a.found));
  });

  test('nothing valid anywhere -> needs human research', () => {
    const r = resolveContact({ feed: null, rei: null, mls: null, enrichment: null });
    assert.equal(r.found, false);
    assert.equal(r.needsHumanResearch, true);
    assert.equal(r.source, CONTACT_SOURCE.HUMAN);
    assert.equal(r.attempts.length, 4);
  });
});
