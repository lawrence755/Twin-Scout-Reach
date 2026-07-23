/**
 * The four queue-moving menu actions. Each is wrapped in runGuarded_
 * so a thrown error lands in the Error Log tab instead of failing
 * silently. None of these ever write to the Flip Scout Leads tab.
 */

var PRE_APPROVAL_STATUSES = ['Information Needed', 'Needs Review', 'Ready for Drafting'];

function addSelectedFlipScoutRows() {
  return runGuarded_('addSelectedFlipScoutRows', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var flipScoutSheet = ss.getSheetByName(SHEET_NAMES.FLIP_SCOUT_LEADS);
    if (!flipScoutSheet) {
      throw new Error('Could not find the "' + SHEET_NAMES.FLIP_SCOUT_LEADS + '" tab.');
    }
    var selection = flipScoutSheet.getActiveRange();
    if (!selection || selection.getSheet().getSheetId() !== flipScoutSheet.getSheetId()) {
      throw new Error('Select one or more rows on the Flip Scout Leads tab first.');
    }

    var headerRow = flipScoutSheet.getRange(1, 1, 1, flipScoutSheet.getLastColumn()).getValues()[0];
    var aliasIndex = buildFlipScoutAliasIndex_(headerRow);

    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    if (!outreachSheet) throw new Error('Run "Set up outreach tabs" first.');
    var existingOutreachKeys = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS)
      .map(function (row) { return row.outreachKey; })
      .filter(Boolean);

    var startRow = selection.getRow();
    var numRows = selection.getNumRows();
    var added = 0;
    var skipped = 0;

    for (var r = startRow; r < startRow + numRows; r++) {
      if (r === 1) continue; // never pull the header row
      var rawRow = flipScoutSheet.getRange(r, 1, 1, flipScoutSheet.getLastColumn()).getValues()[0];
      if (rawRow.join('') === '') continue;

      var lead = mapFlipScoutRow_(rawRow, aliasIndex);
      var campaign = 'flip-scout';
      var outreachKey = buildOutreachKey(lead.agentPhone, lead.propertyAddress, campaign);
      var contactKey = buildContactKey(lead.agentPhone);

      if (outreachKey && existingOutreachKeys.indexOf(outreachKey) !== -1) {
        skipped++;
        continue;
      }

      var now = new Date();
      outreachSheet.appendRow([
        outreachKey,
        contactKey,
        lead.propertyAddress,
        lead.city,
        lead.agentName,
        lead.agentPhone,
        lead.agentEmail,
        lead.listingStatus,
        lead.daysOnMarket,
        '', // Tenant Occupied -- not on Flip Scout Leads, verified manually (Phase 3)
        '', // Needs Work -- verified manually
        '', // Appears Renovated -- verified manually
        '', // Comp Review Completed -- verified manually
        lead.offerDate,
        '', // Disclosures Available -- verified manually
        campaign,
        'Information Needed',
        'Added from Flip Scout Leads row ' + r + '. Complete manual verification fields, then Refresh Validation.',
        false,
        false,
        SHEET_NAMES.FLIP_SCOUT_LEADS + '!' + r,
        '', '', '', '', '',
        now,
        now
      ]);
      if (outreachKey) existingOutreachKeys.push(outreachKey);
      added++;
    }

    SpreadsheetApp.getUi().alert('Added ' + added + ' row(s) to Outreach Queue. Skipped ' + skipped + ' duplicate(s).');
  });
}

function buildFlipScoutAliasIndex_(headerRow) {
  var index = {};
  Object.keys(FLIP_SCOUT_COLUMN_ALIASES).forEach(function (key) {
    var aliases = FLIP_SCOUT_COLUMN_ALIASES[key];
    for (var i = 0; i < aliases.length; i++) {
      var col = headerRow.indexOf(aliases[i]);
      if (col !== -1) { index[key] = col; break; }
    }
  });
  return index;
}

function mapFlipScoutRow_(rawRow, aliasIndex) {
  var lead = {};
  Object.keys(FLIP_SCOUT_COLUMN_ALIASES).forEach(function (key) {
    var col = aliasIndex[key];
    lead[key] = col === undefined ? '' : rawRow[col];
  });
  return lead;
}

/**
 * Re-checks Phase 3 qualification rules for every row still earlier
 * than "Pending Approval". Rows already in or past Pending Approval
 * are left alone -- a human is already reviewing rendered content by
 * that point, and validation should not silently move the goalposts
 * on them.
 */
function refreshValidation() {
  return runGuarded_('refreshValidation', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    if (!outreachSheet) throw new Error('Run "Set up outreach tabs" first.');
    var suppressionSheet = ss.getSheetByName(SHEET_NAMES.SUPPRESSION_LIST);

    var rows = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS);
    var suppressionList = suppressionSheet ? readSheetAsObjects_(suppressionSheet, SUPPRESSION_LIST_COLUMNS) : [];
    var allOutreachKeys = rows.map(function (row) { return row.outreachKey; });

    var updated = 0;
    rows.forEach(function (row) {
      if (PRE_APPROVAL_STATUSES.indexOf(row.status) === -1) return;

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

      var result = evaluateQualification(lead);
      var targetStatus = qualificationStatusToRowStatus_(result.status);
      var nextStatus = canTransition(row.status, targetStatus) ? targetStatus : row.status;

      writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
        status: nextStatus,
        qualificationReasons: result.reasons.join(' '),
        lastUpdated: new Date()
      });
      updated++;
    });

    SpreadsheetApp.getUi().alert('Refreshed validation on ' + updated + ' row(s).');
  });
}

