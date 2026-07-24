# Flip Scout Outreach Automation

An outreach system, centered on a desktop app, that picks up after
Bryan adds qualified properties in the existing `Flip Scout Leads`
Google Sheet: verification, versioned templates, human approval,
guarded Gmail sending, and a Playwright-assisted (never-auto-send)
Google Voice SMS prep step -- plus optional, separately-gated auto
modes for both.

Flip Scout's own scoring logic, Redfin navigation, and REI BlackBook
are untouched. Bryan's `Flip Scout Leads` tab and its own Apps Script
sync (`apps-script/FlipScoutSheet.js`) are read-only from this
system's point of view -- nothing here ever writes to that tab. Every
outreach-specific tab that used to live in the Sheet has been removed;
that data now lives locally (see "Where the data lives" below), owned
entirely by the desktop app.

See `docs/PLAN.md` for the full plan this was originally built from,
`docs/ARCHITECTURE.md` for how it maps onto this codebase, and
`docs/AUTO_MODE_RISKS.md` for the auto-mode addendum (Redfin scraping,
no-per-message-approval sending) and its residual risks -- read that
before enabling either.

## Status

The core pipeline (browse leads -> verify -> render templates -> human
approval -> send) works end to end, with **all live sending disabled
by default**.

| Phase | Status |
| --- | --- |
| 1. Project foundation | Done |
| 2. Outreach data layer | Done -- local JSON store (`data/`), not Sheet tabs; see below |
| 3. Property/agent verification rules | Done |
| 4. Template system | Done |
| 5. Eligibility and approval status flow | Done |
| 6. Gmail automation | Done, via the Gmail API from the app; guarded off by default |
| 7. Google Voice preparation | Done, guarded off by default -- selectors are unverified against the live Google Voice UI |
| 8. Duplicate and suppression controls | Done |
| 9. Follow-up scheduling and handoff | **Not built yet.** The status flow supports `Follow-Up Due`, but nothing currently moves a `Contacted` row into it automatically |
| 10. Testing and launch | Steps 1-4 (validation, template rendering, duplicate prevention, suppression) are covered by `tests/`. Steps 5-9 are manual steps to run once this is deployed against real accounts |

Before flipping any live-sending switch, resolve everything in
`docs/OPEN_ITEMS.md`.

**Auto-mode addendum:** Redfin agent-contact scraping (`src/redfin/`)
and a no-per-message-approval SMS auto-send path
(`src/voice/autoSendGoogleVoiceMessage.js`) exist as additive,
separately-gated capabilities on top of the manual/approved path
above. Real-world testing found Redfin's bot detection reliably blocks
the automated-browser approach even after a human manually clears its
verification challenge -- this is a known, current limitation, not
something either script silently works around. See
`docs/AUTO_MODE_RISKS.md`.

## Where the data lives

| Data | Where |
| --- | --- |
| Flip Scout Leads (score, address, ARV, Redfin link, etc.) | Google Sheet, Bryan's `Flip Scout Leads` tab -- read-only from here |
| Outreach Queue, Communication Log, Suppression List | `data/*.json` next to this repo/app install (gitignored) |
| Templates | `templates/*.json` (version-controlled) |
| Settings (sender identity, flags) | `.env` |

Nothing outreach-related is written back to the Sheet. The Apps
Script project bound to that spreadsheet now contains only
`apps-script/FlipScoutSheet.js` (Bryan's hourly sync, KPI tab,
rejected-leads blacklist) -- unchanged from before this system existed.

**If your spreadsheet still has the old outreach tabs** (`Outreach
Queue`, `Message Templates`, `Communication Log`, `Suppression List`,
`Settings`, `Error Log`, `Auto Outreach Log`) from an earlier version
of this system, they're no longer read or written by anything here --
delete them by hand (right-click the tab -> Delete) whenever you're
ready; nothing depends on them existing or not existing.

## Layout

```
shared/            Qualification rules, status flow, keys, template engine
templates/          Versioned message content (Phase 4)
apps-script/        Bound Apps Script project -- Bryan's Flip Scout sync ONLY
src/
  outreach/          Local data store + all outreach business logic (add/validate/submit/approve/send)
  sheets/            Read-only Flip Scout Leads reader (the only Sheets API access left)
  gmail/             Gmail API OAuth client + sender
  redfin/            Agent-contact scraper (optional, separately gated)
  voice/             Playwright Google Voice (prepare, and a separate auto-send script)
  config/            .env-driven config and feature flags
app/                Electron control panel (graphical, no terminal) -- the primary way to use this system
tests/              node:test coverage for shared/ and src/redfin/
docs/               Plan, architecture, template voice guidelines, open items, auto-mode risks
sample-data/        Example leads for exercising the rule engine locally
data/               Local outreach data (gitignored) -- created on first use
```

