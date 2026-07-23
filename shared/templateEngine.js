/**
 * Phase 4 template rendering: merge-field substitution plus a hard stop
 * on missing required fields (Phase 6 step 3: "Confirm the rendered
 * email has no missing fields").
 *
 * See shared/keys.js for the dual Node.js / Apps Script pattern used
 * throughout shared/.
 */

var MERGE_FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Finds every {{fieldName}} placeholder referenced in a string.
 */
function extractMergeFields(text) {
  var fields = [];
  var match;
  MERGE_FIELD_PATTERN.lastIndex = 0;
  while ((match = MERGE_FIELD_PATTERN.exec(text || '')) !== null) {
    if (fields.indexOf(match[1]) === -1) fields.push(match[1]);
  }
  return fields;
}

/**
 * Returns the subset of requiredFields missing or blank in mergeData.
 * "Missing" includes undefined, null, and empty string -- a blank
 * merge field must never go out to an agent.
 */
function findMissingFields(requiredFields, mergeData) {
  mergeData = mergeData || {};
  var missing = [];
  for (var i = 0; i < (requiredFields || []).length; i++) {
    var field = requiredFields[i];
    var value = mergeData[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Renders a template. Throws if any of the template's declared
 * requiredFields is missing/blank -- callers (Apps Script send flow,
 * approval UI) must catch this and route the record to Needs Review
 * rather than sending a half-filled message.
 *
 * template: { id, version, channel, subject?, body, requiredFields }
 * mergeData: flat object of merge-field values
 */
function renderTemplate(template, mergeData) {
  if (!template || !template.body) {
    throw new Error('Template is missing a body.');
  }
  var missing = findMissingFields(template.requiredFields, mergeData);
  if (missing.length > 0) {
    var err = new Error('Missing merge fields: ' + missing.join(', '));
    err.missingFields = missing;
    throw err;
  }
  var rendered = {
    body: substitute(template.body, mergeData)
  };
  if (template.subject !== undefined) {
    rendered.subject = substitute(template.subject, mergeData);
  }
  return rendered;
}

function substitute(text, mergeData) {
  mergeData = mergeData || {};
  return String(text || '').replace(MERGE_FIELD_PATTERN, function (fullMatch, fieldName) {
    var value = mergeData[fieldName];
    return value === undefined || value === null ? fullMatch : String(value);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractMergeFields: extractMergeFields,
    findMissingFields: findMissingFields,
    renderTemplate: renderTemplate
  };
}