function qualificationStatusToRowStatus_(qualificationStatus) {
  // QUALIFICATION_STATUS.READY ("Ready for Drafting") already matches
  // the row status vocabulary; this mapping exists so the two enums
  // (qualification outcomes vs. full row status flow) can diverge
  // later without a silent string-matching bug.
  return qualificationStatus;
}

/**
 * Renders the initial SMS/email templates for every selected row that
 * is "Ready for Drafting" and moves it to "Pending Approval". A row
 * that's missing a merge field is left in place with the reason
 * recorded, instead of being submitted half-rendered.
 */
function submitForApproval() {
  return runGuarded_('submitForApproval', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    if (!outreachSheet) throw new Error('Run "Set up outreach tabs" first.');

    var selectedRowNumbers = getSelectedRowNumbers_(outreachSheet);
    var settings = getSettings_();
    var mergeBase = {
      senderName: settings['Sender Name'],
      senderPhone: settings['Sender Phone'],
      senderEmail: settings['Sender Email'],
      handoffPerson: settings['Handoff Person'],
      companyWebsite: settings['Company Website'],
      yearsInBusiness: settings['Years In Business'],
      googleReviewLink: settings['Google Review Link']
    };

    var rows = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS)
      .filter(function (row) { return selectedRowNumbers.indexOf(row.__rowNumber) !== -1; });

    var submitted = 0;
    var heldBack = 0;

    rows.forEach(function (row) {
      if (row.status !== 'Ready for Drafting') { heldBack++; return; }

      var mergeData = Object.assign({}, mergeBase, {
        agentFirstName: firstName_(row.agentName),
        propertyAddress: row.propertyAddress,
        city: row.city
      });

      var fields = { lastUpdated: new Date() };
      var problems = [];

      try {
        var sms = renderTemplate(TEMPLATES['initial-sms'], mergeData);
        fields.smsTemplateId = 'initial-sms.v' + TEMPLATES['initial-sms'].version;
        fields.renderedSmsBody = sms.body;
      } catch (e) {
        problems.push('SMS: ' + e.message);
      }

      if (row.agentEmail) {
        try {
          var email = renderTemplate(TEMPLATES['initial-email'], mergeData);
          fields.emailTemplateId = 'initial-email.v' + TEMPLATES['initial-email'].version;
          fields.renderedEmailSubject = email.subject;
          fields.renderedEmailBody = email.body;
        } catch (e) {
          problems.push('Email: ' + e.message);
        }
      }

      if (problems.length > 0) {
        fields.status = 'Needs Review';
        fields.qualificationReasons = problems.join(' ');
        heldBack++;
      } else {
        fields.status = 'Pending Approval';
        submitted++;
      }
      writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, fields);
    });

    SpreadsheetApp.getUi().alert('Submitted ' + submitted + ' row(s) for approval. Held back ' + heldBack + ' row(s) -- see Qualification Reasons / select rows that are "Ready for Drafting".');
  });
}

/**
 * Human approval gate: moves selected "Pending Approval" rows to
 * "Approved". This is the one manual click required before anything
 * can be sent (Phase 5).
 */
function approveOutreach() {
  return runGuarded_('approveOutreach', '', function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var outreachSheet = ss.getSheetByName(SHEET_NAMES.OUTREACH_QUEUE);
    if (!outreachSheet) throw new Error('Run "Set up outreach tabs" first.');

    var selectedRowNumbers = getSelectedRowNumbers_(outreachSheet);
    var rows = readSheetAsObjects_(outreachSheet, OUTREACH_QUEUE_COLUMNS)
      .filter(function (row) { return selectedRowNumbers.indexOf(row.__rowNumber) !== -1; });

    var approved = 0;
    rows.forEach(function (row) {
      if (!canTransition(row.status, 'Approved')) return;
      writeObjectFields_(outreachSheet, OUTREACH_QUEUE_COLUMNS, row.__rowNumber, {
        status: 'Approved',
        lastUpdated: new Date()
      });
      approved++;
    });

    SpreadsheetApp.getUi().alert('Approved ' + approved + ' row(s). Select rows that are "Pending Approval" to approve them.');
  });
}

function getSelectedRowNumbers_(sheet) {
  var selection = sheet.getActiveRangeList() || (sheet.getActiveRange() ? { getRanges: function () { return [sheet.getActiveRange()]; } } : null);
  if (!selection) return [];
  var rowNumbers = [];
  selection.getRanges().forEach(function (range) {
    for (var r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) {
      if (r !== 1) rowNumbers.push(r);
    }
  });
  return rowNumbers;
}

function firstName_(fullName) {
  if (!fullName) return '';
  return String(fullName).trim().split(/\s+/)[0];
}
