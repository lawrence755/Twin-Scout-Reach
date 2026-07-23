/**
 * Renderer runs with contextIsolation on and nodeIntegration off (no
 * direct filesystem/child_process access from the page) -- this is
 * the only bridge, and it exposes nothing beyond the specific job
 * actions the control panel needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('outreachApi', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  runJob: (name) => ipcRenderer.invoke('run-job', name),
  sendInput: (text) => ipcRenderer.invoke('send-input', text),
  stopJob: () => ipcRenderer.invoke('stop-job'),
  openSheet: () => ipcRenderer.invoke('open-sheet'),
  onLog: (cb) => ipcRenderer.on('log', (_event, payload) => cb(payload)),
  onJobStarted: (cb) => ipcRenderer.on('job-started', (_event, payload) => cb(payload)),
  onJobFinished: (cb) => ipcRenderer.on('job-finished', (_event, payload) => cb(payload))
});
