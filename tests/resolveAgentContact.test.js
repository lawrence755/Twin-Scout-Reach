const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAgentContact } = require('../src/outreach/actions');

// Trust order for listing-agent contact on a Flip Scout lead:
//   1. Paragon-sourced feed contact carried on the lead (agentName/
//      agentPhone/agentEmail) -- authoritative, no scrape needed.
//   2. The REI link's agent name (name only).
//   3. Cowork's "Redfin Agent Contacts" match -- fallback only.
// See resolveAgentContact() and docs/AGENT_CONTACT_SOURCING.md.

describe('resolveAgentContact', () => {
  test('Paragon feed contact on the lead wins over a Redfin fallback match', () => {
    const lead = { agentName: 'Pat Paragon', agentPhone: '5551112222', agentEmail: 'pat@mls.com' };
    const redfinMatch = { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' };
    const out = resolveAgentContact(lead, redfinMatch);
    assert.deepEqual(out, { agentName: 'Pat Paragon', agentPhone: '5551112222', agentEmail: 'pat@mls.com' });
  });

  test('falls back to the Redfin match when the feed carries no contact', () => {
    const lead = { propertyAddress: '1 Main St' };
    const redfinMatch = { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' };
    const out = resolveAgentContact(lead, redfinMatch);
    assert.deepEqual(out, { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' });
  });

  test('each field falls through independently -- feed name, fallback phone/email', () => {
    const lead = { agentName: 'Pat Paragon' };
    const redfinMatch = { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' };
    const out = resolveAgentContact(lead, redfinMatch);
    assert.equal(out.agentName, 'Pat Paragon');
    assert.equal(out.agentPhone, '5559998888');
    assert.equal(out.agentEmail, 'ricky@redfin.com');
  });

  test('an REI-link lead takes its name from the REI link when the feed has none', () => {
    const lead = { reiContactLink: 'https://rei.example/contact/42', reiAgentName: 'Robin REI' };
    const out = resolveAgentContact(lead, null);
    assert.equal(out.agentName, 'Robin REI');
    // Phone/email are left empty here -- enrichFromReiBlackBook fills them later.
    assert.equal(out.agentPhone, '');
    assert.equal(out.agentEmail, undefined);
  });

  test('feed contact wins even on an REI-link lead (no enrichment needed)', () => {
    const lead = {
      reiContactLink: 'https://rei.example/contact/42', reiAgentName: 'Robin REI',
      agentName: 'Pat Paragon', agentPhone: '5551112222', agentEmail: 'pat@mls.com'
    };
    const out = resolveAgentContact(lead, null);
    assert.deepEqual(out, { agentName: 'Pat Paragon', agentPhone: '5551112222', agentEmail: 'pat@mls.com' });
  });

  test('blank ("") feed fields are treated as absent, not as a real value', () => {
    const lead = { agentName: '', agentPhone: '', agentEmail: '' };
    const redfinMatch = { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' };
    const out = resolveAgentContact(lead, redfinMatch);
    assert.deepEqual(out, { agentName: 'Ricky Redfin', agentPhone: '5559998888', agentEmail: 'ricky@redfin.com' });
  });

  test('no contact anywhere -> blank phone, undefined name/email', () => {
    const out = resolveAgentContact({ propertyAddress: '1 Main St' }, null);
    assert.deepEqual(out, { agentName: undefined, agentPhone: '', agentEmail: undefined });
  });
});
