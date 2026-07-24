/**
 * Node-side mirror of the "Outreach Queue" header labels from
 * apps-script/SheetConstants.js. Only the columns sheetsClient.js
 * actually needs (Status, Qualification Reasons, and everything read
 * for the Google Voice step) have to stay in sync; keep this list a
 * superset of apps-script/SheetConstants.js OUTREACH_QUEUE_COLUMNS.
 */
const OUTREACH_QUEUE_SHEET_NAME = 'Outreach Queue';

const OUTREACH_QUEUE_HEADERS = {
  'Outreach Key': 'outreachKey',
  'Contact Key': 'contactKey',
  'Property Address': 'propertyAddress',
  'City': 'city',
  'Agent Name': 'agentName',
  'Agent Phone': 'agentPhone',
  'Agent Email': 'agentEmail',
  'Listing Status': 'listingStatus',
  'Days On Market': 'daysOnMarket',
  'Tenant Occupied': 'tenantOccupied',
  'Needs Work': 'needsWork',
  'Appears Renovated': 'appearsRenovated',
  'Comp Review Completed': 'compReviewCompleted',
  'Offer Date': 'offerDate',
  'Disclosures Available': 'disclosuresAvailable',
  'Campaign': 'campaign',
  'Redfin Link': 'redfinLink',
  'Status': 'status',
  'Qualification Reasons': 'qualificationReasons',
  'Do Not Automate?': 'doNotAutomate',
  'Opted Out?': 'optedOut',
  'Flip Scout Row Ref': 'flipScoutRowRef',
  'SMS Template Id': 'smsTemplateId',
  'Rendered SMS Body': 'renderedSmsBody',
  'Email Template Id': 'emailTemplateId',
  'Rendered Email Subject': 'renderedEmailSubject',
  'Rendered Email Body': 'renderedEmailBody',
  'Date Added': 'dateAdded',
  'Last Updated': 'lastUpdated'
};

const AUTO_OUTREACH_LOG_SHEET_NAME = 'Auto Outreach Log';

// Column order Node writes in when appending -- must match
// apps-script/SheetConstants.js AUTO_OUTREACH_LOG_COLUMNS exactly,
// since both sides append to the same tab.
const AUTO_OUTREACH_LOG_COLUMN_ORDER = [
  'timestamp',
  'outreachKey',
  'propertyAddress',
  'agentName',
  'agentPhone',
  'agentEmail',
  'redfinLink',
  'channel',
  'templateId',
  'subject',
  'messageBody',
  'result',
  'notes'
];

const SUPPRESSION_LIST_SHEET_NAME = 'Suppression List';
const SUPPRESSION_LIST_HEADERS = {
  'Contact Key': 'contactKey',
  'Agent Phone': 'agentPhone',
  'Agent Name': 'agentName',
  'Reason': 'reason',
  'Date Added': 'dateAdded',
  'Added By': 'addedBy'
};

const SETTINGS_SHEET_NAME = 'Settings';

const COMMUNICATION_LOG_SHEET_NAME = 'Communication Log';
// Column order Node writes in when appending -- must match
// apps-script/SheetConstants.js COMMUNICATION_LOG_COLUMNS exactly,
// since both sides append to the same tab.
const COMMUNICATION_LOG_COLUMN_ORDER = [
  'timestamp',
  'outreachKey',
  'contactKey',
  'propertyAddress',
  'agentName',
  'agentPhone',
  'agentEmail',
  'channel',
  'templateId',
  'templateVersion',
  'subject',
  'messageBody',
  'sender',
  'result',
  'notes'
];

module.exports = {
  OUTREACH_QUEUE_SHEET_NAME,
  OUTREACH_QUEUE_HEADERS,
  AUTO_OUTREACH_LOG_SHEET_NAME,
  AUTO_OUTREACH_LOG_COLUMN_ORDER,
  SUPPRESSION_LIST_SHEET_NAME,
  SUPPRESSION_LIST_HEADERS,
  SETTINGS_SHEET_NAME,
  COMMUNICATION_LOG_SHEET_NAME,
  COMMUNICATION_LOG_COLUMN_ORDER
};
