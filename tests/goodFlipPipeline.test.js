const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  PIPELINE_STATUS, NON_RETRYABLE, isGoodFlip, buildSendKey, chooseChannel, decideOutreach
} = require('../src/outreach/goodFlipPipeline');

const GOOD_CONTACT = { agentName: 'Jane Smith', agentPhone: '408-555-1234', agentEmail: 'jane@x.com' };
const LEAD = { propertyAddress: '100 Palm Avenue \n', flipQuality: 'Good Flip' };
const SEND_ON = { email: true, sms: true };
const SEND_OFF = { email: false, sms: false };

function ctx(over) {
  return Object.assign({ sendingEnabled: SEND_ON, sentKeys: new Set(), suppressionList: [], stage: 'initial' }, over || {});
}

describe('isGoodFlip / buildSendKey', () => {
  test('isGoodFlip only true for Yes / Good Flip', () => {
    assert.equal(isGoodFlip('Yes'), true);
    assert.equal(isGoodFlip('Good Flip'), true);
    assert.equal(isGoodFlip('No'), false);
    assert.equal(isGoodFlip(''), false);
    assert.equal(isGoodFlip(undefined), false);
  });

  test('buildSendKey is stable across address/recipient formatting', () => {
    const a = buildSendKey('100 Palm Avenue\n', 'JANE@X.COM ', 'email', 'initial');
    const b = buildSendKey('100 palm ave', 'jane@x.com', 'email', 'initial');
    assert.equal(a, b);
    assert.ok(a.startsWith('send|'));
  });
});

describe('decideOutreach', () => {
  test('Scenario: Good Flip = Yes with a valid feed contact -> send', () => {
    const plan = decideOutreach(LEAD, { feed: GOOD_CONTACT }, ctx());
    assert.equal(plan.action, 'send');
    assert.equal(plan.status, PIPELINE_STATUS.SENDING);
    assert.equal(plan.channel, 'email');
    assert.equal(plan.source, 'Feed');
  });

  test('Scenario: no feed but REI contact -> send, source REI', () => {
    const plan = decideOutreach(LEAD, { feed: null, rei: GOOD_CONTACT }, ctx());
    assert.equal(plan.action, 'send');
    assert.equal(plan.source, 'REI BlackBook');
  });

  test('Scenario: only MLS has it -> send, source MLS', () => {
    const plan = decideOutreach(LEAD, { mls: GOOD_CONTACT }, ctx());
    assert.equal(plan.source, 'MLS');
  });

  test('Good Flip = No does not send', () => {
    const plan = decideOutreach({ ...LEAD, flipQuality: 'No' }, { feed: GOOD_CONTACT }, ctx());
    assert.equal(plan.action, 'skip');
  });

  test('Good Flip blank does not send', () => {
    const plan = decideOutreach({ ...LEAD, flipQuality: '' }, { feed: GOOD_CONTACT }, ctx());
    assert.equal(plan.action, 'skip');
  });

  test('missing/invalid address -> Invalid Data (recoverable)', () => {
    const plan = decideOutreach({ flipQuality: 'Yes', propertyAddress: '  \n ' }, { feed: GOOD_CONTACT }, ctx());
    assert.equal(plan.status, PIPELINE_STATUS.INVALID_DATA);
  });

  test('no contact anywhere -> MLS Assisted Research (recoverable), not rejected', () => {
    const plan = decideOutreach(LEAD, {}, ctx());
    assert.equal(plan.action, 'assisted-research');
    assert.equal(plan.status, PIPELINE_STATUS.MLS_ASSISTED_RESEARCH);
  });

  test('URL-like name with a valid phone still sends by SMS (name dropped, greeting "there")', () => {
    const plan = decideOutreach(LEAD, { feed: { agentName: 'https://x.com/1', agentPhone: '4085551234' } }, ctx());
    assert.equal(plan.action, 'send');
    assert.equal(plan.channel, 'sms');
    assert.equal(plan.contact.agentFirstName, 'there');
    assert.equal(plan.contact.agentName, '');
  });

  test('invalid email + invalid phone -> assisted research, never sends', () => {
    const plan = decideOutreach(LEAD, { feed: { agentName: 'Bob', agentEmail: 'bogus', agentPhone: '12' } }, ctx());
    assert.equal(plan.action, 'assisted-research');
  });

  test('duplicate send is prevented', () => {
    const key = buildSendKey('100 Palm Avenue', 'jane@x.com', 'email', 'initial');
    const plan = decideOutreach(LEAD, { feed: GOOD_CONTACT }, ctx({ sentKeys: new Set([key]) }));
    assert.equal(plan.action, 'duplicate');
    assert.equal(plan.status, PIPELINE_STATUS.DUPLICATE_PREVENTED);
  });

  test('kill switch (sending off) -> Ready to Send, nothing sent', () => {
    const plan = decideOutreach(LEAD, { feed: GOOD_CONTACT }, ctx({ sendingEnabled: SEND_OFF }));
    assert.equal(plan.action, 'blocked-killswitch');
    assert.equal(plan.status, PIPELINE_STATUS.READY_TO_SEND);
  });

  test('suppressed agent is blocked, not sent', () => {
    const plan = decideOutreach(LEAD, { feed: GOOD_CONTACT }, ctx({ suppressionList: [{ agentPhone: '4085551234' }] }));
    assert.equal(plan.action, 'suppressed');
  });

  test('corrected lead re-enters: assisted-research first, then send once contact is valid', () => {
    const before = decideOutreach(LEAD, {}, ctx());
    assert.equal(before.action, 'assisted-research');
    const after = decideOutreach(LEAD, { enrichment: GOOD_CONTACT }, ctx());
    assert.equal(after.action, 'send'); // re-enters and proceeds
  });

  test('Send Failed is retryable (not in NON_RETRYABLE)', () => {
    assert.ok(!NON_RETRYABLE.includes(PIPELINE_STATUS.SEND_FAILED));
    assert.ok(NON_RETRYABLE.includes(PIPELINE_STATUS.SENT));
    assert.ok(NON_RETRYABLE.includes(PIPELINE_STATUS.DUPLICATE_PREVENTED));
  });
});
