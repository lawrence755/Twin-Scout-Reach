# One-Hour Release Report — Flip Scout Outreach Automation

## What now works

- **Good Flip is the only trigger.** `Good Flip = Yes` starts the workflow
  with **no "Ready" gate**. `No` / blank / invalid never sends.
- **Contact resolution through the full source chain** — feed → REI BlackBook
  → MLS → enrichment → human research — stopping at the first source with a
  **valid** contact and recording which source won. No valid contact anywhere
  → the lead is parked in **MLS Assisted Research** (recoverable), never dropped.
- **Contact validation / hygiene before any send:** trims text, strips line
  breaks from addresses, normalizes phones, validates emails, **rejects
  URL-like agent names**, falls back to **"Hi there,"** when the first name
  isn't safe, and blocks unresolved template placeholders. No URL-as-a-name,
  no junk email/phone ever reaches an agent.
- **Recoverable statuses** (Processing, Invalid Data, Finding Contact, MLS
  Assisted Research, Ready to Send, Sending, Sent, Send Failed, Reply
  Received, Duplicate Prevented, Needs Review). A corrected lead re-enters the
  workflow; a failed send stays retryable; nothing is permanently rejected for
  temporarily-missing data.
- **Duplicate-send protection** via a key of normalized address + recipient +
  channel + stage. Already-sent → **Duplicate Prevented**, logged.
- **Kill switch** reads the `ENABLE_*` flags **live from `.env` on every send
  check** — flipping one off stops sending immediately, no restart. Leads
  still validate/resolve while sending is off (they stop at Ready to Send).
- **Contact-source tracking** stored on the lead and the outreach log (Feed /
  REI BlackBook / MLS / Enrichment / Human Research).
- **Startup environment display** — the app prints which integrations are
  configured and the live kill-switch state at boot (no secret values).

## Files changed

New:
- `shared/contactValidation.js` — pure hygiene/validation
- `shared/contactResolution.js` — pure source-chain resolver
- `src/outreach/goodFlipPipeline.js` — `decideOutreach` (pure) + `processGoodFlipLeads`
- `tests/contactValidation.test.js`, `tests/contactResolution.test.js`, `tests/goodFlipPipeline.test.js`
- `SECURITY_ACTION_REQUIRED.md`

Changed:
- `src/outreach/actions.js` — `runGoodFlipPipeline()` entry point (Good Flip → pipeline, no Ready gate)
- `app/automationLoop.js` — cycle now: transfer (visibility) → auto-queue → REI enrich/notes → **Good Flip pipeline** → REI replies/autosend → (opt) Voice. Ready-gate steps removed.
- `src/config/index.js` — `describeEnvironment()` / `startupReport()`
- `app/server.js`, `app/main.js` — print the startup report
- `.gitignore` — ignore `data/_backup_*/`, storage-state/session files

## Tests passed

**134 / 134** (`npm test`). New coverage: contact hygiene, URL-name rejection,
email/phone validation, source-chain resolution + fallbacks, and the full
`decideOutreach` decision matrix (trigger, invalid data, assisted research,
duplicate, kill switch, suppression, channel choice, re-entry, retryability).

## End-to-end results (controlled dry run, all sending OFF)

**14 / 14 checks passed** across the six required scenarios:
1. Good Flip + feed contact → resolves from **Feed**, ready to send.
2. No feed, REI contact → resolves from **REI BlackBook**.
3. Only MLS → resolves from **MLS**.
4. URL-like name + valid phone → sends by **SMS**, greeting "there"; invalid
   email+phone → **MLS Assisted Research** (never sends).
5. Previously-contacted lead → **Duplicate Prevented**.
6. Kill switch off → **nothing sent** (all leads stop at Ready to Send).

## Contact sources verified

- **Feed**, **REI BlackBook**, **MLS**, **Enrichment** precedence + human-research
  fallback — verified in unit + e2e tests.
- **Live MLS page extraction** is the one piece still needing a real captured
  page (see remaining issues).

## Outreach channels verified

- **Email** — inline send path proven live earlier (`npm run email:send-pipeline`
  delivered a real templated email); pipeline renders the approved
  `initial-email.v2` template and gates on `ENABLE_EMAIL_SENDING`.
- **SMS** — REI BlackBook send verified previously; the pipeline marks
  SMS-eligible leads Ready to Send for the existing SMS jobs.

## Reply routing verified

- `checkReplies` / `checkReiBlackBookReplies` route YES → Handed Off, NO/opt-out
  → Opted Out, else → Replied, and post to the **Google Chat webhook** (webhook
  delivery proven live earlier via `npm run` test). Replies update the lead.

## Remaining issues + exact next action

1. **Live MLS auto-extraction not finished.** Login + Matrix navigation are
   wired, but the search-result → listing-detail selectors need one real page.
   **Next action:** run `npm run enrichment:assisted` (you drive one search);
   it scrapes + saves the page HTML to `enrichment/captures/`. Share one
   capture → the automatic selectors get wired. Until then, MLS-only leads land
   in **MLS Assisted Research** (by design).
2. **Template wording sign-off** (commission language). **Next action:** approve
   wording; it drops into the templates in minutes. No invented legal text was added.
3. **Automated-texting compliance (TCPA).** **Next action:** confirm consent/quiet-hours
   policy before enabling SMS at scale.
4. **Credentials to rotate** — see `SECURITY_ACTION_REQUIRED.md`.

## Exact command to start the application

```
npm run app        # Electron desktop app (prints the environment report at boot)
# or, no packaging:
npm run app:web    # same UI at http://127.0.0.1:4747
```

## Exact steps to verify the production workflow

1. `npm run reiblackbook:login` and/or `npm run mlslistings:login` — sign in once (sessions persist).
2. Confirm a lead is marked **Good Flip = Yes** on the Flip Scout Leads sheet.
3. Start the app and open the **Automation** tab. The startup log shows the kill-switch state.
4. **Dry run first:** leave all `ENABLE_*` switches OFF in Settings, click **Start**.
   Watch the log: leads resolve a contact source and land at **Ready to Send**;
   the Dashboard and **Outreach Status** tab update; nothing is sent.
5. **Go live:** flip the channel's switch ON in Settings (takes effect immediately),
   Start again. Verify a real send in the agent's inbox and the **Sent** row in
   the communication log; confirm a reply posts to Google Chat.
6. Kill switch check: flip the switch OFF mid-run — the next send is blocked immediately.
