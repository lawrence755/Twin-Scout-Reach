const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseFeedAgentContacts } = require('../src/feed/flipScoutFeed');

// Juan's Paragon-sourced feed carries the listing agent's contact per
// lead (agent_name/agent_phone/agent_email). parseFeedAgentContacts turns
// that JSON into an address-keyed Map we merge onto leads. See
// src/feed/flipScoutFeed.js and docs/AGENT_CONTACT_SOURCING.md.

describe('parseFeedAgentContacts', () => {
  test('maps a lead with agent contact, keyed by normalized address', () => {
    const feed = {
      leads: [
        { address: '2745 Butters Dr', agent_name: 'Jane Smith', agent_phone: '5551234567', agent_email: 'jane@brokerage.com' }
      ]
    };
    const map = parseFeedAgentContacts(feed);
    const c = map.get(require('../shared/keys').normalizeAddress('2745 Butters Dr'));
    assert.deepEqual(c, { agentName: 'Jane Smith', agentPhone: '5551234567', agentEmail: 'jane@brokerage.com' });
  });

  test('accepts raw JSON text as well as a parsed object', () => {
    const text = JSON.stringify({ leads: [{ address: '1 Main St', agent_phone: '5550001111' }] });
    const map = parseFeedAgentContacts(text);
    assert.equal(map.size, 1);
    assert.equal([...map.values()][0].agentPhone, '5550001111');
  });

  test('omits leads that carry no contact fields at all', () => {
    const feed = { leads: [
      { address: '2745 Butters Dr' },                       // no contact -> skipped
      { address: '1 Main St', agent_email: 'a@b.com' }      // has one -> kept
    ] };
    const map = parseFeedAgentContacts(feed);
    assert.equal(map.size, 1);
    assert.ok(map.has(require('../shared/keys').normalizeAddress('1 Main St')));
  });

  test('blank contact fields are treated as absent', () => {
    const feed = { leads: [{ address: '1 Main St', agent_name: '  ', agent_phone: '', agent_email: '5550001111' }] };
    const c = [...parseFeedAgentContacts(feed).values()][0];
    assert.equal(c.agentName, undefined);
    assert.equal(c.agentPhone, undefined);
    assert.equal(c.agentEmail, '5550001111');
  });

  test('tolerates a malformed feed (missing leads array, junk entries) without throwing', () => {
    assert.equal(parseFeedAgentContacts({}).size, 0);
    assert.equal(parseFeedAgentContacts({ leads: null }).size, 0);
    assert.equal(parseFeedAgentContacts({ leads: [null, 42, { agent_name: 'No Address' }] }).size, 0);
  });

  test('the current live feed shape (no agent fields yet) yields an empty map', () => {
    // Mirrors today's leads_for_sheets.json: real leads, but no agent_*
    // fields until Juan adds them. Must not error -- just no contacts yet.
    const feed = { generated_at: 't', leads: [{ score: 10, address: '2745 Butters Dr', url: 'https://redfin/...' }] };
    assert.equal(parseFeedAgentContacts(feed).size, 0);
  });
});
