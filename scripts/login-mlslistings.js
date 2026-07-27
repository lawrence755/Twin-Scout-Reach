#!/usr/bin/env node
/**
 * Opens a real, visible Chromium window with a persistent profile so a
 * human can log into MLSListings Pro Dashboard by hand (handles MFA /
 * CAPTCHA / SSO that an automated login can't). Once logged in, the
 * session persists on disk (MLS_PROFILE_DIR) for `npm run
 * mlslistings:enrich` to reuse -- exactly like the REI BlackBook login
 * helper.
 *
 * If MLS_USERNAME / MLS_PASSWORD are set in .env, it will best-effort
 * pre-fill the login form as a convenience, then still hand control to
 * you to finish (submit / MFA). That auto-fill is OPTIONAL and its
 * selectors are TODO(selectors) placeholders until confirmed against the
 * real sign-in page -- if they don't match, just log in manually in the
 * window; nothing breaks.
 */
const { chromium } = require('playwright');
const config = require('../src/config');
const { MLS_PROFILE_DIR } = require('../src/mlslistings/scrapeMlsListings');

const WAIT_MS = Number(process.env.MLS_LOGIN_WAIT_MS || 5 * 60 * 1000);

async function tryPrefill(page) {
  if (!config.mls.username || !config.mls.password) return;
  // TODO(selectors): confirm these against the real MLSListings sign-in
  // page. Wrapped in try/catch so a mismatch never blocks manual login.
  const USERNAME_INPUT = 'input[name="username"], input[type="email"], #username';
  const PASSWORD_INPUT = 'input[name="password"], input[type="password"], #password';
  try {
    const user = page.locator(USERNAME_INPUT).first();
    const pass = page.locator(PASSWORD_INPUT).first();
    if (await user.count()) await user.fill(config.mls.username);
    if (await pass.count()) await pass.fill(config.mls.password);
    console.log('Pre-filled username/password (from .env). Finish signing in (submit / MFA) in the window.');
  } catch (err) {
    console.log('Auto-fill selectors did not match -- just log in by hand in the window. (' + err.message + ')');
  }
}

async function main() {
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded' });
  console.log('Browser open -- log into MLSListings in the window that just appeared:');
  console.log('  ' + config.mls.dashboardUrl);
  await tryPrefill(page);
  console.log('Waiting up to ' + Math.round(WAIT_MS / 1000) + 's before closing...');
  await page.waitForTimeout(WAIT_MS);
  console.log('Closing. Login session (if any) is saved in ' + MLS_PROFILE_DIR + ' for reuse.');
  await context.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { main };
