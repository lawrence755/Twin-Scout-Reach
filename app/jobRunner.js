/**
 * Shared job-running logic: spawns one of the existing Node scripts
 * unmodified as a child process, and emits events for its output and
 * lifecycle. Used by both app/server.js (browser-tab control panel)
 * and app/main.js (Electron app) so there's one source of truth for
 * "how to run these scripts," not two.
 */
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = path.resolve(__dirname, '..');

const JOBS = {
  'reiblackbook-login': { script: 'scripts/login-reiblackbook.js', label: 'Log into REI BlackBook (opens a real browser window)' },
  'reiblackbook-enrich': { script: 'scripts/enrich-reiblackbook.js', label: 'Enrich agent contacts (REI BlackBook)' },
  'reiblackbook-check-notes': { script: 'scripts/check-reiblackbook-notes.js', label: 'Check REI BlackBook notes for do-not-automate flags' },
  'reiblackbook-check-replies': { script: 'scripts/check-reiblackbook-replies.js', label: 'Check for replies (REI BlackBook)' },
  'reiblackbook-autosend': { script: 'src/reiblackbook/autoSendReiBlackBookMessage.js', label: 'Auto-send texts via REI BlackBook (clicks Send)' },
  'voice-prepare': { script: 'src/voice/prepareGoogleVoiceMessage.js', label: 'Prepare Google Voice texts (stops before Send)' },
  'voice-autosend': { script: 'src/voice/autoSendGoogleVoiceMessage.js', label: 'Auto-send Google Voice texts (clicks Send)' }
};

class JobRunner extends EventEmitter {
  constructor() {
    super();
    this.currentJob = null;
  }

  listJobs() {
    return Object.fromEntries(Object.entries(JOBS).map(([key, j]) => [key, j.label]));
  }

  isRunning() {
    return this.currentJob ? this.currentJob.name : null;
  }

  start(name) {
    if (this.currentJob) {
      throw new Error('A job is already running: ' + JOBS[this.currentJob.name].label);
    }
    const job = JOBS[name];
    if (!job) throw new Error('Unknown job: ' + name);

    // Under Electron, process.execPath is the Electron binary, not a
    // plain Node binary -- ELECTRON_RUN_AS_NODE makes it behave like
    // one for this child, instead of trying to launch a second GUI
    // instance. Under plain Node (server.js / CLI), this is a no-op.
    const isElectron = !!process.versions.electron;
    const spawnEnv = isElectron ? Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) : process.env;
    const child = spawn(process.execPath, [job.script], { cwd: ROOT, env: spawnEnv });
    this.currentJob = { name, child };
    this.emit('job-started', { name, label: job.label });

    child.stdout.on('data', (buf) => this.emit('log', { stream: 'stdout', text: buf.toString() }));
    child.stderr.on('data', (buf) => this.emit('log', { stream: 'stderr', text: buf.toString() }));
    child.on('exit', (code) => {
      this.emit('job-finished', { name, code });
      this.currentJob = null;
    });
    child.on('error', (err) => {
      this.emit('log', { stream: 'stderr', text: 'Failed to start: ' + err.message + '\n' });
      this.emit('job-finished', { name, code: -1 });
      this.currentJob = null;
    });
  }

  sendInput(text) {
    if (!this.currentJob) throw new Error('No job is running.');
    this.currentJob.child.stdin.write(String(text) + '\n');
    this.emit('log', { stream: 'input', text: '> ' + text + '\n' });
  }

  stop() {
    if (!this.currentJob) return;
    this.currentJob.child.kill();
    this.emit('log', { stream: 'stderr', text: '(stopped by operator)\n' });
  }
}

function readEnvFlags() {
  const isTrue = (v) => String(v || '').trim().toLowerCase() === 'true';
  return {
    ENABLE_VOICE_AUTOMATION: isTrue(process.env.ENABLE_VOICE_AUTOMATION),
    ENABLE_AUTO_SMS_SEND: isTrue(process.env.ENABLE_AUTO_SMS_SEND)
  };
}

module.exports = { JobRunner, JOBS, readEnvFlags, ROOT };
