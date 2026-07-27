/**
 * Access to the Flip Scout Leads tab. Bryan's FlipScoutSheet.js owns
 * that tab entirely (hourly sync, KPI tab, rejected-leads blacklist) --
 * this app is read-only on it. Current outreach status lives in the
 * app-owned "Outreach Status" tab instead (see
 * writeOutreachStatusSnapshot() below) -- a prior "Contacted?" mirror
 * column on Flip Scout Leads itself was retired once that column
 * stopped existing on Bryan's sheet, since Outreach Status already
 * covers the same info and more. Every other outreach-related concern
 * (queue, log, suppression list) still lives entirely locally -- see
 * src/outreach/store.js.
 */
const { google } = require('googleapis');
const config = require('../config');
const { normalizeAddress } = require('../../shared/keys');

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
  'Flip Quality': 'flipQuality',
  'REI Link & Agent Name': 'reiAgentName',
  // Listing-agent contact captured upstream on Paragon/MLS by Juan's
  // Flip Scout Agent and carried through its leads_for_sheets.json feed
  // (see apps-script/FlipScoutSheet.js). This is the authoritative,
  // no-scrape source for agent contact -- read here if the columns
  // exist, ignored if they don't yet, so this is safe to ship ahead of
  // the feed/Apps Script actually emitting them. See docs/AGENT_CONTACT_SOURCING.md.
  'Agent Name': 'agentName',
  'Agent Phone': 'agentPhone',
  'Agent Email': 'agentEmail'
};

const GOOD_FLIP_QUALITY = 'Good Flip';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.sheets.credentialsPath,
    // Full read/write scope -- needed for the various write functions
    // below (writeOutreachStatusSnapshot, writeOutreachReviewDetails).
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

  // "REI Link & Agent Name" displays the agent's name but carries their
  // REI BlackBook contact URL as a hyperlink, not as cell text -- a
  // plain values.get() above only ever returns the display text, so a
  // second, hyperlink-aware read is needed to recover the actual link.
  const reiColIndex = (headerRow || []).indexOf('REI Link & Agent Name');
  if (reiColIndex !== -1 && dataRows.length > 0) {
    const colLetter = columnIndexToLetter(reiColIndex);
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: config.sheets.sheetId,
      ranges: [`'${FLIP_SCOUT_SHEET_NAME}'!${colLetter}2:${colLetter}${dataRows.length + 1}`],
      fields: 'sheets.data.rowData.values(hyperlink)'
    });
    const rowData = (meta.data.sheets[0].data[0] || {}).rowData || [];
    rows.forEach((row, i) => {
      const cell = rowData[i] && rowData[i].values && rowData[i].values[0];
      row.reiContactLink = (cell && cell.hyperlink) || '';
    });
  }

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

const REDFIN_AGENT_CONTACTS_SHEET_NAME = 'Redfin Agent Contacts';

// Matches the header row created for Claude Cowork's crawl -- see
// docs/COWORK_REDFIN_CRAWL_PROMPT.md. Cowork owns writes to this tab;
// this app only ever reads from it.
const REDFIN_AGENT_CONTACTS_HEADERS = {
  'Address': 'propertyAddress',
  'Redfin Link': 'redfinLink',
  'Agent Name': 'agentName',
  'Agent Phone': 'agentPhone',
  'Brokerage': 'brokerage',
  'DRE #': 'dreNumber',
  'Agent Email': 'agentEmail',
  'Fetched At': 'fetchedAt'
};

/**
 * Reads every row Cowork has fetched into the "Redfin Agent Contacts"
 * tab. Read-only -- nothing here ever writes to this tab.
 */
