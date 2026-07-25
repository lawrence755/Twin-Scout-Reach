/**
 * Access to the Flip Scout Leads tab. Bryan's FlipScoutSheet.js owns
 * that tab entirely (hourly sync, KPI tab, rejected-leads blacklist);
 * this app is read-only on everything except one deliberate exception:
 * the "Contacted?" column, which checkReplies() keeps in sync with
 * local outreach status (see updateContactedColumn()) so Bryan/the
 * team can see progress at a glance without opening the app. Every
 * other outreach-related concern (queue, log, suppression list) still
 * lives entirely locally -- see src/outreach/store.js.
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
    // Full read/write scope -- needed for updateContactedColumn() below.
    // The service account must be shared on the Sheet as Editor, not
    // just Viewer, for writes to actually succeed.
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
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

function columnIndexToLetter(index) {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Writes into the "Contacted?" column for every Flip Scout Leads row
 * whose Address matches a key in statusByAddress (e.g.
 * { '123 Test St': 'Handed Off', '456 Test Ave': 'Following Up' }).
 * Looks up "Address" and "Contacted?" by header label each call rather
 * than a hardcoded column letter, so this keeps working if Bryan's
 * sheet ever gets columns reordered/inserted.
 */
async function updateContactedColumn(statusByAddress) {
  requireSheetId();
  if (!statusByAddress || Object.keys(statusByAddress).length === 0) return { updated: 0 };

  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${FLIP_SCOUT_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  const contactedColIndex = (headerRow || []).indexOf('Contacted?');
  const addressColIndex = (headerRow || []).indexOf('Address');
  if (contactedColIndex === -1) {
    throw new Error('No "Contacted?" column found in the Flip Scout Leads header row.');
  }
  if (addressColIndex === -1) {
    throw new Error('No "Address" column found in the Flip Scout Leads header row.');
  }
  const colLetter = columnIndexToLetter(contactedColIndex);

  const updates = [];
  dataRows.forEach((raw, i) => {
    const address = raw[addressColIndex];
    if (address && Object.prototype.hasOwnProperty.call(statusByAddress, address)) {
      updates.push({
        range: `'${FLIP_SCOUT_SHEET_NAME}'!${colLetter}${i + 2}`,
        values: [[statusByAddress[address]]]
      });
    }
  });
  if (updates.length === 0) return { updated: 0 };

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { valueInputOption: 'RAW', data: updates }
  });
  return { updated: updates.length };
}

const OUTREACH_STATUS_SHEET_NAME = 'Outreach Status';
const OUTREACH_STATUS_HEADERS = [
  'Address', 'Agent Name', 'Agent Phone', 'Status', 'Campaign',
  'Contacted At', 'Days Since Contacted', 'Last Updated'
];

async function ensureOutreachStatusSheetExists(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.sheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === OUTREACH_STATUS_SHEET_NAME);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: OUTREACH_STATUS_SHEET_NAME } } }] }
  });
}

/**
 * Full-overwrite snapshot of the local Outreach Queue into its own,
 * app-owned "Outreach Status" tab -- purely a read-only reporting
 * mirror for Bryan/the team, not a second source of truth. Creates
 * the tab on first use. Safe to fully overwrite every call since
 * nothing but this function ever writes to this specific tab.
 */
async function writeOutreachStatusSnapshot(rows) {
  requireSheetId();
  const sheets = await getSheetsClient();
  await ensureOutreachStatusSheetExists(sheets);

  const values = [OUTREACH_STATUS_HEADERS, ...rows.map((r) => [
    r.propertyAddress || '', r.agentName || '', r.agentPhone || '', r.status || '',
    r.campaign || '', r.contactedAt || '', r.daysSinceContacted != null ? r.daysSinceContacted : '',
    r.lastUpdated || ''
  ])];

  // Clear the tab first -- row count shrinks over time (e.g. a test
  // row's outreach key changes), and a plain values.update would leave
  // stale rows behind past the new data's end.
  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_STATUS_SHEET_NAME}'`
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_STATUS_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
  return { rows: rows.length };
}

module.exports = {
  getFlipScoutLeads,
  updateContactedColumn,
  writeOutreachStatusSnapshot,
  FLIP_SCOUT_SHEET_NAME,
  OUTREACH_STATUS_SHEET_NAME,
  GOOD_FLIP_QUALITY
};
