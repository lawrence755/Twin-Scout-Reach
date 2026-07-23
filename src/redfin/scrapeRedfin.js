/**
 * Fetches one Redfin listing page and extracts the listing agent's
 * name/phone. This does NOT use any stealth/anti-detection technique
 * (no fingerprint spoofing, no proxy rotation, no CAPTCHA solving) --
 * if Redfin serves a block or CAPTCHA page, this stops and reports it
 * rather than trying to get around it. See docs/AUTO_MODE_RISKS.md
 * for why that line is drawn there and what it means for you.
 */
const { chromium } = require('playwright');
const { parseAgentInfoFromPageText, looksBlocked } = require('./parseAgentInfo');

async function scrapeRedfinListing(url, { delayMs = 0 } = {}) {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pageText = await page.innerText('body').catch(() => '');

    if (looksBlocked(pageText)) {
      throw new Error('Redfin returned a bot-check/CAPTCHA page for ' + url + ' -- not attempting to bypass it.');
    }

    const { agentName, agentPhone } = parseAgentInfoFromPageText(pageText);
    if (!agentName && !agentPhone) {
      throw new Error('Could not find "Listed by" agent info on ' + url + ' -- selectors may need updating.');
    }
    return { agentName, agentPhone, sourceUrl: url };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeRedfinListing };
