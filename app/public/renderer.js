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
    const listeners = { log: [], 'job-started': [], 'job-finished': [], 'automation-status': [] };
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
      sendApprovedEmails: () => fetch('/outreach/send-emails', { method: 'POST' }).then((r) => r.json()),
      checkReplies: () => fetch('/outreach/check-replies', { method: 'POST' }).then((r) => r.json()),
      getOutreachReviewSummary: () => fetch('/outreach/review-summary').then((r) => r.json()),
      listOutreachRows: () => fetch('/outreach/rows').then((r) => r.json()),
      getOutreachRow: (id) => fetch('/outreach/row/' + encodeURIComponent(id)).then((r) => r.json()),
      updateOutreachRow: (id, fields) =>
        fetch('/outreach/update-row', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, fields }) }).then((r) => r.json()),
      listFlipScoutLeads: () => fetch('/outreach/flip-scout-leads').then((r) => r.json()),
      addFromFlipScout: (sheetRows, campaign) =>
        fetch('/outreach/add-from-flip-scout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheetRows, campaign }) }).then((r) => r.json()),
      lookupRedfinAgentContact: (address) =>
        fetch('/outreach/redfin-agent-contact?address=' + encodeURIComponent(address)).then((r) => r.json()),
      getSettings: () => fetch('/settings').then((r) => r.json()),
      setSetting: (key, value) =>
        fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) }).then((r) => r.json()),
      getCycleInterval: () => fetch('/status').then((r) => r.json()).then((s) => s.automation.cycleIntervalMinutes),
      setCycleInterval: (minutes) =>
        fetch('/settings/cycle-interval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }) }).then((r) => r.json()),
      startAutomation: () => fetch('/automation/start', { method: 'POST' }).then((r) => r.json()),
      pauseAutomation: () => fetch('/automation/pause', { method: 'POST' }).then((r) => r.json()),
      resumeAutomation: () => fetch('/automation/resume', { method: 'POST' }).then((r) => r.json()),
      stopAutomation: () => fetch('/automation/stop', { method: 'POST' }).then((r) => r.json()),
      onLog: (cb) => listeners.log.push(cb),
      onJobStarted: (cb) => listeners['job-started'].push(cb),
      onJobFinished: (cb) => listeners['job-finished'].push(cb),
      onAutomationStatus: (cb) => listeners['automation-status'].push(cb)
    };
  }

  // --- Tabs ---
  function activateTab(name) {
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.toggle('active', pane.id === 'tab-' + name));
  }
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
  document.querySelectorAll('[data-goto-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.gotoTab));
  });

  const logEl = document.getElementById('log');
  const inputBox = document.getElementById('input-box');
  const sendInputBtn = document.getElementById('send-input-btn');
  const stopBtn = document.getElementById('stop-btn');
  const autosendConfirm = document.getElementById('autosend-confirm');
  const autosendBtn = document.getElementById('autosend-btn');
  const reiAutosendConfirm = document.getElementById('rei-autosend-confirm');
  const reiAutosendBtn = document.getElementById('rei-autosend-btn');

  function appendLog(cls, text) {
    const line = document.createElement('div');
    line.className = 'log-line ' + cls;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  let lastKnownRunning = false;
  let automationActive = false; // true whenever the loop is 'running' or 'paused' -- not 'stopped'

  function setRunningState(isRunning) {
    lastKnownRunning = isRunning;
    // One-shot job buttons stay disabled while either a single job is
    // running OR the automation loop owns job execution (running/paused)
    // -- avoids a manual click racing with the loop's own next step.
    const blocked = isRunning || automationActive;
    document.querySelectorAll('.job-btn').forEach((btn) => { btn.disabled = blocked; });
    if (!blocked) {
      autosendBtn.disabled = !autosendConfirm.checked;
      reiAutosendBtn.disabled = !reiAutosendConfirm.checked;
    }
    inputBox.disabled = !isRunning;
    sendInputBtn.disabled = !isRunning;
    stopBtn.disabled = !isRunning;
  }

  autosendConfirm.addEventListener('change', () => {
    autosendBtn.disabled = !autosendConfirm.checked;
  });
  reiAutosendConfirm.addEventListener('change', () => {
    reiAutosendBtn.disabled = !reiAutosendConfirm.checked;
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
  const openSheetBtn2 = document.getElementById('open-sheet-btn-2');
  if (openSheetBtn2) openSheetBtn2.addEventListener('click', () => api.openSheet());

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

  function updateGoogleVoiceVisibility(enabled) {
    document.getElementById('google-voice-section').style.display = enabled ? '' : 'none';
    document.getElementById('google-voice-hidden-note').style.display = enabled ? 'none' : '';
  }

  function refreshHeaderFlags() {
    api.getStatus().then((status) => {
      renderFlag('flag-voice', status.flags.ENABLE_VOICE_AUTOMATION);
      renderFlag('flag-autosend', status.flags.ENABLE_AUTO_SMS_SEND);
      updateGoogleVoiceVisibility(status.flags.ENABLE_VOICE_AUTOMATION);
    });
  }

  // --- Continuous Automation Loop ---
  const automationStatusEl = document.getElementById('automation-loop-status');
  const automationStartBtn = document.getElementById('automation-start-btn');
  const automationPauseResumeBtn = document.getElementById('automation-pause-resume-btn');
  const automationStopBtn = document.getElementById('automation-stop-btn');
  const cycleIntervalInput = document.getElementById('cycle-interval-input');

  function renderAutomationStatus(automation) {
    automationActive = automation.state !== 'stopped';
    if (automation.state === 'stopped') {
      automationStatusEl.textContent = 'Stopped';
      automationStartBtn.disabled = false;
      automationPauseResumeBtn.disabled = true;
      automationPauseResumeBtn.textContent = 'Pause';
      automationStopBtn.disabled = true;
    } else if (automation.state === 'running') {
      automationStatusEl.textContent = 'Running -- cycle ' + automation.cycleCount +
        (automation.currentStep ? ', current step: ' + automation.currentStep : '');
      automationStartBtn.disabled = true;
      automationPauseResumeBtn.disabled = false;
      automationPauseResumeBtn.textContent = 'Pause';
      automationStopBtn.disabled = false;
    } else if (automation.state === 'paused') {
      automationStatusEl.textContent = 'Paused' + (automation.currentStep ? ' after: ' + automation.currentStep : '');
      automationStartBtn.disabled = true;
      automationPauseResumeBtn.disabled = false;
      automationPauseResumeBtn.textContent = 'Resume';
      automationStopBtn.disabled = false;
    } else if (automation.state === 'stopping') {
      automationStatusEl.textContent = 'Stopping -- finishing: ' + (automation.currentStep || '(current step)');
      automationStartBtn.disabled = true;
      automationPauseResumeBtn.disabled = true;
      automationStopBtn.disabled = true;
    }
    // Re-derive one-shot job button disabled state now that automationActive may have changed.
    setRunningState(lastKnownRunning);
  }

  automationStartBtn.addEventListener('click', async () => {
    const result = await api.startAutomation();
    if (result.ok === false) appendLog('system', 'Could not start automation loop: ' + result.error);
  });
  automationPauseResumeBtn.addEventListener('click', async () => {
    const result = automationPauseResumeBtn.textContent === 'Pause' ? await api.pauseAutomation() : await api.resumeAutomation();
    if (result.ok === false) appendLog('system', 'Automation loop action failed: ' + result.error);
  });
  automationStopBtn.addEventListener('click', async () => {
    const result = await api.stopAutomation();
    if (result.ok === false) appendLog('system', 'Could not stop automation loop: ' + result.error);
  });
  cycleIntervalInput.addEventListener('change', async () => {
    const minutes = Number(cycleIntervalInput.value) || 15;
    const result = await api.setCycleInterval(minutes);
    if (result.ok === false) appendLog('system', 'Could not update cycle interval: ' + result.error);
    else appendLog('system', 'Automation cycle interval set to ' + (result.minutes || minutes) + ' minute(s).');
  });
  api.onAutomationStatus((payload) => renderAutomationStatus(payload));

  api.getStatus().then((status) => {
    renderFlag('flag-voice', status.flags.ENABLE_VOICE_AUTOMATION);
    renderFlag('flag-autosend', status.flags.ENABLE_AUTO_SMS_SEND);
    updateGoogleVoiceVisibility(status.flags.ENABLE_VOICE_AUTOMATION);
    renderAutomationStatus(status.automation);
    cycleIntervalInput.value = status.automation.cycleIntervalMinutes;
    setRunningState(!!status.running);
    if (status.running) appendLog('system', '(a job was already running when this window opened: ' + status.running + ')');
  });

  // --- Settings: live-sending toggles, written straight to .env ---
  document.querySelectorAll('#settings-toggle-list .toggle-row').forEach((row) => {
    const key = row.dataset.key;
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      const result = await api.setSetting(key, checkbox.checked);
      checkbox.disabled = false;
      if (result.ok === false) {
        appendLog('system', 'Failed to update ' + key + ': ' + result.error);
        checkbox.checked = !checkbox.checked;
        return;
      }
      appendLog('system', key + ' set to ' + (checkbox.checked ? 'true' : 'false') + '.');
      refreshHeaderFlags();
    });
  });

  api.getSettings().then((settings) => {
    document.querySelectorAll('#settings-toggle-list .toggle-row').forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = !!settings[row.dataset.key];
    });
  });

  // --- Dashboard: read-only monitor of the working rows ---
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function decisionClass(label) {
    const l = String(label).toLowerCase();
    if (l === 'yes') return 'status-good';
    if (l.startsWith('no')) return 'status-bad';
    if (l.includes('awaiting')) return 'status-warn';
    return 'status-neutral';
  }
  function decisionBadge(label) {
    return `<span class="status-badge ${decisionClass(label)}">${escapeHtml(label)}</span>`;
  }

  function renderDashboard(summary) {
    const counts = {
      total: summary.total || 0,
      awaitingReview: summary.awaitingReview || 0,
      ready: summary.ready || 0,
      notReady: summary.notReady || 0,
      missingPhone: summary.missingPhone || 0
    };
    Object.keys(counts).forEach((key) => {
      const card = document.querySelector(`.stat-card[data-stat="${key}"] .stat-value`);
      if (card) card.textContent = counts[key];
    });
    const breakdown = document.getElementById('status-breakdown');
    const entries = Object.entries(summary.byDecision || {});
    breakdown.innerHTML = entries.length
      ? entries.sort((a, b) => b[1] - a[1])
          .map(([label, count]) => `<span class="status-chip">${decisionBadge(label)}<span class="count">${count}</span></span>`)
          .join('')
      : '<span class="muted-tag">No leads in the Outreach Review tab yet.</span>';
  }
  document.getElementById('refresh-dashboard-btn').addEventListener('click', refreshDashboard);

  async function refreshDashboard() {
    const result = await api.getOutreachReviewSummary();
    if (result.ok === false) {
      appendLog('system', 'Could not load the Outreach Review summary: ' + result.error);
      return;
    }
    renderDashboard(result.summary || { total: 0, byDecision: {} });
  }

  refreshDashboard();

  // --- Flip Scout Leads: browse + select rows to pull into the queue ---
  const FLIP_QUALITY_CLASS = {
    'Good Flip': 'flip-quality-good',
    'Flip W/ Caution': 'flip-quality-caution',
    'Thin Flip': 'flip-quality-thin'
  };

  function flipQualityBadge(quality) {
    if (!quality) return '';
    const cls = FLIP_QUALITY_CLASS[quality] || '';
    return `<span class="flip-quality-badge ${cls}">${escapeHtml(quality)}</span>`;
  }

  let allFlipScoutLeads = [];

  function renderFlipScoutRows() {
    const goodOnly = document.getElementById('good-flip-only-filter').checked;
    const leads = goodOnly ? allFlipScoutLeads.filter((l) => l.isGoodFlip) : allFlipScoutLeads;
    const tbody = document.querySelector('#flip-scout-table tbody');
    tbody.innerHTML = '';
    leads.forEach((l) => {
      const tr = document.createElement('tr');
      const linkCell = l.redfinLink ? `<a href="${escapeHtml(l.redfinLink)}" target="_blank" rel="noopener">link</a>` : '';
      tr.innerHTML = `<td>${escapeHtml(l.score)}</td><td>${escapeHtml(l.recommendation)}</td><td>${flipQualityBadge(l.flipQuality)}</td><td>${escapeHtml(l.address)}</td><td>${escapeHtml(l.city)}</td><td>${escapeHtml(l.arv)}</td><td>${escapeHtml(l.grossProfitLight)}</td><td>${linkCell}</td>`;
      tbody.appendChild(tr);
    });
    appendLog('system', 'Showing ' + leads.length + ' of ' + allFlipScoutLeads.length + ' Flip Scout lead(s)' + (goodOnly ? ' (Good Flip only).' : '.'));
  }

  async function refreshFlipScoutTable() {
    const result = await api.listFlipScoutLeads();
    if (result.ok === false) {
      appendLog('system', 'Could not load Flip Scout Leads: ' + result.error);
      return;
    }
    allFlipScoutLeads = result.leads || [];
    renderFlipScoutRows();
  }

  document.getElementById('load-flip-scout-btn').addEventListener('click', refreshFlipScoutTable);
  document.getElementById('good-flip-only-filter').addEventListener('change', renderFlipScoutRows);
})();
