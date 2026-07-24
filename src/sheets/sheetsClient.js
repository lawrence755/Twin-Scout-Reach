/**
 * Thin wrapper around the Sheets API for what Node.js needs to touch
 * directly: reading/updating Outreach Queue rows (for the Redfin
 * enrichment step and the Google Voice steps) and appending to Auto
 * Outreach Log. Everything else (validation, templates, the manual-
 * approval Gmail send) lives in the Apps Script project, which is
 * bound to the sheet and doesn't need a service account.
 */
const { google } = require('googleapis');
const config = require('../config');
const {
  OUTREACH_QUEUE_SHEET_NAME,
  OUTREACH_QUEUE_HEADERS,
  AUTO_OUTREACH_LOG_SHEET_NAME,
  AUTO_OUTREACH_LOG_COLUMN_ORDER,
  SUPPRESSION_LIST_SHEET_NAME,
  SUPPRESSION_LIST_HEADERS
} = require('./outreachQueueSchema');

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.sheets.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

function requireSheetId() {
  if (!config.sheets.sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set -- see .env.example.');
  }
}

function rowsToObjects(headerRow, dataRows) {
  return dataRows.map((raw, i) => {
    const obj = { __rowNumber: i + 2 }; // +1 for header, +1 for 1-based rows
    headerRow.forEach((label, col) => {
      const key = OUTREACH_QUEUE_HEADERS[label];
      if (key) obj[key] = raw[col] || '';
    });
    return obj;
  });
}

/**
 * Reads every Outreach Queue row, optionally filtered. filterFn
 * receives the same row-object shape used throughout this file.
 */
async function getOutreachQueueRows(filterFn) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  const rows = rowsToObjects(headerRow || [], dataRows);
  return filterFn ? rows.filter(filterFn) : rows;
}

async function getApprovedSmsRows() {
  return getOutreachQueueRows((row) => row.status === 'Approved' && row.renderedSmsBody);
}

function columnLetter(zeroBasedIndex) {
  let n = zeroBasedIndex + 1;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Writes a partial set of fields (by camelCase key, per
 * OUTREACH_QUEUE_HEADERS) back to one Outreach Queue row.
 */
async function updateOutreachQueueRow(rowNumber, fields) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'!1:1`
  });
  const headerRow = headerRes.data.values[0];
  const labelByKey = {};
  Object.keys(OUTREACH_QUEUE_HEADERS).forEach((label) => {
    labelByKey[OUTREACH_QUEUE_HEADERS[label]] = label;
  });

  const updates = [];
  Object.keys(fields).forEach((key) => {
    const label = labelByKey[key];
    if (!label) return;
    const col = headerRow.indexOf(label);
    if (col === -1) return;
    updates.push({
      range: `'${OUTREACH_QUEUE_SHEET_NAME}'!${columnLetter(col)}${rowNumber}`,
      values: [[fields[key]]]
    });
  });
  if (updates.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { valueInputOption: 'RAW', data: updates }
  });
}

/**
 * Appends a new row to Outreach Queue, mapping camelCase keys (per
 * OUTREACH_QUEUE_HEADERS) to whichever columns actually exist, in
 * whatever order they're in -- so this stays correct even if columns
 * get reordered in the Sheet.
 */
async function appendOutreachQueueRow(fields) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'!1:1`
  });
  const headerRow = headerRes.data.values[0];
  const row = headerRow.map((label) => {
    const key = OUTREACH_QUEUE_HEADERS[label];
    return key && fields[key] !== undefined ? fields[key] : '';
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

/**
 * Writes the human operator's confirmed outcome for one SMS record
 * back to the sheet (Phase 7, step 9).
 */
async function writeVoiceOutcome(rowNumber, { status, notes }) {
  return updateOutreachQueueRow(rowNumber, { status, qualificationReasons: notes });
}

/**
 * Appends one row to Auto Outreach Log -- used by the auto-send paths
 * (Redfin-enriched contacts, no-per-message-approval sends) so that
 * history stays visually separate from the human-approved Communication
 * Log. `channel` is 'Email' or 'SMS'; this is what marks the "text"
 * rows in the sheet.
 */
async function appendAutoOutreachLog(fields) {
  requireSheetId();
  const sheets = await getSheetsClient();
  const row = AUTO_OUTREACH_LOG_COLUMN_ORDER.map((key) => (fields[key] !== undefined ? fields[key] : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.sheetId,
    range: `'${AUTO_OUTREACH_LOG_SHEET_NAME}'`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

/**
 * Reads the Suppression List tab -- required so the Node-side
 * auto-send path can never skip this check, even though it isn't
 * going through the Apps Script approval flow.
 */
async function getSuppressionList() {
  requireSheetId();
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${SUPPRESSION_LIST_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  return dataRows.map((raw) => {
    const obj = {};
    (headerRow || []).forEach((label, col) => {
      const key = SUPPRESSION_LIST_HEADERS[label];
      if (key) obj[key] = raw[col] || '';
    });
    return obj;
  });
}

module.exports = {
  getOutreachQueueRows,
  getApprovedSmsRows,
  updateOutreachQueueRow,
  appendOutreachQueueRow,
  writeVoiceOutcome,
  appendAutoOutreachLog,
  getSuppressionList
};
