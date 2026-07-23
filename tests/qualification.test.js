const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { QUALIFICATION_STATUS, evaluateQualification } = require('../shared/qualification');

const BASE_LEAD = {
  listingStatus: 'Active',
  daysOnMarket: 12,
  tenantOccupied: false,
  needsWork: true,
  appearsRenovated: false,
  compReviewCompleted: true,
  agentName: 'Maria Chen',
  agentPhone: '510-555-0142',
  agentEmail: 'maria@example.com'
};

describe('evaluateQualification', () => {
  test('a fully verified, in-bounds lead is Ready for Drafting', () => {
    const result = evaluateQualification(BASE_LEAD);
    assert.equal(result.status, QUALIFICATION_STATUS.READY);
    assert.deepEqual(result.reasons, []);
  });

  test('missing fields produce Needs Review, not Rejected', () => {
    const result = evaluateQualification({
      ...BASE_LEAD,
      compReviewCompleted: '',
      agentPhone: ''
    });
    assert.equal(result.status, QUALIFICATION_STATUS.NEEDS_REVIEW);
    assert.ok(result.reasons.some((r) => /comp review/i.test(r)));
    assert.ok(result.reasons.some((r) => /agent phone/i.test(r)));
  });

  test('over the days-on-market limit is Rejected', () => {
    const result = evaluateQualification({ ...BASE_LEAD, daysOnMarket: 46 });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
    assert.ok(result.reasons.some((r) => /days on market/i.test(r)));
  });

  test('exactly at the days-on-market limit is not rejected on that basis', () => {
    const result = evaluateQualification({ ...BASE_LEAD, daysOnMarket: 45 });
    assert.notEqual(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('tenant occupied is Rejected', () => {
    const result = evaluateQualification({ ...BASE_LEAD, tenantOccupied: true });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('a property that does not need work is Rejected', () => {
    const result = evaluateQualification({ ...BASE_LEAD, needsWork: false });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('a property that already appears renovated is Rejected', () => {
    const result = evaluateQualification({ ...BASE_LEAD, appearsRenovated: true });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('Do Not Automate overrides everything else', () => {
    const result = evaluateQualification({ ...BASE_LEAD, doNotAutomate: true });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('a suppressed contact is Rejected even if otherwise qualified', () => {
    const result = evaluateQualification({ ...BASE_LEAD, isSuppressed: true });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('a duplicate outreach key short-circuits to Duplicate', () => {
    const result = evaluateQualification({ ...BASE_LEAD, isDuplicate: true });
    assert.equal(result.status, QUALIFICATION_STATUS.DUPLICATE);
  });

  test('rejection reasons take priority over review reasons when both are present', () => {
    const result = evaluateQualification({
      ...BASE_LEAD,
      tenantOccupied: true, // confirmed disqualifier
      compReviewCompleted: '' // missing info
    });
    assert.equal(result.status, QUALIFICATION_STATUS.REJECTED);
  });

  test('a missing agent email alone does not block qualification (SMS-first)', () => {
    const result = evaluateQualification({ ...BASE_LEAD, agentEmail: '' });
    assert.equal(result.status, QUALIFICATION_STATUS.READY);
  });
});
