/**
 * Phase 3 property/agent verification and qualification rules.
 *
 * See shared/keys.js for a note on why this file avoids require/import
 * and uses the module.exports-guard pattern instead (shared between
 * Node.js and Google Apps Script).
 */

var QUALIFICATION_STATUS = {
  READY: 'Ready for Drafting',
  NEEDS_REVIEW: 'Needs Review',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate'
};

var MAX_DAYS_ON_MARKET = 45;

/**
 * lead shape (from Outreach Queue row):
 * {
 *   listingStatus, daysOnMarket, tenantOccupied, needsWork, appearsRenovated,
 *   compReviewCompleted, offerDate, disclosuresAvailable,
 *   agentName, agentPhone, agentEmail,
 *   isDuplicate, isSuppressed, doNotAutomate
 * }
 *
 * Returns { status, reasons } where reasons explains every Needs Review /
 * Rejected finding (never silent).
 */
function evaluateQualification(lead) {
  lead = lead || {};
  var rejectedReasons = [];
  var reviewReasons = [];

  if (lead.doNotAutomate === true) {
    rejectedReasons.push('Marked Do Not Automate.');
  }
  if (lead.isSuppressed === true) {
    rejectedReasons.push('Agent contact is on the Suppression List.');
  }
  if (lead.isDuplicate === true) {
    return { status: QUALIFICATION_STATUS.DUPLICATE, reasons: ['Outreach key already exists in the queue/log.'] };
  }

  // Listing status
  if (lead.listingStatus === undefined || lead.listingStatus === null || lead.listingStatus === '') {
    reviewReasons.push('Listing status is missing.');
  } else if (String(lead.listingStatus).toLowerCase() !== 'active') {
    rejectedReasons.push('Listing status is not Active (' + lead.listingStatus + ').');
  }

  // Days on market
  if (lead.daysOnMarket === undefined || lead.daysOnMarket === null || lead.daysOnMarket === '') {
    reviewReasons.push('Days on market is missing.');
  } else if (Number(lead.daysOnMarket) > MAX_DAYS_ON_MARKET) {
    rejectedReasons.push('Days on market (' + lead.daysOnMarket + ') exceeds the ' + MAX_DAYS_ON_MARKET + '-day limit.');
  }

  // Occupancy
  if (lead.tenantOccupied === undefined || lead.tenantOccupied === null || lead.tenantOccupied === '') {
    reviewReasons.push('Occupancy status is missing.');
  } else if (lead.tenantOccupied === true) {
    rejectedReasons.push('Property is tenant occupied.');
  }

  // Needs work / already renovated
  if (lead.needsWork === undefined || lead.needsWork === null || lead.needsWork === '') {
    reviewReasons.push('Property condition (needs work) is missing.');
  } else if (lead.needsWork === false) {
    rejectedReasons.push('Property does not need work.');
  }
  if (lead.appearsRenovated === true) {
    rejectedReasons.push('Property already appears renovated.');
  }

  // Comparable-sales review
  if (lead.compReviewCompleted === undefined || lead.compReviewCompleted === null || lead.compReviewCompleted === '') {
    reviewReasons.push('One-mile comp review has not been recorded.');
  } else if (lead.compReviewCompleted !== true) {
    reviewReasons.push('One-mile comp review is not complete.');
  }

  // Agent contact info
  if (!lead.agentName) {
    reviewReasons.push('Agent name is missing.');
  }
  if (!lead.agentPhone) {
    reviewReasons.push('Verified agent phone is missing.');
  }
  // Agent email is "verified, when available" -- absence alone is not a
  // blocker, outreach can be SMS-first. No rule added here on purpose.

  if (rejectedReasons.length > 0) {
    return { status: QUALIFICATION_STATUS.REJECTED, reasons: rejectedReasons };
  }
  if (reviewReasons.length > 0) {
    return { status: QUALIFICATION_STATUS.NEEDS_REVIEW, reasons: reviewReasons };
  }
  return { status: QUALIFICATION_STATUS.READY, reasons: [] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    QUALIFICATION_STATUS: QUALIFICATION_STATUS,
    MAX_DAYS_ON_MARKET: MAX_DAYS_ON_MARKET,
    evaluateQualification: evaluateQualification
  };
}
