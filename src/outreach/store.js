/**
 * Local, file-backed data store for the Outreach Queue, Communication
 * Log, and Suppression List -- replaces the Google Sheet tabs of the
 * same names. Flip Scout Leads stays in the Sheet (Bryan's, untouched,
 * read-only from here); everything outreach-related now lives in
 * data/ next to this repo/app install, since the app is the single
 * point of control for it.
 *
 * Plain JSON files, atomic writes (write to .tmp, then rename) so a
 * crash mid-write can't corrupt a file. No database dependency to
 * install -- this is a small, single-operator dataset.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.OUTREACH_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const QUEUE_PATH = path.join(DATA_DIR, 'outreach-queue.json');
const LOG_PATH = path.join(DATA_DIR, 'communication-log.json');
const SUPPRESSION_PATH = path.join(DATA_DIR, 'suppression-list.json');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readArray(filePath) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw ? JSON.parse(raw) : [];
}

function writeArray(filePath, arr) {
  ensureDataDir();
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, filePath);
}

// --- Outreach Queue ---------------------------------------------------

function getQueueRows(filterFn) {
  const rows = readArray(QUEUE_PATH);
  return filterFn ? rows.filter(filterFn) : rows;
}

function appendQueueRow(fields) {
  const rows = readArray(QUEUE_PATH);
  const row = { id: crypto.randomUUID(), ...fields };
  rows.push(row);
  writeArray(QUEUE_PATH, rows);
  return row;
}

function updateQueueRow(id, fields) {
  const rows = readArray(QUEUE_PATH);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error('No Outreach Queue row with id ' + id);
  rows[idx] = { ...rows[idx], ...fields };
  writeArray(QUEUE_PATH, rows);
  return rows[idx];
}

// --- Communication Log (human-approved sends AND auto-sends, --------
// distinguished by the `autoSent` field, since everything's local now
// there's no need for two separate log files) -------------------------

function getCommunicationLog() {
  return readArray(LOG_PATH);
}

function appendCommunicationLog(entry) {
  const log = readArray(LOG_PATH);
  const row = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry };
  log.push(row);
  writeArray(LOG_PATH, log);
  return row;
}

// --- Suppression List ---------------------------------------------------

function getSuppressionList() {
  return readArray(SUPPRESSION_PATH);
}

function addSuppression(entry) {
  const list = readArray(SUPPRESSION_PATH);
  const row = { id: crypto.randomUUID(), dateAdded: new Date().toISOString(), ...entry };
  list.push(row);
  writeArray(SUPPRESSION_PATH, list);
  return row;
}

module.exports = {
  DATA_DIR,
  getQueueRows,
  appendQueueRow,
  updateQueueRow,
  getCommunicationLog,
  appendCommunicationLog,
  getSuppressionList,
  addSuppression
};
