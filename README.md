# Flip Scout Outreach Automation

An outreach system that picks up after Bryan adds or updates qualified
properties in the existing `Flip Scout Leads` Google Sheet: verification,
versioned templates, human approval, guarded Gmail sending, and a
Playwright-assisted (never-auto-send) Google Voice SMS prep step.

Flip Scout's own scoring logic, Redfin navigation, and REI BlackBook are
untouched -- this repo only adds a new set of tabs alongside the
existing sheet and a Node.js/Apps Script layer on top.

See `docs/PLAN.md` for the full plan this was built from, and
`docs/ARCHITECTURE.md` for how it maps onto this codebase.

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

## Layout

```
shared/            Qualification rules, status flow, keys, template engine (Node + Apps Script)
templates/          Versioned message content (Phase 4)
apps-script/        Bound Apps Script project: Sheet tabs, menu, validation, Gmail send
src/                Node.js: config, Sheets client, Playwright Google Voice prep
tests/              node:test coverage for shared/
scripts/            build-apps-script.js
docs/               Plan, architecture, template voice guidelines, open items
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

1. Install `clasp` and log in: `npm install -g @google/clasp && clasp login`.
2. Create or open the Apps Script project bound to the `Flip Scout Leads`
   spreadsheet, and put its script ID in `apps-script/.clasp.json`
   (gitignored -- copy from `clasp create --parentId <spreadsheet-id>`
   if the project doesn't exist yet).
3. Run `npm run build:apps-script` to copy `shared/*.js` into
   `apps-script/shared/` and regenerate `apps-script/Templates.js` from
   `templates/*.json`.
4. `cd apps-script && clasp push`.
5. Reload the spreadsheet. Use the new **Outreach** menu -> **Set up
   outreach tabs** first, then fill in the `Settings` tab.

### Node.js (Sheets client + Google Voice prep)

1. `npm install`
2. `cp .env.example .env` and fill it in. Leave `ENABLE_EMAIL_SENDING`
   and `ENABLE_VOICE_AUTOMATION` as `false` until Phase 10 sign-off.
3. Set up a Google Cloud service account with Sheets API access, share
   the spreadsheet with its email, and point
   `GOOGLE_APPLICATION_CREDENTIALS` at its key file.
4. `npm run voice:prepare` -- with automation off, this only lists which
   `Approved` rows are ready; it does not open a browser.

## Safety

- Two independent switches gate all live sending (Sheet `Settings` tab
  and `.env`), both default to off -- see `docs/ARCHITECTURE.md`.
- The Google Voice script does not contain any code path that clicks
  Send, regardless of flags. A human always reviews and sends manually.
- `refreshValidation` only auto-advances rows earlier than `Pending
  Approval` -- once a row has rendered content pending human review, it
  won't be silently moved.
- Every menu action is wrapped so a thrown error lands in the `Error
  Log` tab instead of failing silently.
