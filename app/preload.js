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
  addOutreachRow: (fields) => ipcRenderer.invoke('outreach:add-row', fields),
  refreshValidation: () => ipcRenderer.invoke('outreach:refresh-validation'),
  submitForApproval: () => ipcRenderer.invoke('outreach:submit-for-approval'),
  approveOutreach: () => ipcRenderer.invoke('outreach:approve'),
  sendApprovedEmails: () => ipcRenderer.invoke('outreach:send-emails'),
  listOutreachRows: () => ipcRenderer.invoke('outreach:list-rows'),
  onLog: (cb) => ipcRenderer.on('log', (_event, payload) => cb(payload)),
  onJobStarted: (cb) => ipcRenderer.on('job-started', (_event, payload) => cb(payload)),
  onJobFinished: (cb) => ipcRenderer.on('job-finished', (_event, payload) => cb(payload))
});
