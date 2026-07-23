/**
 * Electron main process: one native window loading app/public/index.html,
 * with the job-running logic (jobRunner.js -- shared with the browser-
 * tab fallback in server.js) driven over IPC instead of HTTP.
 */
const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { JobRunner, readEnvFlags } = require('./jobRunner');

const runner = new JobRunner();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
