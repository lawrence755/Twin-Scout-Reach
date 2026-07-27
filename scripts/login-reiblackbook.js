#!/usr/bin/env node
/**
 * Opens a real, visible Chromium window with a persistent profile so
 * the REI BlackBook session is saved on disk (REI_PROFILE_DIR) for the
 * enrich / notes / replies / send jobs to reuse.
 *
 * If REI_EMAIL and REI_PASSWORD are set in .env, it first tries to log
 * in automatically. If that doesn't complete for any reason (the login
 * form differs from what's expected, a captcha/2FA challenge appears,
 * etc.) it falls back to the original behavior: leave the window open
 * and wait for a human to finish logging in by hand. So auto-login can
 * only help -- it never blocks the manual path.
 *
 * The password is read fresh from .env (never hard-coded, never logged)
 * and .env is gitignored, so the credential stays local.
 */
const { chromium } = require('playwright');
const config = require('../src/config');
const { REI_PROFILE_DIR } = require('../src/reiblackbook/scrapeReiBlackBook');

const WAIT_MS = Number(process.env.REI_LOGIN_WAIT_MS || 5 * 60 * 1000);
const LOGIN_URL = config.liveEnvValue('REI_LOGIN_URL') || 'https://my.reiblackbook.com';
const EMAIL = config.liveEnvValue('REI_EMAIL');
const PASSWORD = config.liveEnvValue('REI_PASSWORD');

/**
 * Heuristic: the login screen has a visible password field; the
 * authenticated app does not. "No visible password field" => logged in.
 */
async function isLoggedIn(page) {
  const pw = page.locator('input[type="password"]').first();
  return !(await pw.isVisible({ timeout: 4000 }).catch(() => false));
}

/**
 * Best-effort fill of a standard email/password login form. These
 * selectors are NOT verified against the live REI BlackBook DOM (its
 * bot detection blocks the automated inspection the rest of this repo's
 * selectors were verified with), so they intentionally cast a wide net
 * and the caller treats any failure as "fall back to manual".
 */
async function attemptAutoLogin(page) {
  const email = page.locator(
    'input[type="email"], input[name="email" i], input[autocomplete="username"], input[placeholder*="mail" i]'
  ).first();
  const password = page.locator('input[type="password"]').first();

  await email.waitFor({ state: 'visible', timeout: 15000 });
  await email.fill(EMAIL);
  await password.fill(PASSWORD);

  const submit = page.getByRole('button', { name: /log ?in|sign ?in/i }).first();
  if (await submit.count()) {
    await submit.click();
  } else {
    await password.press('Enter');
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

async function main() {
  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  if (await isLoggedIn(page)) {
    console.log('Already logged in -- existing session in ' + REI_PROFILE_DIR + '. Nothing to do.');
    await context.close();
    return;
  }

  if (EMAIL && PASSWORD) {
    console.log('Attempting automatic login as ' + EMAIL + ' ...');
    try {
      await attemptAutoLogin(page);
      await page.waitForTimeout(3000);
      if (await isLoggedIn(page)) {
        console.log('Auto-login succeeded. Session saved in ' + REI_PROFILE_DIR + '.');
        await context.close();
        return;
      }
      console.log('Auto-login did not complete (login form may differ, or a captcha/2FA appeared).');
    } catch (err) {
      console.log('Auto-login could not run: ' + err.message);
    }
    console.log('Falling back to manual login -- finish logging in in the window that is open.');
  } else {
    console.log('No REI_EMAIL / REI_PASSWORD in .env -- log into REI BlackBook by hand in the window.');
  }

  console.log('Waiting up to ' + Math.round(WAIT_MS / 1000) + 's before closing...');
  await page.waitForTimeout(WAIT_MS);
  console.log('Closing. Login session (if any) is saved in ' + REI_PROFILE_DIR + ' for reuse.');
  await context.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { main };
