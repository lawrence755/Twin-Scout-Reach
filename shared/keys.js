/**
 * Contact/outreach key normalization and duplicate/suppression checks.
 *
 * This file is the single source of truth for these rules. It runs
 * unmodified in two environments:
 *   - Node.js (via require, see tests/ and src/)
 *   - Google Apps Script (copied verbatim into apps-script/shared/ by
 *     scripts/build-apps-script.js before `clasp push`)
 *
 * Do not add `require`/`import`/`export` syntax here — Apps Script's V8
 * runtime has no module system. Everything is a plain global function,
 * and the module.exports block at the bottom is skipped by Apps Script
 * because `module` is undefined there.
 */

function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  var digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.slice(1);
  }
  return digits;
}

function normalizeAddress(rawAddress) {
  if (!rawAddress) return '';
  return String(rawAddress)
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bapartment\b/g, 'apt')
    .replace(/\bunit\b/g, 'apt');
}

/**
 * Contact key: identifies a person regardless of which property or
 * campaign brought them into the queue. Used for suppression lookups.
 */
function buildContactKey(agentPhone) {
  var phone = normalizePhone(agentPhone);
  if (!phone) return '';
  return 'contact:' + phone;
}

/**
 * Outreach key: identifies one specific outreach effort (this agent,
 * about this property, in this campaign). Used to prevent re-sending
 * the same sequence twice.
 */
function buildOutreachKey(agentPhone, propertyAddress, campaign) {
  var phone = normalizePhone(agentPhone);
  var address = normalizeAddress(propertyAddress);
  var campaignKey = campaign ? String(campaign).trim().toLowerCase() : 'default';
  if (!phone || !address) return '';
  return 'outreach:' + phone + '|' + address + '|' + campaignKey;
}

/**
 * suppressionList: array of { contactKey } or { agentPhone } records
 * pulled from the Suppression List tab.
 */
function isSuppressed(agentPhone, suppressionList) {
  var contactKey = buildContactKey(agentPhone);
  if (!contactKey) return false;
  suppressionList = suppressionList || [];
  for (var i = 0; i < suppressionList.length; i++) {
    var entry = suppressionList[i];
    var entryKey = entry.contactKey || buildContactKey(entry.agentPhone);
    if (entryKey && entryKey === contactKey) return true;
  }
  return false;
}

/**
 * existingOutreachKeys: array (or Set-like with .indexOf) of outreach
 * keys already present in the Outreach Queue / Communication Log.
 */
function isDuplicateOutreach(agentPhone, propertyAddress, campaign, existingOutreachKeys) {
  var key = buildOutreachKey(agentPhone, propertyAddress, campaign);
  if (!key) return false;
  existingOutreachKeys = existingOutreachKeys || [];
  for (var i = 0; i < existingOutreachKeys.length; i++) {
    if (existingOutreachKeys[i] === key) return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizePhone: normalizePhone,
    normalizeAddress: normalizeAddress,
    buildContactKey: buildContactKey,
    buildOutreachKey: buildOutreachKey,
    isSuppressed: isSuppressed,
    isDuplicateOutreach: isDuplicateOutreach
  };
}
