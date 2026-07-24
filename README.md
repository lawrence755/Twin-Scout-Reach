# Flip Scout Outreach Automation

An outreach system that picks up after Bryan adds or updates qualified
properties in the existing `Flip Scout Leads` Google Sheet: verification,
versioned templates, human approval, guarded Gmail sending, and a
Playwright-assisted (never-auto-send) Google Voice SMS prep step.

Flip Scout's own scoring logic, Redfin navigation, and REI BlackBook are
untouched -- this repo only adds a new set of tabs alongside the
existing sheet and a Node.js/Apps Script layer on top.

See `docs/PLAN.md` for the full plan this was built from,
`docs/ARCHITECTURE.md` for how it maps onto this codebase, and
`docs/AUTO_MODE_RISKS.md` for an addendum (2026-07-23) that adds
Redfin-based agent-contact scraping and a no-per-message-approval
send path, on top of the original human-approval design below -- read
that before enabling either.

## Status

This is the first development milestone: the Sheet foundation,
validation rules, template system, approval controls, duplicate
protection, and logging -- with **all live sending disabled**.

| Phase | Status |
| --- | --- |
| 1. Project foundation | Done |
| 2. Sheet outreach layer (tabs + menu) | Done |
| 3. Property/agent verification rules | Done |
| 4. Template system | Done |
| 5. Eligibility and approval status flow | Done |
| 6. Gmail automation | Done, guarded off by default |
| 7. Google Voice preparation | Done, guarded off by default -- selectors are unverified against the live Google Voice UI, see the file's header comment |
| 8. Duplicate and suppression controls | Done |
| 9. Follow-up scheduling and handoff | **Not built yet.** The status flow supports `Follow-Up Due`, but nothing currently moves a `Contacted` row into it automatically -- that scheduling logic is future work |
| 10. Testing and launch | Steps 1-4 (validation, template rendering, duplicate prevention, suppression) are covered by `tests/`. Steps 5-9 (Gmail with an internal address, Google Voice with an internal number, log confirmation, pilot batch, production sign-off) are manual steps to run once this is deployed against a real Sheet and Google account |

Before flipping either live-sending switch, resolve everything in
`docs/OPEN_ITEMS.md`.

**Addendum (2026-07-23):** Redfin agent-contact scraping
(`src/redfin/`) and a no-per-message-approval auto-send path
(`apps-script/AutoSend.js`, `src/voice/autoSendGoogleVoiceMessage.js`)
were added on top of the above. They are additive and separately
gated -- the original manual/approved path above still works
unchanged. See `docs/AUTO_MODE_RISKS.md` for what changed, why, and
the residual risks (Redfin ToS, Google Voice automation risk, no
compliance review of auto-sent messages) that nothing in this repo
mitigates.

## Layout

```
shared/            Qualification rules, status flow, keys, template engine (Node + Apps Script)
templates/          Versioned message content (Phase 4)
apps-script/        Bound Apps Script project: Sheet tabs, menu, validation, Gmail send, auto-send
src/                Node.js: config, Sheets client, Outreach Queue actions, Redfin scraper, Playwright Google Voice (prep + auto-send)
app/                Electron control panel (graphical, no terminal) -- add/validate/submit/approve rows, run Redfin/Voice jobs
tests/              node:test coverage for shared/ and src/redfin/
scripts/            build-apps-script.js
docs/               Plan, architecture, template voice guidelines, open items, auto-mode risks
sample-data/        Example leads for exercising the rule engine locally
```

Full explanation in `docs/ARCHITECTURE.md`.

## Setup

### Tests (no external accounts needed)

```
npm install    # only needed for the Node/Playwright side, not the tests
npm test
```

### Apps Script (Sheet outreach layer)

`clasp login` requires a normal OAuth browser flow, which does not
work from a network-sandboxed remote session (Google's auth endpoints
get blocked at the network layer there) -- run this section from a
machine with regular internet access.

**If the target spreadsheet already has a bound script** (check
Extensions -> Apps Script -> the file list on the left): copy its
existing code into this repo under its own filename before doing
anything else, so `clasp push` (which replaces the *entire* remote
file set) doesn't delete it. This repo already does that for Bryan's
`FlipScoutSheet.js` -- if there's other code there too, add it the same
way and make sure it doesn't define a second top-level `onOpen()` (see
the comment above `buildOutreachMenu_()` in `Code.js` for why that
collides silently).

1. Open the actual spreadsheet -> **Extensions -> Apps Script**. This
   creates a bound script project (or opens the existing one).
