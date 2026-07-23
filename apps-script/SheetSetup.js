/**
 * Creates/verifies the outreach layer tabs. Idempotent -- safe to run
 * repeatedly. Never touches the Flip Scout Leads tab.
 */
function setupOutreachSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheetWithHeaders_(ss, SHEET_NAMES.OUTREACH_QUEUE, columnLabels_(OUTREACH_QUEUE_COLUMNS));
  ensureSheetWithHeaders_(ss, SHEET_NAMES.MESSAGE_TEMPLATES, columnLabels_(MESSAGE_TEMPLATES_COLUMNS));
  ensureSheetWithHeaders_(ss, SHEET_NAMES.COMMUNICATION_LOG, columnLabels_(COMMUNICATION_LOG_COLUMNS));
  ensureSheetWithHeaders_(ss, SHEET_NAMES.SUPPRESSION_LIST, columnLabels_(SUPPRESSION_LIST_COLUMNS));
  ensureSheetWithHeaders_(ss, SHEET_NAMES.ERROR_LOG, columnLabels_(ERROR_LOG_COLUMNS));
  ensureSheetWithHeaders_(ss, SHEET_NAMES.AUTO_OUTREACH_LOG, columnLabels_(AUTO_OUTREACH_LOG_COLUMNS));

  var settingsSheet = ensureSheetWithHeaders_(ss, SHEET_NAMES.SETTINGS, columnLabels_(SETTINGS_COLUMNS));
  seedDefaultSettings_(settingsSheet);

  SpreadsheetApp.getUi().alert('Outreach tabs are set up. Flip Scout Leads was not modified.');
}

function columnLabels_(columnDefs) {
  return columnDefs.map(function (pair) { return pair[0]; });
}

function ensureSheetWithHeaders_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var existing = headerRange.getValues()[0];
  var needsHeaders = existing.join('') === '';
  if (needsHeaders) {
    headerRange.setValues([headers]);
    sheet.setFrozenRows(1);
    headerRange.setFontWeight('bold');
  }
  return sheet;
}

function seedDefaultSettings_(settingsSheet) {
  var existingRows = settingsSheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existingRows.length; i++) {
    if (existingRows[i][0]) existingKeys[existingRows[i][0]] = true;
  }
  var rowsToAdd = DEFAULT_SETTINGS_ROWS.filter(function (row) {
    return !existingKeys[row[0]];
  });
  if (rowsToAdd.length > 0) {
    settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, rowsToAdd.length, 3).setValues(rowsToAdd);
  }
}
