/**
 * Front-end logic, transport-agnostic: runs unmodified under Electron
 * (using window.outreachApi from preload.js) or in a plain browser
 * tab against app/server.js (fetch + SSE). Whichever is present wins.
 */
(function () {
  const api = window.outreachApi ? buildElectronApi() : buildHttpApi();

  function buildElectronApi() {
    return window.outreachApi;
  }

  function buildHttpApi() {
    const listeners = { log: [], 'job-started': [], 'job-finished': [] };
    const source = new EventSource('/events');
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const list = listeners[payload.type] || [];
      list.forEach((cb) => cb(payload));
    };
    return {
      getStatus: () => fetch('/status').then((r) => r.json()),
      runJob: (name) =>
        fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: name }) }).then((r) => r.json()),
      sendInput: (text) =>
        fetch('/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then((r) => r.json()),
      stopJob: () => fetch('/stop', { method: 'POST' }).then((r) => r.json()),
      openSheet: () =>
        fetch('/status').then((r) => r.json()).then((s) => {
          if (s.sheetId) window.open('https://docs.google.com/spreadsheets/d/' + s.sheetId + '/edit', '_blank');
        }),
      addOutreachRow: (fields) =>
        fetch('/outreach/add-row', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }).then((r) => r.json()),
      refreshValidation: () => fetch('/outreach/refresh-validation', { method: 'POST' }).then((r) => r.json()),
      submitForApproval: () => fetch('/outreach/submit-for-approval', { method: 'POST' }).then((r) => r.json()),
      approveOutreach: () => fetch('/outreach/approve', { method: 'POST' }).then((r) => r.json()),
      listOutreachRows: () => fetch('/outreach/rows').then((r) => r.json()),
      onLog: (cb) => listeners.log.push(cb),
      onJobStarted: (cb) => listeners['job-started'].push(cb),
      onJobFinished: (cb) => listeners['job-finished'].push(cb)
    };
  }

  const logEl = document.getElementById('log');
  const inputBox = document.getElementById('input-box');
  const sendInputBtn = document.getElementById('send-input-btn');
  const stopBtn = document.getElementById('stop-btn');
  const autosendConfirm = document.getElementById('autosend-confirm');
  const autosendBtn = document.getElementById('autosend-btn');

  function appendLog(cls, text) {
    const line = document.createElement('div');
    line.className = 'log-line ' + cls;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setRunningState(isRunning) {
    document.querySelectorAll('.job-btn').forEach((btn) => { btn.disabled = isRunning; });
    if (!isRunning) autosendBtn.disabled = !autosendConfirm.checked;
    inputBox.disabled = !isRunning;
    sendInputBtn.disabled = !isRunning;
    stopBtn.disabled = !isRunning;
  }

  autosendConfirm.addEventListener('change', () => {
    autosendBtn.disabled = !autosendConfirm.checked;
  });

  document.querySelectorAll('.job-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const job = btn.dataset.job;
      const result = await api.runJob(job);
      if (!result.ok) appendLog('system', 'Could not start: ' + result.error);
    });
  });

  stopBtn.addEventListener('click', () => api.stopJob());

  function submitInput() {
    const text = inputBox.value.trim();
    if (!text) return;
    api.sendInput(text);
    inputBox.value = '';
  }
  sendInputBtn.addEventListener('click', submitInput);
  inputBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitInput(); });

  document.getElementById('open-sheet-btn').addEventListener('click', () => api.openSheet());

  api.onLog((payload) => appendLog(payload.stream, payload.text.replace(/\n$/, '')));
  api.onJobStarted((payload) => {
    appendLog('system', '--- started: ' + payload.label + ' ---');
    setRunningState(true);
  });
  api.onJobFinished((payload) => {
    appendLog('system', '--- finished (exit code ' + payload.code + ') ---');
    setRunningState(false);
  });

  function renderFlag(elId, value) {
    const el = document.getElementById(elId);
    el.classList.toggle('on', value);
    el.querySelector('.flag-value').textContent = value ? 'ON' : 'off';
  }

  api.getStatus().then((status) => {
    renderFlag('flag-voice', status.flags.ENABLE_VOICE_AUTOMATION);
    renderFlag('flag-autosend', status.flags.ENABLE_AUTO_SMS_SEND);
    setRunningState(!!status.running);
    if (status.running) appendLog('system', '(a job was already running when this window opened: ' + status.running + ')');
  });

  // --- Outreach Queue: add-row form, workflow buttons, rows table ---
  const CHECKBOX_FIELDS = ['tenantOccupied', 'needsWork', 'appearsRenovated', 'compReviewCompleted'];

  async function refreshOutreachTable() {
    const result = await api.listOutreachRows();
    if (result.ok === false) {
      appendLog('system', 'Could not load Outreach Queue rows: ' + result.error);
      return;
    }
    const tbody = document.querySelector('#outreach-table tbody');
    tbody.innerHTML = '';
    (result.rows || []).forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.row}</td><td>${escapeHtml(r.address)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.agentPhone)}</td><td>${escapeHtml(r.agentEmail)}</td>`;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.getElementById('add-row-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fields = {};
    new FormData(form).forEach((value, key) => { fields[key] = value; });
    CHECKBOX_FIELDS.forEach((key) => { fields[key] = form.elements[key].checked ? 'TRUE' : 'FALSE'; });
    const result = await api.addOutreachRow(fields);
    if (result.ok === false) {
      appendLog('system', 'Add row failed: ' + result.error);
    } else {
      appendLog('system', 'Added row for ' + fields.propertyAddress);
      form.reset();
      refreshOutreachTable();
    }
  });

  function wireOutreachAction(buttonId, apiCall, label) {
    document.getElementById(buttonId).addEventListener('click', async () => {
      const result = await apiCall();
      if (result.ok === false) {
        appendLog('system', label + ' failed: ' + result.error);
        return;
      }
      appendLog('system', label + ': ' + result.results.length + ' row(s) affected.');
      result.results.forEach((r) => {
        const detail = r.reasons ? r.reasons.join(' ') : (r.problems || []).join(' ');
        appendLog('system', '  row ' + r.row + ' (' + r.address + ') -> ' + (r.status || 'Approved') + (detail ? ' -- ' + detail : ''));
      });
      refreshOutreachTable();
    });
  }
  wireOutreachAction('refresh-validation-btn', api.refreshValidation, 'Refresh validation');
  wireOutreachAction('submit-approval-btn', api.submitForApproval, 'Submit for approval');
  wireOutreachAction('approve-btn', api.approveOutreach, 'Approve outreach');

  refreshOutreachTable();
})();
