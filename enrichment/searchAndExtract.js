/**
 * Searches MLSListings Pro Dashboard for a property by address and
 * extracts the listing agent's { name, phone, email }.
 *
 * Delegates to the shared, unit-tested scraper core
 * (src/mlslistings/scrapeMlsListings.js) so the actual search/extract
 * logic -- and the selectors that still need live verification
 * (TODO(selectors) there) -- live in exactly one place. This wrapper just
 * adapts its shape to what index.js wants.
 */
const { scrapeListingAgent } = require('../src/mlslistings/scrapeMlsListings');

/**
 * @param {import('playwright').Page} page  an already-logged-in page
 * @param {string} address                  street address to search for
 * @returns {Promise<{ found: boolean, name: string, phone: string, email: string }>}
 */
async function searchAndExtract(page, address) {
  const result = await scrapeListingAgent(page, address);
  return {
    found: result.found,
    name: result.agentName || '',
    phone: result.agentPhone || '',
    email: result.agentEmail || ''
  };
}

module.exports = { searchAndExtract };
