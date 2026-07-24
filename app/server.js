#!/usr/bin/env node
/**
 * Browser-tab control panel (fallback / dev mode). The primary
 * deliverable is the Electron app (main.js) -- this is the same
 * front end and jobRunner.js, just reached over local HTTP+SSE
 * instead of Electron IPC, for running without packaging.
 *
 * Zero extra npm dependencies. Binds to 127.0.0.1 only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JobRunner, readEnvFlags } = require('./jobRunner');
const outreachActions = require('../src/outreach/actions');

const PORT = Number(process.env.APP_PORT || 4747);
const runner = new JobRunner();
const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

runner.on('job-started', (p) => broadcast({ type: 'job-started', ...p }));
runner.on('job-finished', (p) => broadcast({ type: 'job-finished', ...p }));
runner.on('log', (p) => broadcast({ type: 'log', ...p }));

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function getStatus() {
  return {
    running: runner.isRunning(),
    jobs: runner.listJobs(),
    flags: readEnvFlags(),
    sheetId: process.env.GOOGLE_SHEET_ID || ''
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/renderer.js' || url.pathname === '/styles.css')) {
    const filePath = path.join(__dirname, 'public', url.pathname);
    const type = url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(filePath));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStatus()));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/run') {
    try {
      const body = await readJsonBody(req);
      runner.start(body.job);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/input') {
    try {
      const body = await readJsonBody(req);
      runner.sendInput(body.text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    runner.stop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const outreachRoutes = {
    '/outreach/add-row': (body) => outreachActions.addRow(body).then(() => ({})),
    '/outreach/update-row': (body) => outreachActions.updateRow(body.id, body.fields).then(() => ({})),
    '/outreach/refresh-validation': () => outreachActions.refreshValidation().then((results) => ({ results })),
    '/outreach/submit-for-approval': () => outreachActions.submitForApproval().then((results) => ({ results })),
    '/outreach/approve': () => outreachActions.approveOutreach().then((results) => ({ results })),
    '/outreach/send-emails': () => outreachActions.sendApprovedEmails().then(({ sendingEnabled, results }) => ({ sendingEnabled, results })),
    '/outreach/add-from-flip-scout': (body) =>
      outreachActions.addFromFlipScout(body.sheetRows, body.campaign).then(({ added, skipped }) => ({ added: added.length, skipped }))
  };
  if (req.method === 'POST' && outreachRoutes[url.pathname]) {
    try {
      const body = await readJsonBody(req);
      const payload = await outreachRoutes[url.pathname](body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...payload }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/outreach/rows') {
    try {
      const rows = await outreachActions.listRows();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rows }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/outreach/flip-scout-leads') {
    try {
      const leads = await outreachActions.listFlipScoutLeads();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, leads }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/outreach/row/')) {
    try {
      const id = url.pathname.slice('/outreach/row/'.length);
      const row = outreachActions.getRow(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, row }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Outreach control panel running at http://127.0.0.1:' + PORT);
});