async function getRedfinAgentContacts() {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${REDFIN_AGENT_CONTACTS_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  return dataRows.map((raw) => {
    // Cowork's actual output (observed 2026-07-25) writes each row as
    // one string with literal tab characters crammed into column A,
    // rather than real per-column values -- tolerate that by splitting
    // it back apart first. A leading "'" on a cell is Cowork guarding
    // against Sheets auto-reformatting a DRE #/timestamp as a number
    // once split into real columns -- not real data, so strip it.
    const cells = (raw.length === 1 && raw[0] && raw[0].includes('\t'))
      ? raw[0].split('\t').map((c) => c.replace(/^'/, ''))
      : raw;
    const obj = {};
    (headerRow || []).forEach((label, col) => {
      const key = REDFIN_AGENT_CONTACTS_HEADERS[label];
      if (key) obj[key] = cells[col] !== undefined ? cells[col] : '';
    });
    return obj;
  }).filter((row) => row.propertyAddress);
}

const OUTREACH_REVIEW_SHEET_NAME = 'Outreach Review';
const OUTREACH_REVIEW_HEADERS = {
  'Address': 'propertyAddress',
  'Ready for Automated Outreach?': 'readyForAutomatedOutreach',
  'Reviewed By': 'reviewedBy',
  'Reviewed At': 'reviewedAt',
  'Agent Name': 'agentName',
  'Agent Phone': 'agentPhone',
  'Agent Email': 'agentEmail',
  'REI Notes Flag': 'reiNotesFlag'
};

// Columns REI BlackBook enrichment writes automatically -- "Address",
// "Ready for Automated Outreach?", "Reviewed By", and "Reviewed At"
// stay human-owned (never written by writeOutreachReviewDetails below).
const OUTREACH_REVIEW_DETAIL_COLUMNS = ['Agent Name', 'Agent Phone', 'Agent Email', 'REI Notes Flag'];

/**
 * Reads every row from the "Outreach Review" tab -- a separate,
 * small tab (not a 26th column on the already-busy Flip Scout Leads
 * sheet) where a human marks whether a lead is actually clear for
 * automated outreach, keyed by Address.
 */
async function getOutreachReviewRows() {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  return dataRows.map((raw) => {
    const obj = {};
    (headerRow || []).forEach((label, col) => {
      const key = OUTREACH_REVIEW_HEADERS[label];
      if (key) obj[key] = raw[col] !== undefined ? raw[col] : '';
    });
    return obj;
  }).filter((row) => row.propertyAddress);
}

// Canonical column order for the Outreach Review tab, derived from the
// header map above so the two can't drift. Address + the human-owned
// decision columns come first, then the automation-filled detail columns.
const OUTREACH_REVIEW_ORDERED_HEADERS = Object.keys(OUTREACH_REVIEW_HEADERS);

/**
 * Makes sure the Outreach Review tab exists and has a header row.
 * Creates the tab on first use (with the full canonical header), and
 * writes the header if the tab exists but is empty. Returns the current
 * header row so callers can map labels to column positions.
 */
async function ensureOutreachReviewSheetExists(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheets.sheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties.title === OUTREACH_REVIEW_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: OUTREACH_REVIEW_SHEET_NAME } } }] }
    });
  }
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'!1:1`
  });
  let headerRow = (data.values || [[]])[0] || [];
  if (headerRow.length === 0) {
    headerRow = OUTREACH_REVIEW_ORDERED_HEADERS.slice();
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `'${OUTREACH_REVIEW_SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headerRow] }
    });
  }
  return headerRow;
}

/**
 * Front of the Sheet-driven flow: mirrors "Good Flip" leads from Flip
 * Scout Leads into the Outreach Review tab, where a human then marks
 * each "Ready for Automated Outreach?". Good Flip is the trigger;
 * Outreach Review is the human decision surface.
 *
 * Upserts by normalized Address -- appends a row for any lead not
 * already present, and does NOT touch rows that already exist (so a
 * human's "Ready?" decision, or their hand-edited agent info, is never
 * overwritten by a later cycle re-seeing the same Good Flip lead).
 * Agent name/phone/email are pre-filled where already known; the rest
 * gets filled in later by enrichment (writeOutreachReviewDetails).
 *
 * `leads` is a list of { propertyAddress, agentName?, agentPhone?,
 * agentEmail? }. Returns { added: [address...], existing: n }.
 */
async function syncGoodFlipToOutreachReview(leads) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const headerRow = await ensureOutreachReviewSheetExists(sheets);

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'`
  });
  const rows = data.values || [];
  const addressColIndex = headerRow.indexOf('Address');
  const existing = new Set();
  for (let i = 1; i < rows.length; i++) {
    const addr = normalizeAddress((rows[i] || [])[addressColIndex] || '');
    if (addr) existing.add(addr);
  }

  const seenThisRun = new Set();
  const missing = (leads || []).filter((l) => {
    const addr = normalizeAddress(l.propertyAddress || '');
    if (!addr || existing.has(addr) || seenThisRun.has(addr)) return false;
    seenThisRun.add(addr);
    return true;
  });
  if (missing.length === 0) return { added: [], existing: existing.size };

  const colOf = (label) => headerRow.indexOf(label);
  const newRows = missing.map((l) => {
    const row = new Array(headerRow.length).fill('');
    const put = (label, value) => { const c = colOf(label); if (c !== -1) row[c] = value || ''; };
    put('Address', l.propertyAddress);
    put('Agent Name', l.agentName);
    put('Agent Phone', l.agentPhone);
    put('Agent Email', l.agentEmail);
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows }
  });

  return { added: missing.map((l) => l.propertyAddress), existing: existing.size };
}

