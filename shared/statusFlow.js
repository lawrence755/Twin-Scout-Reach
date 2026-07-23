/**
 * Phase 5 status flow state machine.
 *
 * See shared/keys.js for the dual Node.js / Apps Script pattern used
 * throughout shared/.
 */

var MAIN_FLOW = [
  'Information Needed',
  'Ready for Drafting',
  'Pending Approval',
  'Approved',
  'Contacted',
  'Follow-Up Due',
  'Replied',
  'Handed Off'
];

var EXCEPTION_STATUSES = [
  'Needs Review',
  'Duplicate',
  'Rejected',
  'Not Interested',
  'Opted Out',
  'Do Not Automate',
  'Failed Contact'
];

var ALL_STATUSES = MAIN_FLOW.concat(EXCEPTION_STATUSES);

// Terminal statuses never transition onward automatically; a human must
// manually re-open a record (e.g. move it back to "Needs Review") if a
// mistake was made.
var TERMINAL_STATUSES = [
  'Handed Off',
  'Duplicate',
  'Rejected',
  'Not Interested',
  'Opted Out',
  'Do Not Automate'
];

// Map of allowed forward transitions. Any status may also move to one
// of ALWAYS_ALLOWED_TARGETS below (agent opts out, gets rejected, etc.)
// regardless of where it currently sits in the flow.
var ALLOWED_TRANSITIONS = {
  'Information Needed': ['Ready for Drafting', 'Needs Review'],
  'Ready for Drafting': ['Pending Approval'],
  'Pending Approval': ['Approved', 'Ready for Drafting'],
  'Approved': ['Contacted'],
  'Contacted': ['Follow-Up Due', 'Replied', 'Failed Contact'],
  'Follow-Up Due': ['Contacted', 'Replied', 'Failed Contact'],
  'Replied': ['Handed Off', 'Not Interested'],
  'Handed Off': [],
  'Needs Review': ['Ready for Drafting', 'Rejected'],
  'Duplicate': [],
  'Rejected': [],
  'Not Interested': [],
  'Opted Out': [],
  'Do Not Automate': [],
  'Failed Contact': ['Follow-Up Due', 'Rejected']
};

var ALWAYS_ALLOWED_TARGETS = ['Opted Out', 'Do Not Automate', 'Rejected', 'Not Interested'];

function isValidStatus(status) {
  return ALL_STATUSES.indexOf(status) !== -1;
}

function isTerminal(status) {
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}

function canTransition(fromStatus, toStatus) {
  if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) return false;
  if (fromStatus === toStatus) return false;
  if (isTerminal(fromStatus)) return false;
  if (ALWAYS_ALLOWED_TARGETS.indexOf(toStatus) !== -1) return true;
  var allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  return allowed.indexOf(toStatus) !== -1;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAIN_FLOW: MAIN_FLOW,
    EXCEPTION_STATUSES: EXCEPTION_STATUSES,
    ALL_STATUSES: ALL_STATUSES,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    ALWAYS_ALLOWED_TARGETS: ALWAYS_ALLOWED_TARGETS,
    isValidStatus: isValidStatus,
    isTerminal: isTerminal,
    canTransition: canTransition
  };
}
