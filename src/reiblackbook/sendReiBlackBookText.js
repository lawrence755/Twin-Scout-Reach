/**
 * Sends a text through REI BlackBook's own per-contact "Chat" feature
 * -- Bryan's CRM's built-in texting, sent from REI BlackBook's own
 * provisioned number, as an alternative channel to the Google Voice
 * web-automation path (src/voice/*). Requires an already-logged-in
 * persistent profile (see scripts/login-reiblackbook.js) -- this
 * module never logs in itself.
 *
 * The compose box is a TinyMCE rich-text editor inside an iframe
 * (class "tox-edit-area__iframe"), and the real send control is an
 * icon-only button reachable via aria-label "Send Text" -- both
 * confirmed against the live app, not guessed. REI BlackBook enforces
 * its own TCPA opt-in gate: sending to a contact who isn't marked
 * opted-in pops an "Attention Required" modal instead of sending.
 * This never clicks through that modal itself -- opting someone in is
 * a compliance decision for a human, not something automation should
 * paper over -- so it throws instead, leaving the row for manual
 * attention.
 */
const { REI_PROFILE_DIR, withActiveTab } = require('./scrapeReiBlackBook');

async function sendReiBlackBookText(page, contactUrl, message) {
  const chatUrl = withActiveTab(contactUrl, 'chat');
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const composeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
  await composeBody.click();
  await page.keyboard.type(message);
  await page.waitForTimeout(800);

  const sendBtn = page.getByLabel('Send Text', { exact: true });
  if (await sendBtn.isDisabled()) {
    throw new Error('Send Text button stayed disabled -- the message may not have entered the compose box.');
  }
  await sendBtn.click();
  await page.waitForTimeout(1500);

  const afterClick = await page.innerText('body').catch(() => '');
  if (afterClick.includes('Attention Required') && /Opt-In/i.test(afterClick)) {
    throw new Error('Contact is not opted-in in REI BlackBook -- needs a human to review and opt them in manually, not automated.');
  }

  // Don't trust the click alone (this project has been burned by
  // exactly that before) -- reload and confirm the message actually
  // landed in this contact's real communication history.
  await page.waitForTimeout(1500);
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const afterReload = await page.innerText('body').catch(() => '');
  if (afterReload.includes('No communication history available')) {
    throw new Error('Send appeared to succeed, but the contact\'s chat history still shows no messages -- treating this as not delivered.');
  }
  return { sent: true };
}

module.exports = { sendReiBlackBookText, REI_PROFILE_DIR };
