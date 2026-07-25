/**
 * Reads phone/email off a REI BlackBook contact page (Bryan's CRM --
 * the "REI Link & Agent Name" column on Flip Scout Leads links each
 * lead's agent to their record here). Requires an already-logged-in
 * persistent browser profile (see loginToReiBlackBook.js) -- this
 * module never touches login/credentials itself.
 *
 * Extraction is text-pattern based (phone/email shaped regexes over
 * the "Primary Details" card's visible text), not CSS-selector based
 * -- REI BlackBook is a Chakra UI app whose class names are
 * build-generated hashes (e.g. "css-khajot") with no guarantee of
 * staying the same across their deployments, so anchoring to those
 * would be fragile. The literal label text "Primary Details" and
 * "Source:" bracket a contact's phone/email reliably in the page's
 * visible text, confirmed against a real live contact page.
 */
const REI_PROFILE_DIR = '.reiblackbook-profile';

function looksLoggedOut(pageText) {
  return !pageText.includes('Primary Details') && /log\s*in/i.test(pageText);
}

/**
 * Swaps (or appends) ?activeTab=<tab> on a REI BlackBook contact URL.
 */
function withActiveTab(contactUrl, tab) {
  if (contactUrl.includes('activeTab=')) return contactUrl.replace(/activeTab=[^&]*/, 'activeTab=' + tab);
  return contactUrl + (contactUrl.includes('?') ? '&' : '?') + 'activeTab=' + tab;
}

// Deliberately anchored on the literal "do not ... automat-" phrasing
// seen in a real note ("Do not begin automated seller outreach"),
// rather than anything vaguer like "manual" alone -- that word shows
// up in plenty of notes that aren't a directive against automation.
const DO_NOT_AUTOMATE_PATTERN = /do\s+not\s+(?:begin|start|do|use|run|send)?\s*(?:any\s+)?automat\w*/i;

function extractDoNotAutomateSignal(notesText) {
  const match = (notesText || '').match(DO_NOT_AUTOMATE_PATTERN);
  if (!match) return { doNotAutomate: false, matchedText: null };
  const idx = notesText.indexOf(match[0]);
  const context = notesText.slice(Math.max(0, idx - 40), idx + 120).replace(/\s+/g, ' ').trim();
  return { doNotAutomate: true, matchedText: context };
}

/**
 * Visits a contact's Notes tab and checks every note's visible text
 * for an explicit directive against automating outreach for this
 * lead (see extractDoNotAutomateSignal). This is a real compliance
 * gate, not informational -- callers should set the row's
 * doNotAutomate flag when this comes back true, not just log it.
 */
async function checkNotesForDoNotAutomate(page, contactUrl) {
  await page.goto(withActiveTab(contactUrl, 'notes'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const pageText = await page.innerText('body').catch(() => '');
  if (looksLoggedOut(pageText)) {
    throw new Error('Not logged into REI BlackBook -- run the login helper and log in, then retry.');
  }
  return extractDoNotAutomateSignal(pageText);
}

function extractContactInfo(pageText) {
  const start = pageText.indexOf('Primary Details');
  if (start === -1) {
    throw new Error('Could not find the "Primary Details" section -- either not logged into REI BlackBook, or its layout has changed.');
  }
  const end = pageText.indexOf('Source:', start);
  const section = pageText.slice(start, end === -1 ? start + 400 : end);
  const phoneMatch = section.match(/\(\d{3}\)\s?\d{3}-\d{4}/);
  const emailMatch = section.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return {
    agentPhone: phoneMatch ? phoneMatch[0] : '',
    agentEmail: emailMatch ? emailMatch[0] : ''
  };
}

/**
 * Visits one contact URL using an already-open, already-logged-in
 * page (see enrichFromReiBlackBook.js -- one browser/page is reused
 * across a whole batch rather than relaunching per contact).
 */
async function scrapeReiBlackBookContact(page, contactUrl) {
  await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const pageText = await page.innerText('body').catch(() => '');
  if (looksLoggedOut(pageText)) {
    throw new Error('Not logged into REI BlackBook -- run the login helper and log in, then retry.');
  }
  return extractContactInfo(pageText);
}

/**
 * Reads a contact's real text history straight from REI BlackBook's
 * own getChatFeed API response (confirmed live: sending a text
 * produces an entry there with direction "outbound-chat", a real
 * Twilio SID, and a "queued"/delivered status) rather than parsing
 * rendered chat-bubble HTML, which is far more likely to shift under
 * a Chakra UI rebuild. Returns the raw activity array, oldest logic
 * unfiltered -- callers decide what counts as a reply.
 *
 * NOTE: only the outbound shape has been confirmed against a real
 * send so far (see sendReiBlackBookText.js's own note) -- the
 * "direction" value an actual inbound reply carries hasn't been
 * confirmed live yet. isInboundActivity() below is a best-effort
 * guess (anything not tagged as outbound); verify this against a
 * real inbound reply the first time one comes in, and adjust if the
 * value turns out to be something else.
 */
async function getChatHistory(page, contactUrl) {
  let feed = null;
  const onResponse = async (res) => {
    if (res.url().includes('getChatFeed')) {
      try { feed = JSON.parse(await res.text()); } catch (err) { /* ignore */ }
    }
  };
  page.on('response', onResponse);
  try {
    await page.goto(withActiveTab(contactUrl, 'chat'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } finally {
    page.off('response', onResponse);
  }
  return (feed && feed.activity) || [];
}

function isInboundActivity(activity) {
  return !String(activity.direction || '').toLowerCase().includes('outbound');
}

module.exports = {
  scrapeReiBlackBookContact,
  extractContactInfo,
  checkNotesForDoNotAutomate,
  extractDoNotAutomateSignal,
  getChatHistory,
  isInboundActivity,
  withActiveTab,
  REI_PROFILE_DIR
};
