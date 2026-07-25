/**
 * Continuous background automation: cycles through the full outreach
 * pipeline (auto-queue from Flip Scout Leads -> validate -> submit
 * for approval -> approve -> REI BlackBook enrich/notes/replies/send
 * -> email send -> optionally Google Voice) on a timer, instead of a
 * human clicking each job button one at a time.
 *
 * Sits above the existing JobRunner (jobRunner.js) rather than
 * replacing it -- JobRunner still only ever runs one child-process
 * job at a time; this just sequences calls to it (and to in-process
 * src/outreach/actions.js functions) automatically. Every real send
 * step here is exactly as gated as its one-shot button equivalent
 * already was (ENABLE_REI_SMS_SEND, ENABLE_EMAIL_SENDING,
 * ENABLE_AUTO_SMS_SEND, doNotAutomate, suppression list) -- this loop
 * automates the *sequence and timing*, not a new, looser safety model.
 *
 * Job-based steps (REI BlackBook, Google Voice) rely on JobRunner's
 * own 'job-started'/'job-finished'/'log' events, which the app's log
 * drawer already renders ("--- started: X ---" / "--- finished ---")
 * -- this class does not re-emit those, only its own narration for
 * the in-process action steps that don't otherwise produce any log
 * output at all.
 */
const { EventEmitter } = require('events');
const outreachActions = require('../src/outreach/actions');
const envSettings = require('./envSettings');

class AutomationLoop extends EventEmitter {
  constructor(jobRunner) {
    super();
    this.jobRunner = jobRunner;
    this.state = 'stopped'; // 'stopped' | 'running' | 'paused' | 'stopping'
    this.cycleCount = 0;
    this.currentStep = null;
    this._resumeWaiters = [];
    this._cycleTimer = null;
    this._stopRequested = false;
    this._loopPromise = null;
    this._activeActionPromise = null; // the in-flight in-process step, if any -- can't be killed like a child-process job can
  }

  getStatus() {
    return {
      state: this.state,
      cycleCount: this.cycleCount,
      currentStep: this.currentStep,
      cycleIntervalMinutes: envSettings.getCycleIntervalMinutes()
    };
  }

  start() {
    if (this.state !== 'stopped') return;
    this.state = 'running';
    this._stopRequested = false;
    this._emitStatus();
    this.emit('log', { stream: 'stdout', text: '=== Automation loop started ===\n' });
    this._loopPromise = this._runLoop();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this._emitStatus();
    this.emit('log', { stream: 'stdout', text: '(automation loop paused -- current step finishes, then holds)\n' });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this._emitStatus();
    this.emit('log', { stream: 'stdout', text: '(automation loop resumed)\n' });
    const waiters = this._resumeWaiters;
    this._resumeWaiters = [];
    waiters.forEach((r) => r());
  }

  stop() {
    if (this.state === 'stopped' || this.state === 'stopping') return;
    this._stopRequested = true;
    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
      this._cycleTimer = null;
    }
    this.jobRunner.stop(); // kill any in-flight child-process job immediately
    const waiters = this._resumeWaiters;
    this._resumeWaiters = [];
    waiters.forEach((r) => r()); // release a paused wait so the loop notices _stopRequested and exits

