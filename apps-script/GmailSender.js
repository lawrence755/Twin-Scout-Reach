/**
 * Phase 6 Gmail send. Guarded by the "Enable Email Sending" Settings
 * switch, which defaults to FALSE (see SheetConstants.js
 * DEFAULT_SETTINGS_ROWS). While it's FALSE, this still runs every
 * check and writes a "Dry Run" row to the Communication Log, so the
 * whole pipeline can be exercised end-to-end with sending switched
 * off (Phase 10, step 1).
 */
function sendApprovedEmails() {
  return runGuarded_('sendApprovedEmails', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    var logSheet = ss.getSheetByName(SHEET_NAMES.COMMUNICATION_LOG);
    var suppressionSheet = ss.getSheetByName(SHEET_NAMES.SUPPRESSION_LIST);
    if (!outreachSheet || !logSheet) throw new Error('Run "Set up outreach tabs" first.');

    var settings = getSettings_();
    var sendingEnabled = isTruthySetting_(settings['Enable Email Sending']);
    var suppressionList = suppressionSheet ? readSheetAsObjects_(suppressionSheet, SUPPRESSION_LIST_COLUMNS) : [];

    var rows = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS)
      .filter(function (row) { return row.status === 'Approved' && row.agentEmail && row.renderedEmailBody; });

    var sent = 0;
    var skipped = 0;

    rows.forEach(function (row) {
      var problems = [];

      if (coerceBoolean_(row.doNotAutomate)) problems.push('Do Not Automate is set.');
      if (isSuppressed(row.agentPhone, suppressionList)) problems.push('Agent is on the Suppression List.');
      if (extractMergeFields(row.renderedEmailSubject).length > 0 || extractMergeFields(row.renderedEmailBody).length > 0) {
        problems.push('Rendered email still has unresolved merge fields.');
      }

      if (problems.length > 0) {
        writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
          status: 'Needs Review',
          qualificationReasons: problems.join(' '),
          lastUpdated: new Date()
        });
        appendCommunicationLog_(logSheet, row, settings, 'Blocked', problems.join(' '));
        skipped++;
        return;
      }

      if (sendingEnabled) {
        GmailApp.sendEmail(row.agentEmail, row.renderedEmailSubject, row.renderedEmailBody, {
          name: settings['Sender Name'],
          replyTo: settings['Sender Email']
        });
        appendCommunicationLog_(logSheet, row, settings, 'Sent', '');
        writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
          status: 'Contacted',
          lastUpdated: new Date()
        });
        sent++;
      } else {
        appendCommunicationLog_(logSheet, row, settings, 'Dry Run', 'Enable Email Sending is FALSE -- no message was actually sent.');
        skipped++;
      }
    });

    var summary = sendingEnabled
      ? 'Sent ' + sent + ' email(s). Skipped ' + skipped + ' (see Communication Log).'
      : 'Email sending is OFF (Settings > Enable Email Sending). Logged ' + (sent + skipped) + ' dry run(s) -- no messages were sent.';
    SpreadsheetApp.getUi().alert(summary);
  });
}

function appendCommunicationLog_(logSheet, row, settings, result, notes) {
  logSheet.appendRow([
    new Date(),
    row.outreachKey,
    row.contactKey,
    row.propertyAddress,
    row.agentName,
    row.agentPhone,
    row.agentEmail,
    'email',
    row.emailTemplateId,
    row.emailTemplateId,
    row.renderedEmailSubject,
    row.renderedEmailBody,
    settings['Sender Email'],
    result,
    notes
  ]);
}
