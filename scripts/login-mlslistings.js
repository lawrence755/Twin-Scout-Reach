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

/**
 * Best-effort automatic sign-in against MLSListings' Azure B2C login,
 * using the selectors captured from a live recording of the real flow:
 * Username / Password / "Sign in", then MLSListings' concurrent-session
 * gate ("End Oldest Inactive Session"). Reads credentials fresh from
 * .env (never hard-coded, never logged). If anything doesn't match (or an
 * MFA/CAPTCHA appears), it just hands control back and you finish by hand.
 */
async function autoLogin(page) {
  const user = config.liveEnvValue('MLS_USERNAME');
  const pass = config.liveEnvValue('MLS_PASSWORD');
  if (!user || !pass) {
    console.log('No MLS_USERNAME / MLS_PASSWORD in .env -- log in by hand in the window.');
    return;
  }
  try {
    const username = page.getByRole('textbox', { name: /Username/i }).first();
    await username.waitFor({ state: 'visible', timeout: 20000 });
    await username.fill(user);
    await page.getByRole('textbox', { name: /Password/i }).first().fill(pass);
    await page.getByRole('button', { name: /^Sign in$/i }).first().click();
    console.log('Submitted login as ' + user + ' ...');
    await page.waitForTimeout(6000);

    // MLSListings caps concurrent sessions -- a "session limit" page can
    // appear after sign-in; ending the oldest one lets us through.
    const endBtn = page.getByRole('button', { name: /End Oldest Inactive Session/i }).first();
    if (await endBtn.count()) {
      await endBtn.click();
      console.log('Cleared an existing session (End Oldest Inactive Session).');
      await page.waitForTimeout(5000);
    }
    console.log('If you are on the dashboard now, you are logged in. If an MFA/other step shows, finish it in the window.');
  } catch (err) {
    console.log('Auto-login step did not complete (' + err.message + ') -- finish logging in by hand in the window.');
  }
}

async function main() {
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded' });
  console.log('Browser open -- MLSListings:');
  console.log('  ' + config.mls.dashboardUrl);
  await autoLogin(page);
  console.log('Waiting up to ' + Math.round(WAIT_MS / 1000) + 's before closing (leave it while you confirm you are in)...');
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
