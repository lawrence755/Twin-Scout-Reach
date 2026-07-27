/**
 * Reads the listing-agent contact straight from Juan's Flip Scout Agent
 * feed -- the Paragon-sourced JSON his agent already publishes
 * (config.feed.flipScoutUrl, i.e. flip_scout/leads_for_sheets.json).
 *
 * This is Juan's suggested fix in practice: he captures the agent's
 * name/phone/email on Paragon when a deal is flagged and includes them in
 * that JSON; we pull them from the same feed, keyed by address. No Redfin
 * scraping, and nothing to add to Bryan's Sheet -- the feed is the source.
 *
 * The parse step (parseFeedAgentContacts) is pure and unit-tested; only
 * fetchAgentContactsByAddress touches the network, and it is best-effort
 * -- callers treat a fetch failure as "no feed contact yet," never an
 * error, so an unreachable feed only means we fall back to whatever other
 * contact a row already has.
 */
const config = require('../config');
const { normalizeAddress } = require('../../shared/keys');

// Field names Juan's agent emits per lead. Kept here as the one place the
// feed's contact contract is spelled out; matches docs/AGENT_CONTACT_SOURCING.md.
const FEED_AGENT_NAME_KEY = 'agent_name';
const FEED_AGENT_PHONE_KEY = 'agent_phone';
const FEED_AGENT_EMAIL_KEY = 'agent_email';

function clean(value) {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? undefined : s;
}

/**
 * Pure: turns feed JSON (a parsed object or the raw text) into a Map of
 * normalized address -> { agentName, agentPhone, agentEmail }. Only leads
 * that actually carry at least one contact field are included, so an
 * address absent from the map simply means "no agent contact in the feed
 * for it yet." Tolerates a missing/blank `leads` array and non-object
 * entries rather than throwing on a malformed feed.
 */
function parseFeedAgentContacts(feed) {
  const data = typeof feed === 'string' ? JSON.parse(feed) : (feed || {});
  const leads = Array.isArray(data.leads) ? data.leads : [];
  const map = new Map();
  for (const lead of leads) {
    if (!lead || typeof lead !== 'object') continue;
    const key = normalizeAddress(lead.address || '');
    if (!key) continue;
    const contact = {
      agentName: clean(lead[FEED_AGENT_NAME_KEY]),
      agentPhone: clean(lead[FEED_AGENT_PHONE_KEY]),
      agentEmail: clean(lead[FEED_AGENT_EMAIL_KEY])
    };
    if (contact.agentName || contact.agentPhone || contact.agentEmail) {
      map.set(key, contact);
    }
  }
  return map;
}

/**
 * Fetches the feed and returns the address-keyed agent-contact Map.
 * Throws on network/HTTP/parse failure -- callers that want best-effort
 * behavior should use loadFeedAgentContacts() below instead.
 */
async function fetchAgentContactsByAddress(url = config.feed.flipScoutUrl) {
  if (!url) return new Map();
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error('Flip Scout feed fetch failed: HTTP ' + res.status);
  }
  return parseFeedAgentContacts(await res.text());
}

/**
 * Best-effort wrapper: never throws. Returns an empty Map (and the error)
 * if the feed can't be read, so an outreach cycle continues normally when
 * the feed is briefly unreachable.
 */
async function loadFeedAgentContacts(url = config.feed.flipScoutUrl) {
  try {
    return { contacts: await fetchAgentContactsByAddress(url), error: null };
  } catch (err) {
    return { contacts: new Map(), error: err.message };
  }
}

module.exports = {
  parseFeedAgentContacts,
  fetchAgentContactsByAddress,
  loadFeedAgentContacts,
  FEED_AGENT_NAME_KEY,
  FEED_AGENT_PHONE_KEY,
  FEED_AGENT_EMAIL_KEY
};
