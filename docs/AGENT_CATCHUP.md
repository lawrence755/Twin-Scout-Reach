# Catch-up doc for a new Claude Code session

Read this first if you're picking up this repo cold. It's a snapshot of
current state and hard-won lessons, not a narrative -- for the full story
of how things got here, read (in order) `docs/SESSION_REPORT_2026-07-24.md`
then `docs/SESSION_REPORT_2026-07-24-reply-pipeline.md`.

## What this repo is

Outreach automation for Twin Home Buyer: takes qualified leads from
Bryan's `Flip Scout Leads` Google Sheet tab (read-only, his own script
owns it), runs them through a local qualification/approval pipeline, and
sends SMS (Google Voice, Playwright-automated) and email (Gmail API)
outreach to listing agents. See `README.md` and `docs/ARCHITECTURE.md`
for the full picture.

**Everything outreach-related (queue, communication log, suppression
list) lives locally** in `data/*.json` via `src/outreach/store.js` --
NOT in the Sheet. Don't reintroduce Sheet-based outreach storage; that
was deliberately removed. The only sanctioned Sheet writes are the
"Contacted?" column and the "Outreach Status" tab (both one-way,
read-only-for-humans mirrors of local state).

## Current identity: Bryan Cadahing, not Lawrence

Everything (Gmail sending/reading, Google Voice number/texting) runs as
`bryan@twinhomebuyer.com` now -- the Voice number (510-394-5339) was
reassigned to his account via Google Workspace admin partway through
this project. `SENDER_NAME`/`HANDOFF_PERSON` in `.env` are "Bryan
Cadahing". Old Lawrence-era credentials are backed up (gitignored,
never committed) as `gmail-token-old-lawrence.json` and
`.voice-profile-old-lawrence/` if you ever need to compare.

## What's built and verified with real sends/replies (not just unit tests)

- Initial SMS + email outreach send
- Reply detection via Gmail (`checkReplies()`) -- reads Google Voice's
  own "new text message" notification emails, auto-routes YES -> Handed
  Off, NO/opt-out -> Opted Out, ambiguous -> Replied for a human
- Follow-up sequence: `followup-sms` then `final-sms`, then stops
  (`Failed Contact`) -- tracked via a `followupCount` field per row
- Google Chat webhook notifications on YES/NO
- "Contacted?" Sheet column + "Outreach Status" Sheet tab, synced on
  every outreach action
- Flip Quality filtering/badges in the app

## What's NOT done

- **Buyer-agent compensation wording** -- prompt is ready at
  `docs/JUAN_COMPENSATION_WORDING_PROMPT.md`, waiting on Juan's answer.
  Templates currently say nothing about compensation (hard rule, see
  `docs/TEMPLATE_VOICE_GUIDELINES.md`) -- don't add any without his
  sign-off.
- **TCPA/compliance layer** (consent tracking, quiet hours) -- entirely
  unbuilt. `docs/AUTO_MODE_RISKS.md` still flags this as unmitigated.
- **Redfin agent-contact scraping is non-functional** -- Redfin's bot
  detection reliably blocks it (confirmed via extensive live testing,
  documented in the stashed `REDFIN_AUTOMATION_SESSION_2026-07-23.md`,
  recoverable via `git stash show -p stash@{0}` if that stash is still
  there). Don't spend time trying to fix this without a fundamentally
  different approach in mind -- it's a dead end, not a bug.
- **Dashboard UI redesign** -- done in `app/public/{index.html,styles.css,
  renderer.js}` and verified in the browser-tab fallback (`app:web`),
  but **not yet verified in the actual packaged Electron app**. If you
  touch the UI next, check the real `.exe` too, not just the browser
  preview.

## Gotchas that cost real time -- don't rediscover these

1. **Never trust a "Sent" log by itself.** Multiple real bugs this
   session (a stale draft getting sent instead of fresh text, a race
   condition where the browser closed before the send's network request
   finished) all *looked* successful in the log but weren't. Always
   independently verify against the real target: read back the actual
   message thread, search the actual Gmail inbox, read back the actual
   Sheet cell -- whatever the action was supposed to affect.
2. **Google Voice's UI has no stable public selectors.** The working
   ones are documented with real, verified reasoning inline as comments
   in `src/voice/autoSendGoogleVoiceMessage.js` and
   `prepareGoogleVoiceMessage.js` -- e.g. why the recipient-suggestion
   click must be `getByRole('button', { name: /^send to/i })` and not a
   generic `<li>` match (the latter can accidentally click Google
   Voice's call-panel contact list and place a real phone call instead
   of sending a text -- this actually happened once). Read those
   comments before changing anything in that area.
3. **Playwright automation needs a pause after the final action, before
   closing the browser context.** Clicking Send (or similar) only
   kicks off an async network request; closing the browser immediately
   after can kill it mid-flight with no error.
4. **`.env` flags must be manually reset after live-send tests.**
   `ENABLE_EMAIL_SENDING` / `ENABLE_AUTO_SMS_SEND` default `false` for a
   reason -- flip them true only for a specific test, then flip back
   immediately after.
5. **The packaged Electron app needs manual file syncing.**
   `dist/win-unpacked/resources/app/` is a separate copy of `.env`,
   `service-account.json`, `gmail-oauth-client.json`, `gmail-token.json`,
   and any changed `src/`/`app/` files -- none of this is symlinked.
   After `npm run dist:win` (which wipes and regenerates
   `dist/win-unpacked/`), re-copy the credential files back in before
   testing the packaged app. `dist/` is gitignored -- don't expect it to
   already be there after a fresh clone/pull.
6. **A stash may still be sitting un-popped**: check `git stash list`.
   As of this doc, `stash@{0}` holds early Redfin-scraper experiments
   from before the Sheet-to-local-store architecture pivot -- safe to
   leave stashed or drop, per the note above.
