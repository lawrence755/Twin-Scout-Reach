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

module.exports = { OUTREACH_QUEUE_SHEET_NAME, OUTREACH_QUEUE_HEADERS };
