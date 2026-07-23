#!/usr/bin/env node
/**
 * Local control-panel app: a graphical (browser-based) front end for
 * the Node scripts that otherwise need a terminal (Redfin enrichment,
 * Google Voice prep/auto-send). Runs each script as an unmodified
 * child process and streams its output to the page; the "type sent /
 * skip / reject" prompt those scripts print becomes buttons here that
 * write to the child's real stdin -- same interaction, no typing.
 *
 * Deliberately built with zero extra npm dependencies (just Node's
 * built-in http/child_process) so there's nothing new to install.
 * Binds to 127.0.0.1 only -- never reachable from the network.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.APP_PORT || 4747);

const JOBS = {
  'redfin-enrich': { script: 'src/redfin/enrichAgentContacts.js', label: 'Enrich agent contacts (Redfin)' },
  'voice-prepare': { script: 'src/voice/prepareGoogleVoiceMessage.js', label: 'Prepare Google Voice texts (stops before Send)' },
  'voice-autosend': { script: 'src/voice/autoSendGoogleVoiceMessage.js', label: 'Auto-send Google Voice texts (clicks Send)' },
  'build-apps-script': { script: 'scripts/build-apps-script.js', label: 'Rebuild Apps Script files from shared/ + templates/' }
};

let currentJob = null; // { name, child }
const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function startJob(name) {
  if (currentJob) throw new Error('A job is already running: ' + JOBS[currentJob.name].label);
  const job = JOBS[name];
  if (!job) throw new Error('Unknown job: ' + name);

  const child = spawn(process.execPath, [job.script], { cwd: ROOT, env: process.env });
  currentJob = { name, child };
  broadcast({ type: 'job-started', name, label: job.label });

  child.stdout.on('data', (buf) => broadcast({ type: 'log', stream: 'stdout', text: buf.toString() }));
  child.stderr.on('data', (buf) => broadcast({ type: 'log', stream: 'stderr', text: buf.toString() }));
  child.on('exit', (code) => {
    broadcast({ type: 'job-finished', name, code });
    currentJob = null;
  });
  child.on('error', (err) => {
    broadcast({ type: 'log', stream: 'stderr', text: 'Failed to start: ' + err.message + '\n' });
    broadcast({ type: 'job-finished', name, code: -1 });
    currentJob = null;
  });
}

function sendInputToJob(text) {
  if (!currentJob) throw new Error('No job is running.');
  currentJob.child.stdin.write(String(text) + '\n');
  broadcast({ type: 'log', stream: 'input', text: '> ' + text + '\n' });
}

function stopJob() {
  if (!currentJob) return;
  currentJob.child.kill();
  broadcast({ type: 'log', stream: 'stderr', text: '(stopped by operator)\n' });
}

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

function readEnvFlag(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function getStatus() {
  return {
    running: currentJob ? currentJob.name : null,
    jobs: Object.fromEntries(Object.entries(JOBS).map(([key, j]) => [key, j.label])),
    flags: {
      ENABLE_VOICE_AUTOMATION: readEnvFlag('ENABLE_VOICE_AUTOMATION'),
      ENABLE_AUTO_SMS_SEND: readEnvFlag('ENABLE_AUTO_SMS_SEND')
    },
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
      startJob(body.job);
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
      sendInputToJob(body.text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/stop') {
    stopJob();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Outreach control panel running at http://127.0.0.1:' + PORT);
  console.log('Open that URL in your browser (or use the launcher, which does it for you).');
});
