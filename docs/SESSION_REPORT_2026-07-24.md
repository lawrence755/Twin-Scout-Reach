# Session report: reconciling with the Sheet-to-app architecture pivot (2026-07-24)

Context for whoever (human or agent) picks this up next: this session
started with local, uncommitted Redfin-scraper debugging work (see
`docs/REDFIN_AUTOMATION_SESSION_2026-07-23.md`), then had to reconcile with
a separate push to `origin/claude/flip-scout-outreach-automation-w4muqx`
that landed a much bigger architecture change while this session was
running locally.

## What changed upstream (pulled this session)

Three commits, fast-forwarded in cleanly:

```
977683a Centralize row add/validate/submit/approve in the desktop app
1394d1b Add real Gmail API sending from the desktop app
21c8be9 Pull outreach off the Sheet entirely -- centralize on the app + local store
```

Net effect: the Outreach Queue is no longer a set of Sheet tabs. The old
Sheet-bound Apps Script files are gone (`apps-script/Code.js`,
`QueueActions.js`, `GmailSender.js`, `SheetConstants.js`, `SheetSetup.js`,
`AutoSend.js`, `Templates.js`, `apps-script/shared/README.md`), replaced by
`src/outreach/store.js` + `actions.js` (local store) and
`src/gmail/gmailClient.js` (direct Gmail API sending from the desktop app).
`apps-script/` now only contains Bryan's untouched `FlipScoutSheet.js`,
`appsscript.json`, and `shared/*.js`. The desktop app (`app/`) gained a
"Flip Scout Leads (Bryan's, read-only)" panel with Load/refresh and
"Add selected to Outreach Queue".

## What this session did to reconcile

1. **`git status` + `git log origin..HEAD`** -- confirmed 8 uncommitted
   local files (all from yesterday's Redfin scraper debugging) and no
   local commits ahead of origin.
2. **`git stash -u`** -- stashed tracked *and* untracked changes together
   (message: "Redfin scraper Chrome-profile experiments (2026-07-23,
   concluded blocked)"). Recoverable via `git stash list` /
   `git stash pop`, with an expected `package-lock.json` conflict on pop
   (origin now tracks its own lockfile).
3. **`git pull origin claude/flip-scout-outreach-automation-w4muqx`** --
   fast-forward, 37 files changed, no conflicts.
4. **`npm install`** -- reconciled lockfile, 344 packages. 13 vulnerabilities
   reported by npm audit (4 moderate, 8 high, 1 critical) -- not addressed
   this session, flagged for separate follow-up.
5. **`cd apps-script && clasp push --force`** -- redeployed the now-trimmed
   6-file Apps Script project live (the `--force` was needed because
   `appsscript.json` changed and clasp's confirmation prompt auto-declines
   in a non-interactive shell). Confirmed the old dead files are gone from
   the live project.
6. **Old Outreach Queue Sheet tabs** -- deleted by the user directly (not
   by this session).
7. **Verified the new panel loads** -- via the browser-tab fallback
   (`app/server.js` on port 4747, not the packaged `.exe`) rather than the
   Electron window directly, since that can be checked programmatically.
   All requests 200 OK including the new `/outreach/rows` endpoint.

## Two bugs found and fixed while verifying the packaged `.exe`

### 1. `git stash -u` gutted the packaged build

`dist/win-unpacked/` was untracked and, at the time, not yet covered by
`.gitignore`, so `git stash -u` swept up and removed the *entire* packaged
Electron build (the `.exe`, all its runtime DLL/pak files, and
`resources/app/{app,src,shared,templates}`) -- leaving only the gitignored
`node_modules`, `.env`, and `service-account.json` behind. This was
anticipated and accepted as fine (cheap to regenerate).

**Fix:** `npm run dist:win` (one transient `rcedit` failure on attempt 1,
auto-retried and succeeded per electron-builder's own retry logic), then
re-copied `.env` and `service-account.json` into the fresh
`resources/app/`.

### 2. `GOOGLE_APPLICATION_CREDENTIALS` relative path breaks when the `.exe` is launched directly

`src/config/index.js` defaults `credentialsPath` to the relative
`./service-account.json`, passed straight through to googleapis'
`GoogleAuth({ keyFile: ... })` (`src/sheets/sheetsClient.js:42`). Relative
paths there resolve against `process.cwd()` at runtime, **not** the app's
install directory. Testing by `cd`-ing into `resources/app` and running
`node src/redfin/enrichAgentContacts.js` directly masked this (cwd
happened to be correct). But double-clicking `Outreach Control
Panel.exe` directly gives it a working directory of `dist/win-unpacked/`
(the `.exe`'s own folder) -- one level up from where the file actually is
-- producing exactly this error when clicking "Load / refresh leads":

```
Could not load Flip Scout Leads: ENOENT: no such file or directory,
open 'dist\win-unpacked\service-account.json'
```

**Fix applied (this session, workaround not a code fix):** changed
`GOOGLE_APPLICATION_CREDENTIALS` in the packaged app's `.env`
(`dist/win-unpacked/resources/app/.env`) to an absolute path:

```
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\Iriga Office\Desktop\twin-scout-reach\dist\win-unpacked\resources\app\service-account.json
```

**Not fixed at the root:** this is a per-machine `.env` workaround, not a
code change. It will break again on a fresh machine/install unless
whoever sets it up next also uses an absolute path, or `src/config/index.js`
is changed to resolve a relative `credentialsPath` against a stable anchor
(e.g. the packaged app's own directory) instead of `process.cwd()`. Worth
fixing properly if this app gets distributed beyond this one machine.

## Outstanding / left as-is

- `git stash` still holds yesterday's Redfin-scraper Chrome-profile
  experiment work, un-popped. Session's own conclusion on that work
  (`docs/REDFIN_AUTOMATION_SESSION_2026-07-23.md`): Redfin's bot detection
  blocks the automated browser even immediately after a human passes its
  verification challenge on a fresh profile -- not something worth
  reviving without a different approach.
- The orphaned `buildOutreachMenu_` Apps Script trigger (pointed at a
  function that no longer exists after the `clasp push`) was **not**
  deleted -- harmless to leave, but removable via the Apps Script editor's
  Triggers page if wanted.
- `npm audit`'s 13 vulnerabilities (1 critical) -- not investigated.
- The `GOOGLE_APPLICATION_CREDENTIALS` relative-path root cause above --
  not fixed in code, only worked around locally.
