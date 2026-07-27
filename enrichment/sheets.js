/**
 * Google Sheets access for the enrichment module.
 *
 * Reads the "Flip Scout Leads" tab and, cross-referenced with the app's
 * "Outreach Review" tab, returns only the rows that still need agent
 * contact (missing phone or email). Writes results back into the
 * "Outreach Review" tab -- never into Bryan's "Flip Scout Leads" tab,
 * which stays read-only/owned by his Apps Script.
 *
 * Thin wrapper over the app's already-tested sheet client
 * (src/sheets/sheetsClient.js) so there is ONE Google auth story (the
 * service account in GOOGLE_APPLICATION_CREDENTIALS) and one sheet-schema
 * definition, not a second parallel copy.
 */
const { getFlipScoutLeads, getOutreachReviewRows, writeOutreachReviewDetails } = require('../src/sheets/sheetsClient');
const { normalizeAddress } = require('../shared/keys');

/**
 * Every Flip Scout lead that still needs enrichment: has an address, and
 * (per the Outreach Review tab) is missing an agent phone or email.
 * Returns { address, agentName, agentPhone, agentEmail } with whatever is
 * already known pre-filled, so searchAndExtract only has to find the gaps.
 */
async function getRowsNeedingEnrichment() {
  const [leads, reviewRows] = await Promise.all([
    getFlipScoutLeads(),
    getOutreachReviewRows().catch(() => []) // tab may not exist yet -> treat as empty
  ]);
  const reviewByAddress = new Map(
    reviewRows.map((r) => [normalizeAddress(r.propertyAddress), r])
  );

  return leads
    .map((lead) => {
      const review = reviewByAddress.get(normalizeAddress(lead.propertyAddress)) || {};
      return {
        address: lead.propertyAddress,
        agentName: review.agentName || lead.reiAgentName || '',
        agentPhone: review.agentPhone || '',
        agentEmail: review.agentEmail || ''
      };
    })
    .filter((row) => row.address && (!row.agentPhone || !row.agentEmail));
}

/**
 * Upserts the found agent contact into the "Outreach Review" tab, keyed
 * by address (only the Agent Name/Phone/Email columns -- the human-owned
 * "Ready for Automated Outreach?" decision columns are never touched).
 */
async function saveAgentContact(address, { name, phone, email }) {
  await writeOutreachReviewDetails(address, {
    agentName: name || '',
    agentPhone: phone || '',
    agentEmail: email || ''
  });
}

module.exports = { getRowsNeedingEnrichment, saveAgentContact };
