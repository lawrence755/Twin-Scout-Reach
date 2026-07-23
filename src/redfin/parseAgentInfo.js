/**
 * Pure text parsing for a Redfin listing's "Listed by" agent info.
 * Kept separate from scrapeRedfin.js (which does the actual page
 * fetch) so this logic is testable without a browser or network
 * access.
 *
 * Redfin's DOM/text layout is not publicly documented and changes
 * over time -- verify this against real listing pages during rollout
 * and adjust the patterns below as needed.
 */

const PHONE_PATTERN = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const LISTED_BY_PATTERN = /listed by[:\s]+([^•\n•,]+?)(?:\s*(?:DRE\s*#|•|•|,)|\s*$)/i;

function parseAgentInfoFromPageText(pageText) {
  const text = String(pageText || '');
  const result = { agentName: '', agentPhone: '' };

  const nameMatch = text.match(LISTED_BY_PATTERN);
  if (nameMatch) {
    result.agentName = nameMatch[1].trim();
  }

  // Prefer a phone number that appears within ~200 characters after
  // "Listed by" (the agent/brokerage contact block), falling back to
  // the first phone number anywhere on the page.
  const listedByIndex = text.search(/listed by/i);
  if (listedByIndex !== -1) {
    const nearby = text.slice(listedByIndex, listedByIndex + 200);
    const nearbyPhone = nearby.match(PHONE_PATTERN);
    if (nearbyPhone) result.agentPhone = nearbyPhone[0];
  }
  if (!result.agentPhone) {
    const anyPhone = text.match(PHONE_PATTERN);
    if (anyPhone) result.agentPhone = anyPhone[0];
  }

  return result;
}

/**
 * Text indicators that a page is a bot-check/CAPTCHA rather than the
 * real listing. When any of these match, callers must stop and log --
 * never attempt to solve the CAPTCHA, rotate IPs, or otherwise evade
 * the block.
 */
const BLOCK_INDICATORS = [
  /unusual traffic/i,
  /verify you are a human/i,
  /captcha/i,
  /are you a robot/i,
  /access to this page has been denied/i
];

function looksBlocked(pageText) {
  const text = String(pageText || '');
  return BLOCK_INDICATORS.some((pattern) => pattern.test(text));
}

module.exports = { parseAgentInfoFromPageText, looksBlocked };
