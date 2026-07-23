/**
 * Menu wiring and small cross-cutting helpers (Settings lookups, error
 * logging, sheet-row <-> object mapping) shared by QueueActions.js and
 * GmailSender.js.
 *
 * This project also contains Bryan's existing FlipScoutSheet.js, which
 * defines its own function onOpen() (the "Flip Scout" menu). Apps
 * Script only runs one function literally named onOpen -- a second
 * top-level onOpen() here would silently make one of the two menus
 * stop appearing, with no error. So the Outreach menu is NOT built via
 * onOpen(); it's built by buildOutreachMenu_() below, wired up as an
 * independent *installable* onOpen trigger (installOutreachMenuTrigger_,
 * called by setupOutreachSheets()). Apps Script fires every installable
 * onOpen trigger in a project alongside the one simple onOpen() function,
 * so both menus appear on every sheet load without either file touching
 * the other.
 */
function buildOutreachMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('Outreach')
    .addItem('Set up outreach tabs', 'setupOutreachSheets')
    .addSeparator()
    .addItem('Add selected Flip Scout rows', 'addSelectedFlipScoutRows')
    .addItem('Refresh validation', 'refreshValidation')
    .addItem('Submit for approval', 'submitForApproval')
    .addItem('Approve outreach', 'approveOutreach')
    .addItem('Send approved emails', 'sendApprovedEmails')
    .addSeparator()
    .addItem('Auto-send eligible outreach (skips approval)', 'autoSendEligibleOutreach')
    .addToUi();
}

/**
 * Idempotent, like Bryan's enableHourlyTrigger() -- safe to call every
 * time setupOutreachSheets() runs. Must be run once manually the very
 * first time (select installOutreachMenuTrigger_ or setupOutreachSheets
 * in the Apps Script editor's function dropdown and click Run), since
 * before it exists there's no menu item to click.
 */
function installOutreachMenuTrigger_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'buildOutreachMenu_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('buildOutreachMenu_').forSpreadsheet(ss).onOpen().create();
}

/**
 * Wraps a menu action so any thrown error is written to the Error Log
 * tab and surfaced to the operator, instead of failing silently.
 */
function runGuarded_(functionName, rowReference, fn) {
  try {
    return fn();
  } catch (err) {
    logError_(functionName, rowReference, err);
    SpreadsheetApp.getUi().alert(functionName + ' failed: ' + err.message + '\nSee the Error Log tab for details.');
    throw err;
  }
}

function logError_(functionName, rowReference, err) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.ERROR_LOG);
  if (!sheet) return;
  sheet.appendRow([new Date(), functionName, rowReference || '', err && err.message ? err.message : String(err)]);
}

function getSettings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  var settings = {};
  if (!sheet) return settings;
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) settings[rows[i][0]] = rows[i][1];
  }
  return settings;
}

function isTruthySetting_(value) {
  return String(value).trim().toUpperCase() === 'TRUE';
}

/**
 * Reads a sheet into an array of row objects keyed by the camelCase
 * names in `columnDefs`, plus a hidden `__rowNumber` (1-based sheet row)
 * for writing back.
 */
function readSheetAsObjects_(sheet, columnDefs) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headerRow = data[0];
  var headerIndex = {};
  for (var c = 0; c < headerRow.length; c++) headerIndex[headerRow[c]] = c;

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var raw = data[r];
    if (raw.join('') === '') continue; // skip fully blank rows
    var obj = { __rowNumber: r + 1 };
    for (var k = 0; k < columnDefs.length; k++) {
      var label = columnDefs[k][0];
      var key = columnDefs[k][1];
      var idx = headerIndex[label];
      obj[key] = idx === undefined ? '' : raw[idx];
    }
    rows.push(obj);
  }
  return rows;
}

function writeObjectFields_(sheet, columnDefs, rowNumber, fields) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerIndex = {};
  for (var c = 0; c < headerRow.length; c++) headerIndex[headerRow[c]] = c;

  Object.keys(fields).forEach(function (key) {
    var label = null;
    for (var k = 0; k < columnDefs.length; k++) {
      if (columnDefs[k][1] === key) { label = columnDefs[k][0]; break; }
    }
    if (label === null) return;
    var idx = headerIndex[label];
    if (idx === undefined) return;
    sheet.getRange(rowNumber, idx + 1).setValue(fields[key]);
  });
}

function coerceBoolean_(value) {
  if (typeof value === 'boolean') return value;
  var normalized = String(value).trim().toUpperCase();
  if (normalized === 'TRUE' || normalized === 'YES') return true;
  if (normalized === 'FALSE' || normalized === 'NO' || normalized === '') return false;
  return undefined; // ambiguous -> treated as missing by evaluateQualification
}
