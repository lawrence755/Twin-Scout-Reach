/**
 * Thin wrapper around the Sheets API for the one thing Node.js needs
 * from the spreadsheet directly: reading "Approved" SMS rows for the
 * Playwright Google Voice step (Phase 7), and writing the outcome back.
 *
 * Everything else (validation, templates, Gmail send) lives in the
 * Apps Script project, which is bound to the sheet and doesn't need a
 * service account. This client is intentionally narrow.
 */
const { google } = require('googleapis');
const config = require('../config');
const { OUTREACH_QUEUE_SHEET_NAME, OUTREACH_QUEUE_HEADERS } = require('./outreachQueueSchema');

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.sheets.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
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
 * Returns Outreach Queue rows that are "Approved" and have a rendered
 * SMS body -- the set Playwright should prepare (never send) messages
 * for.
 */
async function getApprovedSmsRows() {
  if (!config.sheets.sheetId) {
    throw new Error('GOOGLE_SHEET_ID is not set -- see .env.example.');
  }
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'`
  });
  const [headerRow, ...dataRows] = data.values || [[]];
  return rowsToObjects(headerRow || [], dataRows).filter(
    (row) => row.status === 'Approved' && row.renderedSmsBody
  );
}

/**
 * Writes the human operator's confirmed outcome for one SMS record
 * back to the sheet (Phase 7, step 9). Never called with a "Send"
 * action performed by code -- `outcome` describes what the human did.
 */
async function writeVoiceOutcome(rowNumber, { status, notes }) {
  const sheets = await getSheetsClient();
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `'${OUTREACH_QUEUE_SHEET_NAME}'!1:1`
  });
  const headerRow = headerRes.data.values[0];
  const statusCol = headerRow.indexOf('Status');
  const reasonsCol = headerRow.indexOf('Qualification Reasons');

  const updates = [];
  if (statusCol !== -1) {
    updates.push({
      range: `'${OUTREACH_QUEUE_SHEET_NAME}'!${columnLetter(statusCol)}${rowNumber}`,
      values: [[status]]
    });
  }
  if (reasonsCol !== -1 && notes) {
    updates.push({
      range: `'${OUTREACH_QUEUE_SHEET_NAME}'!${columnLetter(reasonsCol)}${rowNumber}`,
      values: [[notes]]
    });
  }
  if (updates.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.sheetId,
    requestBody: { valueInputOption: 'RAW', data: updates }
  });
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

module.exports = { getApprovedSmsRows, writeVoiceOutcome };
