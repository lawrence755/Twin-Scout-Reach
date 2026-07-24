/**
 * Read-only access to the Flip Scout Leads tab -- the ONE thing this
 * app still reads from the Sheet. Bryan's FlipScoutSheet.js owns that
 * tab entirely (hourly sync, KPI tab, rejected-leads blacklist); this
 * app never writes to it. Everything outreach-related (queue, log,
 * suppression list) now lives locally -- see src/outreach/store.js.
 */
const { google } = require('googleapis');
const config = require('../config');

const FLIP_SCOUT_SHEET_NAME = 'Flip Scout Leads';

// Matches FlipScoutSheet.js's COLUMNS array exactly (see
// apps-script/FlipScoutSheet.js) -- header label -> camelCase key.
const FLIP_SCOUT_HEADERS = {
  'Score': 'score',
  'Recommendation': 'recommendation',
  'Address': 'propertyAddress',
  'City': 'city',
  'Zip': 'zip',
  'Beds': 'beds',
  'Baths': 'baths',
  'SqFt': 'sqft',
  'Lot SqFt': 'lotSqft',
  'Year Built': 'yearBuilt',
  'Purchase Price': 'price',
  'Estimated ARV': 'arv',
  'Rehab Cost (Light)': 'rehabLight',
  'Rehab Cost (Heavy)': 'rehabHeavy',
  'Holding Costs (3mo)': 'holdingCosts',
  'Total Cost (Light)': 'totalCostLight',
  'Total Cost (Heavy)': 'totalCostHeavy',
  'Gross Profit (Light)': 'grossProfitLight',
  'Gross Profit (Heavy)': 'grossProfitHeavy',
  'Risks': 'risks',
  'Redfin Link': 'redfinLink',
  'First Added': 'firstAdded',
  'Flip Quality': 'flipQuality'
};

const GOOD_FLIP_QUALITY = 'Good Flip';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.sheets.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

function requireSheetId() {
  if (!config.sheets.sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set -- see .env.example.');
  }
}

/**
 * Reads every Flip Scout Leads row, optionally filtered. Each row
 * object includes __sheetRow (1-based row number) so a selection made
 * in the app can be matched back to a specific lead unambiguously.
 */
async function getFlipScoutLeads(filterFn) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${FLIP_SCOUT_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  const rows = dataRows.map((raw, i) => {
    const obj = { __sheetRow: i + 2 };
    (headerRow || []).forEach((label, col) => {
      const key = FLIP_SCOUT_HEADERS[label];
      if (key) obj[key] = raw[col] !== undefined ? raw[col] : '';
    });
    return obj;
  }).filter((row) => row.propertyAddress); // skip fully-blank trailing rows
  return filterFn ? rows.filter(filterFn) : rows;
}

module.exports = { getFlipScoutLeads, FLIP_SCOUT_SHEET_NAME, GOOD_FLIP_QUALITY };
