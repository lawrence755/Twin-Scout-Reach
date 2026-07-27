/**
 * Opens an MLSListings Pro Dashboard browser context that reuses the
 * persistent login profile (.mlslistings-profile/). Login itself is done
 * once, by hand, via `npm run mlslistings:login` -- this module never
 * types credentials or clicks through a login flow; it just reuses the
 * saved session so a batch run doesn't re-authenticate (and can't get
 * stuck on MFA/CAPTCHA).
 *
 * Returns { context, page }. The caller owns closing the context.
 */
const { chromium } = require('playwright');
const config = require('../src/config');
const { MLS_PROFILE_DIR, looksLoggedOut } = require('../src/mlslistings/scrapeMlsListings');

async function openLoggedInContext() {
  const context = await chromium.launchPersistentContext(MLS_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(config.mls.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  const text = await page.innerText('body').catch(() => '');
  if (looksLoggedOut(text)) {
    await context.close();
    throw new Error(
      'Not logged into MLSListings. Run `npm run mlslistings:login`, sign in in the ' +
      'window that opens, let it close, then re-run enrichment.'
    );
  }

  return { context, page };
}

module.exports = { openLoggedInContext };
