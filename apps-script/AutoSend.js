/**
 * Auto-send email path: skips the manual "Submit for approval" /
 * "Approve outreach" clicks and sends as soon as a row qualifies.
 *
 * This exists because it was explicitly requested (2026-07-23) as a
 * deliberate change from the plan's Phase 5/6, which required a human
 * approval click before the first email or text. See
 * docs/AUTO_MODE_RISKS.md for what that trade-off means.
 *
 * What is NOT skipped, because these were never "approval" -- they are
 * data-integrity/compliance checks that must never be bypassed:
 *   - fresh Phase 3 qualification (evaluateQualification)
 *   - Suppression List check
 *   - Do Not Automate check
 *   - missing-merge-field check on the rendered email
 *   - the "Enable Email Sending" master switch (still defaults FALSE)
 */
function autoSendEligibleOutreach() {
  return runGuarded_('autoSendEligibleOutreach', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    var autoLogSheet = ss.getSheetByName(SHEET_NAMES.AUTO_OUTREACH_LOG);
    var suppressionSheet = ss.getSheetByName(SHEET_NAMES.SUPPRESSION_LIST);
    if (!outreachSheet || !autoLogSheet) throw new Error('Run "Set up outreach tabs" first.');

    var settings = getSettings_();
    var sendingEnabled = isTruthySetting_(settings['Enable Email Sending']);
    var suppressionList = suppressionSheet ? readSheetAsObjects_(suppressionSheet, SUPPRESSION_LIST_COLUMNS) : [];
    var mergeBase = {
      senderName: settings['Sender Name'],
      senderPhone: settings['Sender Phone'],
      senderEmail: settings['Sender Email'],
      handoffPerson: settings['Handoff Person'],
      companyWebsite: settings['Company Website'],
      yearsInBusiness: settings['Years In Business'],
      googleReviewLink: settings['Google Review Link']
    };

    var rows = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS);
    var allOutreachKeys = rows.map(function (row) { return row.outreachKey; });
    var eligibleRows = rows.filter(function (row) {
      return TERMINAL_STATUSES.indexOf(row.status) === -1 && row.agentEmail;
    });

    var sent = 0;
    var heldBack = 0;

    eligibleRows.forEach(function (row) {
      var duplicateCount = allOutreachKeys.filter(function (k) { return k === row.outreachKey; }).length;
      var lead = {
        listingStatus: row.listingStatus,
        daysOnMarket: row.daysOnMarket,
        tenantOccupied: coerceBoolean_(row.tenantOccupied),
        needsWork: coerceBoolean_(row.needsWork),
        appearsRenovated: coerceBoolean_(row.appearsRenovated),
        compReviewCompleted: coerceBoolean_(row.compReviewCompleted),
        agentName: row.agentName,
        agentPhone: row.agentPhone,
        agentEmail: row.agentEmail,
        isDuplicate: duplicateCount > 1,
        isSuppressed: isSuppressed(row.agentPhone, suppressionList),
        doNotAutomate: coerceBoolean_(row.doNotAutomate)
      };

      var qualification = evaluateQualification(lead);
      if (qualification.status !== QUALIFICATION_STATUS.READY) {
        writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
          status: qualification.status,
          qualificationReasons: qualification.reasons.join(' '),
          lastUpdated: new Date()
        });
        heldBack++;
        return;
      }

      var mergeData = Object.assign({}, mergeBase, {
        agentFirstName: firstName_(row.agentName),
        propertyAddress: row.propertyAddress,
        city: row.city
      });

      var rendered;
      try {
        rendered = renderTemplate(TEMPLATES['initial-email'], mergeData);
      } catch (e) {
        writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
          status: 'Needs Review',
          qualificationReasons: 'Email: ' + e.message,
          lastUpdated: new Date()
        });
        heldBack++;
        return;
      }

      var logRow = [
        new Date(), row.outreachKey, row.propertyAddress, row.agentName, row.agentPhone,
        row.agentEmail, row.redfinLink, 'Email', 'initial-email.v' + TEMPLATES['initial-email'].version,
        rendered.subject, rendered.body, '', ''
      ];

      if (sendingEnabled) {
        GmailApp.sendEmail(row.agentEmail, rendered.subject, rendered.body, {
          name: settings['Sender Name'],
          replyTo: settings['Sender Email']
        });
        logRow[11] = 'Sent';
        writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
          status: 'Contacted',
          emailTemplateId: 'initial-email.v' + TEMPLATES['initial-email'].version,
          renderedEmailSubject: rendered.subject,
          renderedEmailBody: rendered.body,
          lastUpdated: new Date()
        });
        sent++;
      } else {
        logRow[11] = 'Dry Run';
        logRow[12] = 'Enable Email Sending is FALSE -- no message was actually sent.';
        heldBack++;
      }
      autoLogSheet.appendRow(logRow);
    });

    var summary = sendingEnabled
      ? 'Auto-sent ' + sent + ' email(s). Held back ' + heldBack + ' (see Outreach Queue / Auto Outreach Log).'
      : 'Email sending is OFF (Settings > Enable Email Sending). Logged ' + (sent + heldBack) + ' dry run(s)/held-back row(s).';
    SpreadsheetApp.getUi().alert(summary);
  });
}