Full explanation in `docs/ARCHITECTURE.md`.

## Setup

### Tests (no external accounts needed)

```
npm install
npm test
```

### Apps Script (Bryan's Flip Scout sync -- rarely needs touching)

This only matters if the spreadsheet's bound script needs
(re)deploying at all -- day to day, nothing here interacts with Apps
Script. `clasp login` requires a normal OAuth browser flow, which does
not work from a network-sandboxed remote session -- run this from a
machine with regular internet access.

1. Open the spreadsheet -> **Extensions -> Apps Script**.
2. `npm install -g @google/clasp && clasp login`.
3. Point `apps-script/.clasp.json` (gitignored) at that project's Script ID -- either `clasp clone <script-id> --rootDir ./apps-script`, or write `{"scriptId": "<script-id>", "rootDir": "."}` by hand.
4. `cd apps-script && clasp push`.

### The app (`app/`) -- primary way to use this system

- `npm run app` -- Electron window (recommended).
- `npm run app:web` -- same functionality as a local web page instead (`http://127.0.0.1:4747`), no Electron build needed.
- `npm run dist:win` -- packages it into a standalone `.exe` (see `docs/ARCHITECTURE.md` for packaging notes -- Windows needs an elevated shell and `CSC_IDENTITY_AUTO_DISCOVERY=false` the first time, to skip an irrelevant code-signing download that needs symlink privileges).

What it does:
- **Flip Scout Leads panel** -- loads Bryan's leads read-only, check the ones you want, **Add selected to Outreach Queue**.
- **Outreach Queue panel** -- add a row by hand (real lead or internal test row); click any row to load it back into the form for editing (e.g. filling in agent contact info and the Phase 3 verification checkboxes after adding from Flip Scout); **Refresh validation / Submit for approval / Approve outreach / Send approved emails**.
- **Enrich agent contacts (Redfin)**, **Prepare/Auto-send Google Voice texts** -- same jobs as before, output streamed live into the log panel.

### One-time setup before using the app for real

1. `npm install`
2. `cp .env.example .env` and fill it in (sender identity, `GOOGLE_SHEET_ID`). Leave `ENABLE_EMAIL_SENDING`, `ENABLE_VOICE_AUTOMATION`, `ENABLE_AUTO_SMS_SEND` as `false`.
3. **Sheets read access** (for the Flip Scout Leads panel): a Google Cloud service account with the Sheets API enabled, `spreadsheets.readonly` is all it needs -- share the spreadsheet with its email (Viewer is enough), point `GOOGLE_APPLICATION_CREDENTIALS` at its key file.
4. **Gmail send access**: enable the Gmail API in the same (or a new) Google Cloud project -> **Credentials -> Create Credentials -> OAuth client ID**, type **Desktop app** -> download its JSON as `gmail-oauth-client.json` -> `npm run gmail:authorize` (opens a normal Google consent screen once; saves a token to `gmail-token.json`, gitignored).
5. `npx playwright install chromium` -- for the Google Voice steps.

## Safety

- **Email**: gated by a single `.env` flag, `ENABLE_EMAIL_SENDING`, default `false`. Every send re-checks suppression, Do Not Automate, and unresolved merge fields immediately before sending regardless of that flag, and logs every attempt (sent, blocked, or dry-run) to `data/communication-log.json`.
- **Google Voice**: `src/voice/prepareGoogleVoiceMessage.js` has no code path that clicks Send, regardless of flags -- a human always reviews and sends manually there. `src/voice/autoSendGoogleVoiceMessage.js` is a separate script that does click Send, gated by `ENABLE_AUTO_SMS_SEND` (default `false`).
- **Approval gate**: `refreshValidation`/`submitForApproval` only ever advance rows earlier than `Pending Approval` -- once a row has rendered content pending human review, nothing here silently moves it further. `sendApprovedEmails` and `autoSendGoogleVoiceMessage.js` are the two paths that skip the manual per-row click, and both are explicitly named and documented as such.
- `src/redfin/scrapeRedfin.js` stops and logs on any detected block/CAPTCHA page rather than attempting to get around it -- but running it at all still carries a Redfin Terms of Use risk, and (per real-world testing) may simply not get through Redfin's bot detection at all; see `docs/AUTO_MODE_RISKS.md`.
