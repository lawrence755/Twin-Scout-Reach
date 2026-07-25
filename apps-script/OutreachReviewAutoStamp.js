/**
 * NOT IN USE -- kept for reference only, never pushed to the live
 * Apps Script project (decided 2026-07-25). Google Sheets' own
 * version history already covers "who changed this cell and when"
 * via right-click -> "Show edit history", which was judged sufficient
 * for now. The one thing this file would add over that: native
 * version history isn't readable through the Sheets API, so if
 * "Reviewed By"/"Reviewed At" ever need to be queryable from the app
 * itself (Dashboard, exports, etc.) rather than just eyeballed in the
 * Sheet UI, this is the way to get there -- until then, leave unpushed.
 *
 * Auto-stamps who reviewed a lead and when, on the "Outreach Review"
 * tab only -- fires whenever anyone edits column B ("Ready for
 * Automated Outreach?"), filling in their email (column C, "Reviewed
 * By") and the current timestamp (column D, "Reviewed At"). The
 * Node.js app (src/sheets/sheetsClient.js#writeOutreachReviewDetails)
 * never touches these two columns -- this is the only thing that
 * writes them, so it can't fight with anything else.
 *
 * Simple trigger (the function must be named exactly "onEdit") --
 * Apps Script runs this automatically for every edit to the
 * spreadsheet with no separate trigger setup needed, using the
 * editing user's own permissions (that's why Session.getActiveUser()
 * works here with no authorization prompt). If FlipScoutSheet.js or
 * anything else in this project ever defines its own onEdit(e), the
 * two must be merged into one function -- Apps Script only allows a
 * single global onEdit per project; as of this file's addition,
 * FlipScoutSheet.js only defines onOpen(), not onEdit(), so there's
 * no conflict yet.
 */
function onEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== 'Outreach Review') return;
  if (e.range.getColumn() !== 2) return; // "Ready for Automated Outreach?" column only
  if (e.range.getRow() === 1) return; // don't stamp the header row

  var row = e.range.getRow();
  var email = Session.getActiveUser().getEmail() || '(unknown)';
  sheet.getRange(row, 3).setValue(email); // Reviewed By
  sheet.getRange(row, 4).setValue(new Date()); // Reviewed At
}
