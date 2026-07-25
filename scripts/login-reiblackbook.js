#!/usr/bin/env node
/**
 * Opens a real, visible Chromium window with a persistent profile so
 * a human can log into REI BlackBook by hand. The login itself is
 * never automated -- this just gives you a window and waits. Once
 * logged in, the session persists on disk (REI_PROFILE_DIR) for
 * npm run reiblackbook:enrich to reuse.
 */
const { chromium } = require('playwright');
const { REI_PROFILE_DIR } = require('../src/reiblackbook/scrapeReiBlackBook');

const WAIT_MS = Number(process.env.REI_LOGIN_WAIT_MS || 5 * 60 * 1000);

async function main() {
  const context = await chromium.launchPersistentContext(REI_PROFILE_DIR, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://my.reiblackbook.com', { waitUntil: 'domcontentloaded' });
  console.log('Browser open -- log into REI BlackBook in the window that just appeared.');
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
