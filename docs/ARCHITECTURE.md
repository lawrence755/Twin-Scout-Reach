# Architecture

## The app owns everything except Flip Scout Leads itself

Bryan's `Flip Scout Leads` tab and `apps-script/FlipScoutSheet.js` (his
hourly sync, KPI tab, rejected-leads blacklist) predate this system and
stay untouched -- this is the one thing still read from the Sheet, and
it's read-only.

Everything outreach-specific -- the queue, communication log,
suppression list, template rendering, approval flow, Gmail sending,
Google Voice prep -- lives in the Node.js app (`app/` + `src/`) and a
local JSON data store (`data/`, gitignored). Earlier versions of this
system put that data in extra Sheet tabs and split logic between Apps
Script and Node; that's been consolidated into one place so there's a
single point of control and no risk of the two sides drifting apart.

## Why Node.js only now, not Apps Script

Apps Script was originally used because `GmailApp.sendEmail` needs no
separate OAuth setup. That's no longer the deciding factor:
`src/gmail/gmailClient.js` does a normal Gmail API OAuth "installed
app" flow instead (see the README's one-time Gmail setup), so nothing
about sending requires Apps Script anymore. Keeping Apps Script scoped
to only Bryan's sync means `clasp push` (which replaces the *entire*
remote project's file set) can never risk his hourly automation again,
and there's one runtime to reason about instead of two.

## Local data store

`src/outreach/store.js` is a small file-backed store -- plain JSON
arrays in `data/`, atomic writes (write to `.tmp`, rename over the
real file). No database dependency. Rows get a generated `id`
(replacing what used to be a Sheet row number); every other function
in `src/outreach/actions.js` reads/writes by that `id`.

`src/sheets/sheetsClient.js` is now just `getFlipScoutLeads()` -- a
read-only Sheets API call (`spreadsheets.readonly` scope) mapping
Bryan's actual `FlipScoutSheet.js` `COLUMNS` array to camelCase keys.
Nothing else touches the Sheet.

## One rule engine, still

`shared/` holds the qualification rules, status flow, key/suppression
logic, and template engine, required directly by `src/outreach/actions.js`,
`src/voice/*.js`, and `src/redfin/*.js`. It's still written with a
`module.exports` guard rather than plain `require`/`export`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

This is a holdover from when the same files also ran unmodified inside
Google Apps Script (which has no module system) -- that copy step is
gone now that Apps Script only runs Bryan's sync, but the guard is
harmless to keep, and would make reusing this logic from Apps Script
again trivial if that's ever needed.

## Layout

```
shared/            Qualification rules, status flow, keys, template engine
templates/          Versioned message content (Phase 4), one JSON file per template
docs/               Plan, this file, voice guidelines, open items, auto-mode risks
apps-script/        Bound Apps Script project -- Bryan's Flip Scout sync ONLY
src/
  outreach/          store.js (local data) + actions.js (all outreach business logic)
  sheets/            Read-only Flip Scout Leads reader
  gmail/             Gmail API OAuth client + sender
  redfin/            Agent-contact scraper (optional, separately gated)
  voice/             Playwright Google Voice (prepare, and a separate auto-send script)
  config/            .env-driven config and feature flags
app/                Electron control panel (main.js/preload.js/jobRunner.js + public/ front end) and the browser-tab fallback (server.js)
tests/              node:test coverage for shared/ and src/redfin/
sample-data/        Example leads for exercising the rule engine locally
data/               Local outreach data (gitignored) -- created on first use
```

## Packaging the app (`npm run dist:win`)

`electron-builder` with `asar: false` and `win.target: 'dir'` -- an
unpacked folder, not a compressed single-file installer, since that
avoids needing Wine-dependent NSIS tooling. The packaged layout
preserves the repo's relative structure (`resources/app/app/main.js`,
`resources/app/src/...`, etc.), so `.env` and `service-account.json`
need to be copied to `resources/app/.env` / `resources/app/service-account.json`
after building -- same relative position as in the source repo.

`CSC_IDENTITY_AUTO_DISCOVERY=false` skips an unrelated code-signing
tool download that needs Windows symlink privileges (elevated shell
needed the first time if that download was already attempted and
partially cached).

## Auto mode addendum

`src/redfin/` and `src/voice/autoSendGoogleVoiceMessage.js` add agent-
contact scraping and a no-per-message-approval SMS send path. Both are
additive and separately gated from the manual/approved path. Real-world
testing found Redfin's bot detection blocks the automated-browser
approach reliably, even right after a human clears its own verification
challenge on a fresh profile -- see `docs/AUTO_MODE_RISKS.md` for the
full account and what's still open (extending Bryan's already-trusted
`flip_scout_redfin.py` scraper, in a separate repo, to capture agent
info during its existing detail-page fetch).

## Safety layers

- **Email**: one `.env` flag, `ENABLE_EMAIL_SENDING`, default `false`.
- **Voice prepare**: `ENABLE_VOICE_AUTOMATION`, default `false` --
  gates whether a browser opens at all; `src/voice/prepareGoogleVoiceMessage.js`
  never clicks Send regardless of this flag, because that code path
  simply doesn't exist in that file.
- **Voice auto-send**: `ENABLE_AUTO_SMS_SEND`, default `false` -- a
  separate, more dangerous script (`autoSendGoogleVoiceMessage.js`)
  that does click Send.

All three default off. Flipping one doesn't affect the others.
