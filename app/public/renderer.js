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

  // --- Outreach Queue: add-row form, workflow buttons, rows table ---
  const CHECKBOX_FIELDS = ['tenantOccupied', 'needsWork', 'appearsRenovated', 'compReviewCompleted'];
  const addRowForm = document.getElementById('add-row-form');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STATUS_CLASS = {
    'Information Needed': 'status-neutral',
    'Ready for Drafting': 'status-info',
    'Pending Approval': 'status-info',
    'Needs Review': 'status-warn',
    'Approved': 'status-info',
    'Contacted': 'status-warn',
    'Follow-Up Due': 'status-warn',
    'Replied': 'status-info',
    'Handed Off': 'status-good',
    'Opted Out': 'status-bad',
    'Rejected': 'status-bad',
    'Not Interested': 'status-bad',
    'Do Not Automate': 'status-bad',
    'Duplicate': 'status-neutral',
    'Failed Contact': 'status-bad'
  };
  function statusBadge(status) {
    if (!status) return '';
    return `<span class="status-badge ${STATUS_CLASS[status] || 'status-neutral'}">${escapeHtml(status)}</span>`;
  }

  const NEEDS_ACTION_STATUSES = ['Information Needed', 'Ready for Drafting', 'Pending Approval', 'Needs Review'];
  const IN_PROGRESS_STATUSES = ['Approved', 'Contacted', 'Follow-Up Due', 'Replied'];
  const CLOSED_OUT_STATUSES = ['Opted Out', 'Rejected', 'Not Interested', 'Do Not Automate', 'Duplicate', 'Failed Contact'];

  function renderDashboard(rows) {
    const counts = { total: rows.length, needsAction: 0, inProgress: 0, handedOff: 0, closedOut: 0 };
    const byStatus = {};
    rows.forEach((r) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (NEEDS_ACTION_STATUSES.includes(r.status)) counts.needsAction++;
      else if (IN_PROGRESS_STATUSES.includes(r.status)) counts.inProgress++;
      else if (r.status === 'Handed Off') counts.handedOff++;
      else if (CLOSED_OUT_STATUSES.includes(r.status)) counts.closedOut++;
    });
    Object.keys(counts).forEach((key) => {
      const card = document.querySelector(`.stat-card[data-stat="${key}"] .stat-value`);
      if (card) card.textContent = counts[key];
    });
    const breakdown = document.getElementById('status-breakdown');
    breakdown.innerHTML = Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `<span class="status-chip">${statusBadge(status)}<span class="count">${count}</span></span>`)
      .join('') || '<span class="muted-tag">No rows yet.</span>';
  }
  document.getElementById('refresh-dashboard-btn').addEventListener('click', refreshOutreachTable);

  async function refreshOutreachTable() {
    const result = await api.listOutreachRows();
    if (result.ok === false) {
      appendLog('system', 'Could not load Outreach Queue rows: ' + result.error);
      return;
    }
    const rows = result.rows || [];
    renderDashboard(rows);
    const tbody = document.querySelector('#outreach-table tbody');
    tbody.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.dataset.id = r.id;
      tr.title = 'Click to edit this row';
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(r.address)}</td><td>${statusBadge(r.status)}</td><td>${escapeHtml(r.agentPhone)}</td><td>${escapeHtml(r.agentEmail)}</td>`;
      tr.addEventListener('click', () => loadRowIntoForm(r.id));
      tbody.appendChild(tr);
    });
  }

  async function loadRowIntoForm(id) {
    const result = await api.getOutreachRow(id);
    if (result.ok === false || !result.row) {
      appendLog('system', 'Could not load row: ' + (result.error || 'not found'));
      return;
    }
    const row = result.row;
    addRowForm.elements.editingId.value = id;
    ['propertyAddress', 'city', 'agentName', 'agentPhone', 'agentEmail', 'listingStatus', 'daysOnMarket', 'campaign'].forEach((key) => {
      if (addRowForm.elements[key]) addRowForm.elements[key].value = row[key] || '';
    });
    CHECKBOX_FIELDS.forEach((key) => {
      if (addRowForm.elements[key]) addRowForm.elements[key].checked = String(row[key]).toUpperCase() === 'TRUE';
    });
    document.getElementById('add-row-btn').textContent = 'Save changes';
    cancelEditBtn.style.display = '';
    appendLog('system', 'Editing row: ' + row.propertyAddress);
  }

  function resetForm() {
    addRowForm.reset();
    addRowForm.elements.editingId.value = '';
    document.getElementById('add-row-btn').textContent = 'Add Row';
    cancelEditBtn.style.display = 'none';
  }
  cancelEditBtn.addEventListener('click', resetForm);

  addRowForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fields = {};
    new FormData(form).forEach((value, key) => { if (key !== 'editingId') fields[key] = value; });
    CHECKBOX_FIELDS.forEach((key) => { fields[key] = form.elements[key].checked ? 'TRUE' : 'FALSE'; });

    const editingId = form.elements.editingId.value;
    const result = editingId ? await api.updateOutreachRow(editingId, fields) : await api.addOutreachRow(fields);
    if (result.ok === false) {
      appendLog('system', (editingId ? 'Update' : 'Add') + ' row failed: ' + result.error);
    } else {
      appendLog('system', (editingId ? 'Updated' : 'Added') + ' row for ' + fields.propertyAddress);
      resetForm();
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
        appendLog('system', '  ' + r.address + ' -> ' + (r.status || 'Approved') + (detail ? ' -- ' + detail : ''));
      });
      refreshOutreachTable();
    });
  }
  wireOutreachAction('refresh-validation-btn', api.refreshValidation, 'Refresh validation');
  wireOutreachAction('submit-approval-btn', api.submitForApproval, 'Submit for approval');
  wireOutreachAction('approve-btn', api.approveOutreach, 'Approve outreach');

  document.getElementById('send-emails-btn').addEventListener('click', async () => {
    const result = await api.sendApprovedEmails();
    if (result.ok === false) {
      appendLog('system', 'Send approved emails failed: ' + result.error);
      return;
    }
    appendLog('system', 'Send approved emails (sending ' + (result.sendingEnabled ? 'ON' : 'OFF, dry run') + '): ' + result.results.length + ' row(s).');
    result.results.forEach((r) => {
      appendLog('system', '  ' + r.address + ' -> ' + r.result + (r.notes ? ' -- ' + r.notes : ''));
    });
    refreshOutreachTable();
  });

  document.getElementById('check-replies-btn').addEventListener('click', async () => {
    const result = await api.checkReplies();
    if (result.ok === false) {
      appendLog('system', 'Check for replies failed: ' + result.error);
      return;
    }
    appendLog('system', 'Check for replies: ' + result.results.length + ' row(s) checked.');
    result.results.forEach((r) => {
      appendLog('system', '  ' + r.address + ' -> ' + r.result + (r.replyText ? ' -- reply: "' + r.replyText + '"' : ''));
      if (r.notifyError) appendLog('system', '    Google Chat notification failed: ' + r.notifyError);
    });
    refreshOutreachTable();
  });

  refreshOutreachTable();

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
      tr.innerHTML = `<td><input type="checkbox" data-sheet-row="${l.sheetRow}" /></td><td>${escapeHtml(l.score)}</td><td>${escapeHtml(l.recommendation)}</td><td>${flipQualityBadge(l.flipQuality)}</td><td>${escapeHtml(l.address)}</td><td>${escapeHtml(l.city)}</td><td>${escapeHtml(l.arv)}</td><td>${escapeHtml(l.grossProfitLight)}</td><td>${linkCell}</td>`;
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

  document.getElementById('select-all-good-flip-btn').addEventListener('click', () => {
    const boxes = Array.from(document.querySelectorAll('#flip-scout-table input[type="checkbox"]'));
    let count = 0;
    boxes.forEach((cb) => {
      const lead = allFlipScoutLeads.find((l) => String(l.sheetRow) === cb.dataset.sheetRow);
      const isGood = lead && lead.isGoodFlip;
      cb.checked = isGood;
      if (isGood) count++;
    });
    appendLog('system', 'Selected ' + count + ' Good Flip lead(s).');
  });

  document.getElementById('add-selected-flip-scout-btn').addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('#flip-scout-table input[type="checkbox"]:checked'));
    const sheetRows = checked.map((cb) => Number(cb.dataset.sheetRow));
    if (sheetRows.length === 0) {
      appendLog('system', 'Select at least one Flip Scout lead first.');
      return;
    }
    const campaign = document.getElementById('flip-scout-campaign').value || 'flip-scout';
    const result = await api.addFromFlipScout(sheetRows, campaign);
    if (result.ok === false) {
      appendLog('system', 'Add from Flip Scout failed: ' + result.error);
      return;
    }
    appendLog('system', 'Added ' + result.added + ' row(s) to Outreach Queue. Skipped ' + result.skipped.length + ' duplicate(s).');
    refreshOutreachTable();
  });
})();