    // An in-process action step (auto-queue, refresh-validation, etc.)
    // has no kill switch the way a child-process job does -- it's
    // already-sent Sheets API calls, not safely abortable mid-flight.
    // Rather than claim "stopped" while it's still actually running
    // (misleading -- its own log line would print AFTER "stopped"),
    // hold in a transient 'stopping' state until it genuinely finishes.
    if (this._activeActionPromise) {
      this.state = 'stopping';
      this._emitStatus();
      this.emit('log', { stream: 'stdout', text: '(stopping -- letting "' + this.currentStep + '" finish first)\n' });
      this._activeActionPromise.finally(() => this._finishStop());
    } else {
      this._finishStop();
    }
  }

  _finishStop() {
    this.state = 'stopped';
    this.currentStep = null;
    this._emitStatus();
    this.emit('log', { stream: 'stderr', text: '=== Automation loop stopped ===\n' });
  }

  _emitStatus() {
    this.emit('status-changed', this.getStatus());
  }

  async _waitIfPaused() {
    if (this.state !== 'paused') return;
    await new Promise((resolve) => this._resumeWaiters.push(resolve));
  }

  /** In-process action step -- narrates itself since there's no other log source for it. */
  async _runStep(name, fn) {
    if (this._stopRequested) return;
    await this._waitIfPaused();
    if (this._stopRequested) return;
    this.currentStep = name;
    this._emitStatus();
    this.emit('log', { stream: 'stdout', text: '--- automation: ' + name + ' ---\n' });
    const promise = (async () => {
      try {
        await fn();
      } catch (err) {
        this.emit('log', { stream: 'stderr', text: 'Step "' + name + '" failed: ' + err.message + '\n' });
      }
    })();
    this._activeActionPromise = promise;
    await promise;
    if (this._activeActionPromise === promise) this._activeActionPromise = null;
  }

  /** Job-based step -- relies on JobRunner's own start/finished events for narration. */
  async _runJobStep(jobName, label) {
    if (this._stopRequested) return;
    await this._waitIfPaused();
    if (this._stopRequested) return;
    this.currentStep = label;
    this._emitStatus();
    await new Promise((resolve) => {
      const onFinished = (payload) => {
        if (payload.name !== jobName) return;
        this.jobRunner.off('job-finished', onFinished);
        resolve();
      };
      this.jobRunner.on('job-finished', onFinished);
      try {
        this.jobRunner.start(jobName);
      } catch (err) {
        this.jobRunner.off('job-finished', onFinished);
        this.emit('log', { stream: 'stderr', text: 'Could not start "' + jobName + '": ' + err.message + '\n' });
        resolve();
      }
    });
  }

  async _runCycle() {
    this.cycleCount++;

    await this._runStep('Auto-queue from Flip Scout Leads', async () => {
      const { added } = await outreachActions.autoQueueFromFlipScout();
      this.emit('log', { stream: 'stdout', text: 'Auto-queued ' + added.length + ' new lead(s) from Flip Scout Leads.\n' });
    });

    await this._runStep('Refresh validation', async () => {
      const results = await outreachActions.refreshValidation();
      this.emit('log', { stream: 'stdout', text: 'Refreshed validation on ' + results.length + ' row(s).\n' });
    });

    await this._runStep('Submit for approval', async () => {
      const results = await outreachActions.submitForApproval();
      this.emit('log', { stream: 'stdout', text: 'Submitted ' + results.length + ' row(s) for approval.\n' });
    });

    await this._runStep('Approve outreach', async () => {
      const results = await outreachActions.approveOutreach();
      this.emit('log', { stream: 'stdout', text: 'Approved ' + results.length + ' row(s).\n' });
    });

    await this._runJobStep('reiblackbook-enrich', 'Enrich agent contacts (REI BlackBook)');
    await this._runJobStep('reiblackbook-check-notes', 'Check REI BlackBook notes for do-not-automate flags');
    await this._runJobStep('reiblackbook-check-replies', 'Check for replies (REI BlackBook)');
    await this._runJobStep('reiblackbook-autosend', 'Auto-send texts via REI BlackBook');

    await this._runStep('Send approved emails', async () => {
      const { sendingEnabled, results } = await outreachActions.sendApprovedEmails();
      this.emit('log', {
        stream: 'stdout',
        text: (sendingEnabled ? 'Email sending is ON -- ' : 'Email sending is OFF (dry run) -- ') + results.length + ' row(s) processed.\n'
      });
    });

    // Google Voice stays opt-in, matching the Automation tab's own
    // hide/show behavior -- only run these steps if the setting is on.
    if (envSettings.getToggleSettings().ENABLE_VOICE_AUTOMATION) {
      await this._runJobStep('voice-prepare', 'Prepare Google Voice texts');
      await this._runJobStep('voice-autosend', 'Auto-send Google Voice texts');
      await this._runStep('Check for replies (Google Voice)', async () => {
        const results = await outreachActions.checkReplies();
        this.emit('log', { stream: 'stdout', text: 'Checked replies on ' + results.length + ' row(s).\n' });
      });
    }
  }

  async _runLoop() {
    while (!this._stopRequested) {
      try {
        await this._runCycle();
      } catch (err) {
        this.emit('log', { stream: 'stderr', text: 'Automation cycle failed: ' + err.message + '\n' });
      }
      if (this._stopRequested) break;

      this.currentStep = null;
      const minutes = envSettings.getCycleIntervalMinutes();
      this.emit('log', { stream: 'stdout', text: 'Cycle ' + this.cycleCount + ' complete. Next run in ' + minutes + ' minute(s).\n' });
      this._emitStatus();

      await this._waitIfPaused();
      if (this._stopRequested) break;
      await new Promise((resolve) => {
        this._cycleTimer = setTimeout(resolve, minutes * 60 * 1000);
      });
    }
    this.currentStep = null;
    this._emitStatus();
  }
}

module.exports = { AutomationLoop };
