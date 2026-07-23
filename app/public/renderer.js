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
})();
