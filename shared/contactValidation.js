/**
 * Contact hygiene + validation for outreach. Pure and unit-tested -- the
 * one place that decides whether an agent contact is safe to send to, and
 * cleans it up first. Enforced before ANY message is rendered or sent so a
 * URL-as-a-name, a line-break-mangled address, or a junk email/phone can
 * never reach a real agent.
 *
 * See shared/keys.js for the dual Node.js / Apps Script module pattern.
 */

var URL_LIKE = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\/contacts\/|\/\/)/i;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trim and collapse all whitespace (incl. newlines/tabs) to single spaces. */
function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/** Address cleanup: strip line breaks, collapse whitespace, drop stray commas at the ends. */
function cleanAddress(value) {
  return cleanText(value).replace(/^[,\s]+|[,\s]+$/g, '');
}

/** Digits-only phone; strips a leading US country code. */
function normalizePhoneDigits(phone) {
  var digits = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  return digits;
}

/** True if a "name" is actually a URL / web path and must never be used as an agent name. */
function isUrlLikeName(name) {
  var s = cleanText(name);
  if (!s) return false;
  return URL_LIKE.test(s);
}

/** True if the string is a usable human agent name (non-empty, not URL-like). */
function isUsableName(name) {
  var s = cleanText(name);
  return !!s && !isUrlLikeName(s);
}

/**
 * The greeting first name. Returns the agent's first token when the name is
 * usable; otherwise "there" so the message reads "Hi there," instead of
 * "Hi ," or "Hi https://...". Never returns a URL or empty string.
 */
function safeFirstName(name) {
  if (!isUsableName(name)) return 'there';
  var first = cleanText(name).split(' ')[0];
  return first || 'there';
}

function isValidEmail(email) {
  var s = cleanText(email);
  return !!s && EMAIL_RE.test(s);
}

/** Valid US phone = 10 digits (after stripping a leading 1). */
function isValidPhone(phone) {
  return normalizePhoneDigits(phone).length === 10;
}

/**
 * Cleans and validates one agent contact. Returns a normalized copy plus
 * validity flags and human-readable reasons. `hasValidChannel` is the gate
 * the sender checks: at least one usable channel (valid email OR valid
 * phone). A URL-like name is dropped (not used) and noted.
 */
function validateContact(raw) {
  raw = raw || {};
  var reasons = [];

  var nameIn = cleanText(raw.agentName);
  var nameUrlLike = nameIn && isUrlLikeName(nameIn);
  if (nameUrlLike) reasons.push('Agent name looked like a URL and was dropped.');
  var agentName = nameUrlLike ? '' : nameIn;

  var email = cleanText(raw.agentEmail);
  var emailValid = isValidEmail(email);
  if (email && !emailValid) reasons.push('Agent email is not a valid address.');

  var phoneValid = isValidPhone(raw.agentPhone);
  if (raw.agentPhone && !phoneValid) reasons.push('Agent phone is not a valid 10-digit number.');

  if (!agentName) reasons.push('No usable agent name (greeting will use "there").');
  if (!emailValid && !phoneValid) reasons.push('No valid email or phone -- cannot contact.');

  return {
    agentName: agentName,
    agentFirstName: safeFirstName(agentName),
    agentPhone: phoneValid ? cleanText(raw.agentPhone) : '',
    agentPhoneDigits: phoneValid ? normalizePhoneDigits(raw.agentPhone) : '',
    agentEmail: emailValid ? email : '',
    emailValid: emailValid,
    phoneValid: phoneValid,
    hasValidChannel: emailValid || phoneValid,
    reasons: reasons
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanText: cleanText,
    cleanAddress: cleanAddress,
    normalizePhoneDigits: normalizePhoneDigits,
    isUrlLikeName: isUrlLikeName,
    isUsableName: isUsableName,
    safeFirstName: safeFirstName,
    isValidEmail: isValidEmail,
    isValidPhone: isValidPhone,
    validateContact: validateContact
  };
}
