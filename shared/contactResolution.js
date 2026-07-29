/**
 * Decides which source supplies an agent's contact, in trust order, and
 * validates it. Pure and unit-tested -- the orchestrator does the I/O
 * (feed fetch, REI/MLS scrape) and hands the raw candidates here; this file
 * only picks the first source that yields a *valid* channel and records
 * why the others were skipped. When nothing valid is found it returns
 * needsHumanResearch so the lead is parked in assisted research, never
 * dropped.
 *
 * See shared/keys.js for the dual Node.js / Apps Script module pattern.
 */
var validation = (typeof require !== 'undefined') ? require('./contactValidation') : null;

var CONTACT_SOURCE = {
  FEED: 'Feed',
  REI: 'REI BlackBook',
  MLS: 'MLS',
  ENRICHMENT: 'Enrichment',
  HUMAN: 'Human Research'
};

// Order the pipeline tries sources in. Each entry: [candidate key, source label].
var RESOLUTION_ORDER = [
  ['feed', CONTACT_SOURCE.FEED],
  ['rei', CONTACT_SOURCE.REI],
  ['mls', CONTACT_SOURCE.MLS],
  ['enrichment', CONTACT_SOURCE.ENRICHMENT]
];

/**
 * candidates: { feed?, rei?, mls?, enrichment? } where each present value is
 * a raw { agentName, agentPhone, agentEmail } from that source (or absent/
 * null if that source had nothing). Returns:
 *   { found, source, contact (validated) | null, needsHumanResearch, attempts }
 * attempts records every source tried and why it was or wasn't used.
 */
function resolveContact(candidates) {
  candidates = candidates || {};
  var attempts = [];
  for (var i = 0; i < RESOLUTION_ORDER.length; i++) {
    var key = RESOLUTION_ORDER[i][0];
    var label = RESOLUTION_ORDER[i][1];
    var raw = candidates[key];
    if (!raw || (!raw.agentName && !raw.agentPhone && !raw.agentEmail)) {
      attempts.push({ source: label, found: false, reason: 'no data from this source' });
      continue;
    }
    var v = validation.validateContact(raw);
    if (v.hasValidChannel) {
      attempts.push({ source: label, found: true, reason: 'valid contact' });
      return { found: true, source: label, contact: v, needsHumanResearch: false, attempts: attempts };
    }
    attempts.push({ source: label, found: false, reason: v.reasons.join(' ') || 'no valid channel' });
  }
  return { found: false, source: CONTACT_SOURCE.HUMAN, contact: null, needsHumanResearch: true, attempts: attempts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONTACT_SOURCE: CONTACT_SOURCE,
    RESOLUTION_ORDER: RESOLUTION_ORDER,
    resolveContact: resolveContact
  };
}
