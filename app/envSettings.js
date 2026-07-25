/**
 * Reads/writes the ENABLE_* live-sending toggles directly in the real
 * .env file -- not process.env. The already-running app process only
 * ever loaded .env once at its own startup, so a write here wouldn't
 * be reflected by re-reading process.env; reading the file fresh each
 * call is what makes a toggle change show up immediately in the app's
 * own status display. Every job script spawns as its own fresh Node
 * process (see jobRunner.js) and loads .env itself at that moment, so
 * a toggle change here takes effect on the very next run of any job --
 * no app restart needed.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./jobRunner');

const ENV_PATH = path.join(ROOT, '.env');

const TOGGLE_KEYS = [
  'ENABLE_EMAIL_SENDING',
  'ENABLE_VOICE_AUTOMATION',
  'ENABLE_AUTO_SMS_SEND',
  'ENABLE_REI_SMS_SEND'
];

function readEnvFileLines() {
  if (!fs.existsSync(ENV_PATH)) return [];
  return fs.readFileSync(ENV_PATH, 'utf8').split('\n');
}

function getToggleSettings() {
  const lines = readEnvFileLines();
  const settings = {};
  TOGGLE_KEYS.forEach((key) => { settings[key] = false; });
  lines.forEach((line) => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && TOGGLE_KEYS.includes(match[1])) {
      settings[match[1]] = match[2].trim().toLowerCase() === 'true';
    }
  });
  return settings;
}

function setToggleSetting(key, value) {
  if (!TOGGLE_KEYS.includes(key)) {
    throw new Error('Unknown setting: ' + key);
  }
  const lines = readEnvFileLines();
  const targetLine = key + '=' + (value ? 'true' : 'false');
  let found = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp('^' + key + '='))) {
      found = true;
      return targetLine;
    }
    return line;
  });
  if (!found) updated.push(targetLine);
  fs.writeFileSync(ENV_PATH, updated.join('\n'));
  return getToggleSettings();
}

const CYCLE_MINUTES_KEY = 'AUTOMATION_CYCLE_MINUTES';
const DEFAULT_CYCLE_MINUTES = 15;

function getCycleIntervalMinutes() {
  const lines = readEnvFileLines();
  for (const line of lines) {
    const match = line.match(new RegExp('^' + CYCLE_MINUTES_KEY + '=(.*)$'));
    if (match) {
      const n = Number(match[1].trim());
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_CYCLE_MINUTES;
    }
  }
  return DEFAULT_CYCLE_MINUTES;
}

function setCycleIntervalMinutes(minutes) {
  const n = Number(minutes);
  const value = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_CYCLE_MINUTES;
  const lines = readEnvFileLines();
  const targetLine = CYCLE_MINUTES_KEY + '=' + value;
  let found = false;
  const updated = lines.map((line) => {
    if (line.match(new RegExp('^' + CYCLE_MINUTES_KEY + '='))) {
      found = true;
      return targetLine;
    }
    return line;
  });
  if (!found) updated.push(targetLine);
  fs.writeFileSync(ENV_PATH, updated.join('\n'));
  return value;
}

module.exports = {
  getToggleSettings,
  setToggleSetting,
  getCycleIntervalMinutes,
  setCycleIntervalMinutes,
  DEFAULT_CYCLE_MINUTES,
  TOGGLE_KEYS
};
