/**
 * Sheet/tab names and column layouts for the outreach layer added on top
 * of the existing Flip Scout Leads sheet. Flip Scout's own tab and
 * columns are never listed or written to here -- only read from, and
 * only the columns named in FLIP_SCOUT_COLUMN_ALIASES below.
 */

var SHEET_NAMES = {
  FLIP_SCOUT_LEADS: 'Flip Scout Leads',
  OUTREACH_QUEUE: 'Outreach Queue',
  MESSAGE_TEMPLATES: 'Message Templates',
  COMMUNICATION_LOG: 'Communication Log',
  SUPPRESSION_LIST: 'Suppression List',
  SETTINGS: 'Settings',
  ERROR_LOG: 'Error Log'
};

// Header label -> camelCase field key, in column order. Using a
// header->key map (rather than fixed column indexes) means reordering
// or inserting a column in the Sheet doesn't silently corrupt reads.
var OUTREACH_QUEUE_COLUMNS = [
  ['Outreach Key', 'outreachKey'],
  ['Contact Key', 'contactKey'],
  ['Property Address', 'propertyAddress'],
  ['City', 'city'],
  ['Agent Name', 'agentName'],
  ['Agent Phone', 'agentPhone'],
  ['Agent Email', 'agentEmail'],
  ['Listing Status', 'listingStatus'],
  ['Days On Market', 'daysOnMarket'],
  ['Tenant Occupied', 'tenantOccupied'],
  ['Needs Work', 'needsWork'],
  ['Appears Renovated', 'appearsRenovated'],
  ['Comp Review Completed', 'compReviewCompleted'],
  ['Offer Date', 'offerDate'],
  ['Disclosures Available', 'disclosuresAvailable'],
  ['Campaign', 'campaign'],
  ['Status', 'status'],
  ['Qualification Reasons', 'qualificationReasons'],
  ['Do Not Automate?', 'doNotAutomate'],
  ['Opted Out?', 'optedOut'],
  ['Flip Scout Row Ref', 'flipScoutRowRef'],
  ['SMS Template Id', 'smsTemplateId'],
  ['Rendered SMS Body', 'renderedSmsBody'],
  ['Email Template Id', 'emailTemplateId'],
  ['Rendered Email Subject', 'renderedEmailSubject'],
  ['Rendered Email Body', 'renderedEmailBody'],
  ['Date Added', 'dateAdded'],
  ['Last Updated', 'lastUpdated']
];

var MESSAGE_TEMPLATES_COLUMNS = [
  ['Template Id', 'id'],
  ['Channel', 'channel'],
  ['Version', 'version'],
  ['Sequence Position', 'sequencePosition'],
  ['Subject', 'subject'],
  ['Body', 'body'],
  ['Required Fields', 'requiredFields'],
  ['Notes', 'notes']
];

var COMMUNICATION_LOG_COLUMNS = [
  ['Timestamp', 'timestamp'],
  ['Outreach Key', 'outreachKey'],
  ['Contact Key', 'contactKey'],
  ['Property Address', 'propertyAddress'],
  ['Agent Name', 'agentName'],
  ['Agent Phone', 'agentPhone'],
  ['Agent Email', 'agentEmail'],
  ['Channel', 'channel'],
  ['Template Id', 'templateId'],
  ['Template Version', 'templateVersion'],
  ['Subject', 'subject'],
  ['Message Body', 'messageBody'],
  ['Sender', 'sender'],
  ['Result', 'result'],
  ['Notes', 'notes']
];

var SUPPRESSION_LIST_COLUMNS = [
  ['Contact Key', 'contactKey'],
  ['Agent Phone', 'agentPhone'],
  ['Agent Name', 'agentName'],
  ['Reason', 'reason'],
  ['Date Added', 'dateAdded'],
  ['Added By', 'addedBy']
];

var SETTINGS_COLUMNS = [
  ['Key', 'key'],
  ['Value', 'value'],
  ['Notes', 'notes']
];

var ERROR_LOG_COLUMNS = [
  ['Timestamp', 'timestamp'],
  ['Function', 'functionName'],
  ['Row Reference', 'rowReference'],
  ['Error Message', 'errorMessage']
];

// Default Settings rows. Live-sending switches default to FALSE and
// must be flipped on deliberately after Phase 10 sign-off.
var DEFAULT_SETTINGS_ROWS = [
  ['Enable Email Sending', 'FALSE', 'Master switch for "Send approved emails". Must stay FALSE until Phase 10 sign-off.'],
  ['Enable Voice Automation', 'FALSE', 'Master switch for the Playwright Google Voice prep script. Even when TRUE, the script still stops before Send.'],
  ['Sender Name', '', ''],
  ['Sender Phone', '', ''],
  ['Sender Email', '', ''],
  ['Handoff Person', '', 'Juan, Cherry, or another team member -- see docs/OPEN_ITEMS.md'],
  ['Company Website', '', ''],
  ['Years In Business', '', 'Verified claim -- see docs/OPEN_ITEMS.md'],
  ['Google Review Link', '', 'Verified link -- see docs/OPEN_ITEMS.md'],
  ['Max Days On Market', '45', ''],
  ['Follow-Up Interval Days (1st)', '', 'See docs/OPEN_ITEMS.md'],
  ['Follow-Up Interval Days (2nd)', '', 'See docs/OPEN_ITEMS.md'],
  ['Max Follow-Ups', '2', '']
];

// Best-effort header aliases used to read Flip Scout Leads without
// requiring Bryan's sheet to change. Add aliases here if his column
// names differ; never write to Flip Scout Leads.
var FLIP_SCOUT_COLUMN_ALIASES = {
  propertyAddress: ['Address', 'Property Address', 'Street Address'],
  city: ['City'],
  agentName: ['Agent Name', 'Listing Agent'],
  agentPhone: ['Agent Phone', 'Listing Agent Phone'],
  agentEmail: ['Agent Email', 'Listing Agent Email'],
  listingStatus: ['Status', 'Listing Status'],
  daysOnMarket: ['DOM', 'Days On Market'],
  offerDate: ['Offer Date', 'Offer Due Date']
};