2. In that project's **Project Settings**, copy the Script ID.
3. `npm install -g @google/clasp && clasp login` (normal browser login).
4. `npm run build:apps-script` to copy `shared/*.js` into
   `apps-script/shared/` and regenerate `apps-script/Templates.js` from
   `templates/*.json`.
5. Point `apps-script/.clasp.json` (gitignored) at that Script ID --
   either `clasp clone <script-id> --rootDir ./apps-script`, or write
   `{"scriptId": "<script-id>", "rootDir": "."}` by hand.
6. `cd apps-script && clasp push`. `appsscript.json` now lists explicit
   `oauthScopes` (added for Bryan's `UrlFetchApp`/trigger calls) --
   expect a fresh Google consent screen on the next run of anything in
   the project, even functions that already ran before.
7. In the Apps Script editor's function dropdown (top toolbar, next to
   Run), select `setupOutreachSheets` and click **Run** once -- this
   creates the outreach tabs *and* installs the Outreach menu (as an
   installable trigger, so it doesn't collide with Bryan's own
   `onOpen()`). Approve the consent screen when prompted.
8. Reload the spreadsheet. Both the **Flip Scout** and **Outreach**
   menus should now appear, and Bryan's hourly refresh/KPI/rejected-leads
   logic should behave exactly as before. Fill in the `Settings` tab.

### Desktop control panel (`app/`)

A graphical, no-terminal front end for the Node side, plus an
Outreach Queue panel that mirrors most of the Apps Script menu so you
rarely need to switch to the Sheet.

- `npm run app` -- runs it as an Electron window (recommended).
- `npm run app:web` -- runs it as a local web page instead (`http://127.0.0.1:4747`), same functionality, no Electron build needed.
- `npm run dist:win` -- packages it into a standalone `.exe` (see `docs/ARCHITECTURE.md` for the packaging notes -- Windows needs an elevated shell and `CSC_IDENTITY_AUTO_DISCOVERY=false` the first time, to skip an irrelevant code-signing download that needs symlink privileges).

What it can do:
- **Add a row** to Outreach Queue (real lead or an internal test row) via a form.
- **Refresh validation / Submit for approval / Approve outreach** -- Node-side equivalents of those same Apps Script menu items, reusing the identical `shared/` rule engine.
- **Enrich agent contacts (Redfin)**, **Prepare/Auto-send Google Voice texts**, **Rebuild Apps Script files** -- same jobs as before.
- A live table of current Outreach Queue rows.

What it deliberately does **not** do: send Gmail. `GmailApp` in Apps
Script needs no separate OAuth setup; doing the same from Node would
require a whole new Gmail API OAuth flow, which wasn't worth building
for this pass. Click **Open Spreadsheet** in the app and use **Send
approved emails** there for that one step.

### Node.js (Sheets client + Google Voice prep)

1. `npm install`
2. `cp .env.example .env` and fill it in. Leave `ENABLE_EMAIL_SENDING`
   and `ENABLE_VOICE_AUTOMATION` as `false` until Phase 10 sign-off.
3. Set up a Google Cloud service account with Sheets API access, share
   the spreadsheet with its email, and point
   `GOOGLE_APPLICATION_CREDENTIALS` at its key file.
4. `npm run voice:prepare` -- with automation off, this only lists which
   `Approved` rows are ready; it does not open a browser. This script
   never clicks Send under any flag; see `docs/AUTO_MODE_RISKS.md` for
   `npm run voice:autosend`, the separate script that does.

## Safety

- Two independent switches gate all live sending (Sheet `Settings` tab
  and `.env`), both default to off -- see `docs/ARCHITECTURE.md`.
- `src/voice/prepareGoogleVoiceMessage.js` does not contain any code
  path that clicks Send, regardless of flags -- a human always reviews
  and sends manually there. `src/voice/autoSendGoogleVoiceMessage.js`
  is a separate script that does click Send, gated by
  `ENABLE_AUTO_SMS_SEND` (default `false`); see `docs/AUTO_MODE_RISKS.md`.
- `refreshValidation` only auto-advances rows earlier than `Pending
  Approval` -- once a row has rendered content pending human review, it
  won't be silently moved. `autoSendEligibleOutreach` (menu item) and
  `autoSendGoogleVoiceMessage.js` are separate, explicitly-named
  functions that intentionally skip that gate -- see
  `docs/AUTO_MODE_RISKS.md`.
- Every menu action is wrapped so a thrown error lands in the `Error
  Log` tab instead of failing silently.
- `src/redfin/scrapeRedfin.js` stops and logs on any detected
  block/CAPTCHA page rather than attempting to get around it -- but
  running it at all still carries a Redfin Terms of Use risk; see
  `docs/AUTO_MODE_RISKS.md`.
