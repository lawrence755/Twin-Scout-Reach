# Architecture

## Why two runtimes

The system is split across Google Apps Script (bound to the Sheet) and
Node.js, because the two things that need direct access to something
outside the Sheet -- Gmail and Google Voice -- have very different
constraints:

- **Gmail**: `GmailApp.sendEmail` works natively from Apps Script with
  no separate credentials, and the send action is naturally triggered
  by a Sheet menu item ("Send approved emails"). So all of Phases 2, 3,
  5, and 6 live in `apps-script/`.
- **Google Voice has no sending API.** The only way to prepare a
  message is to drive the actual web UI, which means a real browser --
  Playwright, which means Node.js. So Phase 7 lives in `src/voice/`.

## One rule engine, two environments

`shared/` holds the qualification rules, status flow, key/suppression
logic, and template engine as plain JS files with no `require`/`import`.
Each ends with:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

In Node, `module` exists, so `require('../shared/qualification')` works
normally. In Apps Script, `module` is undefined, so that block never
runs, and the functions declared above it become ordinary globals
available to every other file in the project (Apps Script concatenates
all files into one global scope regardless of folder nesting).

`npm run build:apps-script` (`scripts/build-apps-script.js`) copies
`shared/*.js` into `apps-script/shared/` before a `clasp push`, and
regenerates `apps-script/Templates.js` from `templates/*.json` (Apps
Script has no filesystem access to read the template files directly).
Both generated outputs are gitignored -- `shared/` and `templates/` are
the only source of truth.

## Layout

```
shared/            Qualification rules, status flow, keys, template engine
templates/          Versioned message content (Phase 4), one JSON file per template
docs/               Voice guidelines, this file, the open-items checklist
apps-script/        Bound Apps Script project (Phases 2, 3, 5, 6)
  shared/           Generated -- see above
  Templates.js      Generated -- see above
src/
  config/           .env-driven config and feature flags
  sheets/           Narrow googleapis client (read Approved rows, write voice outcomes)
  voice/            Playwright Google Voice prep (Phase 7)
tests/              node:test coverage for shared/
scripts/            build-apps-script.js
sample-data/        Example leads for exercising the rule engine locally
```

## Auto mode addendum

`src/redfin/`, `apps-script/AutoSend.js`, and
`src/voice/autoSendGoogleVoiceMessage.js` were added after the initial
milestone to scrape agent contact info from Redfin and to send without
a per-message approval click. They reuse the same `shared/` rule
engine and log to a new `Auto Outreach Log` tab (kept separate from
`Communication Log`, which records the human-approved flow). See
`docs/AUTO_MODE_RISKS.md` for why this exists and what it costs.

## Safety layers

Two independent switches gate live sending, both default to off:

1. The Sheet's `Settings` tab (`Enable Email Sending`, `Enable Voice
   Automation`) -- read by Apps Script and Node respectively.
2. `.env` (`ENABLE_EMAIL_SENDING`, `ENABLE_VOICE_AUTOMATION`) -- read
   by the Node side only.

Independent of both switches, `src/voice/prepareGoogleVoiceMessage.js`
never clicks Google Voice's Send control under any condition -- that is
not a flag-gated behavior, it is simply not code that exists in this
repo. See the file's header comment.
