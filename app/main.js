/**
 * Electron main process: one native window loading app/public/index.html,
 * with the job-running logic (jobRunner.js -- shared with the browser-
 * tab fallback in server.js) driven over IPC instead of HTTP.
 */
const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { JobRunner, readEnvFlags } = require('./jobRunner');
const outreachActions = require('../src/outreach/actions');

const runner = new JobRunner();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    title: 'Twin Home Buyer Outreach Control Panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

runner.on('job-started', (p) => sendToRenderer('job-started', p));
runner.on('job-finished', (p) => sendToRenderer('job-finished', p));
runner.on('log', (p) => sendToRenderer('log', p));

ipcMain.handle('get-status', () => ({
  running: runner.isRunning(),
  jobs: runner.listJobs(),
  flags: readEnvFlags(),
  sheetId: process.env.GOOGLE_SHEET_ID || ''
}));

ipcMain.handle('run-job', (_event, name) => {
  try {
    runner.start(name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('send-input', (_event, text) => {
  try {
    runner.sendInput(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stop-job', () => {
  runner.stop();
  return { ok: true };
});

ipcMain.handle('open-sheet', () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (id) shell.openExternal('https://docs.google.com/spreadsheets/d/' + id + '/edit');
});

ipcMain.handle('outreach:add-row', async (_event, fields) => {
  try {
    await outreachActions.addRow(fields);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:update-row', async (_event, { id, fields }) => {
  try {
    await outreachActions.updateRow(id, fields);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:list-flip-scout-leads', async () => {
  try {
    return { ok: true, leads: await outreachActions.listFlipScoutLeads() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:add-from-flip-scout', async (_event, { sheetRows, campaign }) => {
  try {
    const { added, skipped } = await outreachActions.addFromFlipScout(sheetRows, campaign);
    return { ok: true, added: added.length, skipped };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:refresh-validation', async () => {
  try {
    return { ok: true, results: await outreachActions.refreshValidation() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:submit-for-approval', async () => {
  try {
    return { ok: true, results: await outreachActions.submitForApproval() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:approve', async () => {
  try {
    return { ok: true, results: await outreachActions.approveOutreach() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:send-emails', async () => {
  try {
    const { sendingEnabled, results } = await outreachActions.sendApprovedEmails();
    return { ok: true, sendingEnabled, results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:check-replies', async () => {
  try {
    return { ok: true, results: await outreachActions.checkReplies() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:list-rows', async () => {
  try {
    return { ok: true, rows: await outreachActions.listRows() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('outreach:get-row', async (_event, id) => {
  try {
    return { ok: true, row: outreachActions.getRow(id) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