async function ensureOutreachReviewDetailColumns(sheets, headerRow) {
  const missing = OUTREACH_REVIEW_DETAIL_COLUMNS.filter((h) => !headerRow.includes(h));
  if (missing.length === 0) return headerRow;
  const newHeaderRow = [...headerRow, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [newHeaderRow] }
  });
  return newHeaderRow;
}

/**
 * Writes REI BlackBook-fetched details (agent name/phone/email, and
 * any do-not-automate note found) into the "Outreach Review" tab, so
 * whoever reviews a lead there already has what was found without
 * needing to separately open REI BlackBook themselves. Upserts by
 * Address: updates only the detail columns on a matching row, or
 * appends a new row (with the human-owned columns left blank for
 * them to fill in) if the address isn't there yet. Never touches
 * "Ready for Automated Outreach?", "Reviewed By", or "Reviewed At" --
 * those stay entirely human-owned.
 */
async function writeOutreachReviewDetails(propertyAddress, details) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data: headerData } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'!1:1`
  });
  const headerRow = await ensureOutreachReviewDetailColumns(sheets, (headerData.values || [[]])[0] || []);

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_REVIEW_SHEET_NAME}'`
  });
  const rows = data.values || [];
  const addressColIndex = headerRow.indexOf('Address');
  const target = normalizeAddress(propertyAddress);
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (normalizeAddress(rows[i][addressColIndex] || '') === target) { rowIndex = i; break; }
  }

  const valuesToWrite = {
    'Agent Name': details.agentName || '',
    'Agent Phone': details.agentPhone || '',
    'Agent Email': details.agentEmail || '',
    'REI Notes Flag': details.reiNotesFlag || ''
  };

  if (rowIndex === -1) {
    const newRow = new Array(headerRow.length).fill('');
    newRow[addressColIndex] = propertyAddress;
    Object.keys(valuesToWrite).forEach((h) => {
      const idx = headerRow.indexOf(h);
      if (idx !== -1) newRow[idx] = valuesToWrite[h];
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheets.sheetId,
      range: `'${OUTREACH_REVIEW_SHEET_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
    return;
  }

  const updates = [];
  Object.keys(valuesToWrite).forEach((h) => {
    const colIdx = headerRow.indexOf(h);
    if (colIdx === -1) return;
    updates.push({
      range: `'${OUTREACH_REVIEW_SHEET_NAME}'!${columnIndexToLetter(colIdx)}${rowIndex + 1}`,
      values: [[valuesToWrite[h]]]
    });
  });
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });
  }
}

module.exports = {
  getFlipScoutLeads,
  writeOutreachStatusSnapshot,
  getRedfinAgentContacts,
  getOutreachReviewRows,
  writeOutreachReviewDetails,
  syncGoodFlipToOutreachReview,
  FLIP_SCOUT_SHEET_NAME,
  OUTREACH_STATUS_SHEET_NAME,
  REDFIN_AGENT_CONTACTS_SHEET_NAME,
  OUTREACH_REVIEW_SHEET_NAME,
  GOOD_FLIP_QUALITY
};
