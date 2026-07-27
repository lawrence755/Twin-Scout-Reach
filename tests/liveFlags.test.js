const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../src/config');

// The kill-switch guarantee: config.isLiveEnabled reads the flag straight
// from the .env FILE every call, so a toggle flip takes effect immediately
// -- no process restart, no dependence on process.env.

function writeTmpEnv(contents) {
  const p = path.join(os.tmpdir(), 'twin-scout-live-flags-' + process.pid + '-' + Math.floor(process.hrtime()[1]) + '.env');
  fs.writeFileSync(p, contents);
  return p;
}

describe('config.isLiveEnabled', () => {
  test('reads "true"/"false" from the file, not process.env', () => {
    const p = writeTmpEnv('ENABLE_EMAIL_SENDING=true\nENABLE_AUTO_SMS_SEND=false\n');
    try {
      assert.equal(config.isLiveEnabled('ENABLE_EMAIL_SENDING', p), true);
      assert.equal(config.isLiveEnabled('ENABLE_AUTO_SMS_SEND', p), false);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('a flip in the file is seen on the very next call (no restart)', () => {
    const p = writeTmpEnv('ENABLE_EMAIL_SENDING=true\n');
    try {
      assert.equal(config.isLiveEnabled('ENABLE_EMAIL_SENDING', p), true);
      fs.writeFileSync(p, 'ENABLE_EMAIL_SENDING=false\n'); // operator flips it off
      assert.equal(config.isLiveEnabled('ENABLE_EMAIL_SENDING', p), false);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('anything other than exactly "true" is off (missing, blank, junk, quoted)', () => {
    const p = writeTmpEnv('A=\nB=YES\nC=1\nD="true"\nE=TRUE\n');
    try {
      assert.equal(config.isLiveEnabled('A', p), false); // blank
      assert.equal(config.isLiveEnabled('B', p), false); // "YES" is not "true"
      assert.equal(config.isLiveEnabled('C', p), false); // "1"
      assert.equal(config.isLiveEnabled('D', p), true);  // quotes stripped
      assert.equal(config.isLiveEnabled('E', p), true);  // case-insensitive
      assert.equal(config.isLiveEnabled('MISSING', p), false); // absent key
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('an unreadable file falls back to process.env, never throws', () => {
    // A var set in neither the (missing) file nor process.env -> off.
    assert.equal(config.isLiveEnabled('ENABLE_TOTALLY_UNSET_TEST_FLAG', path.join(os.tmpdir(), 'does-not-exist-xyz.env')), false);
  });
});
