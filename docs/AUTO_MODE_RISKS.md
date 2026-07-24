# Auto Mode: what changed, why, and what it costs

On 2026-07-23, after the original milestone (this repo's first six
commits) was built, the following was explicitly requested and
confirmed:

1. Scrape agent phone/name automatically from each lead's Redfin
   listing link.
2. Send emails and texts automatically once a lead qualifies, with no
   per-message human approval or Send click.

Both are deliberate reversals of things the original plan (`docs/PLAN.md`)
stated explicitly:

> We will not modify Flip Scout's current scoring logic, **automate
> Redfin navigation**, or use REI BlackBook.

> **Human approval is required before the first email or text.** [...]
> The automation will never automatically click Google Voice's Send
> button.

This document exists so that trade-off is visible somewhere other than
a chat log. If anyone picks up this repo later without having seen that
conversation, they should read this before turning either capability on.

## What's still non-negotiable

Removing the *approval* step did not remove the *correctness* checks --
those were never about human judgment, they're data integrity and
compliance guards, and every auto-send path still runs all of them
before touching Gmail or Google Voice:

- Fresh Phase 3 qualification (`shared/qualification.js`)
- Suppression List lookup
- Duplicate outreach-key detection
- `Do Not Automate?` flag
- Missing/unresolved merge-field check on the rendered message
- The `ENABLE_EMAIL_SENDING` master switch (`.env` -- moved here from
  the Sheet's now-removed `Settings` tab during the later consolidation
  onto the local data store; see `docs/ARCHITECTURE.md`), still
  defaults to `false`
- `ENABLE_AUTO_SMS_SEND` (Node-side), still defaults to `false`, and is
  a *separate* switch from `ENABLE_VOICE_AUTOMATION` -- turning on
  voice automation alone still only prepares and stops before Send
  (`src/voice/prepareGoogleVoiceMessage.js` is unchanged)

**Note on the email side of this addendum:** the original no-approval
email path (`autoSendEligibleOutreach`, an Apps Script menu item) was
retired when the outreach data model moved off the Sheet entirely --
`sendApprovedEmails()` in `src/outreach/actions.js` (used by the app)
still requires a row to be `Approved` first, same as the original
plan. Only the SMS side (`autoSendGoogleVoiceMessage.js`) still has a
no-approval path. If a no-approval email path is wanted again, it
would need to be added back deliberately -- it isn't present right now.

## Residual risks that are NOT mitigated by anything in this repo

### Redfin scraping (`src/redfin/scrapeRedfin.js`)

- Redfin's Terms of Use prohibit automated scraping/bots. Running this
  against Redfin is a Terms of Use violation risk to the business, not
  just a technical one. It has not been reviewed by a lawyer.
- The scraper does not use any anti-detection technique (no stealth
  plugins, no proxy rotation, no CAPTCHA solving) and stops and logs
  instead of continuing when it detects a block/CAPTCHA page. That
  limits how far it goes, but does not remove the underlying ToS risk
  of running it at all.
- **Confirmed by real-world testing (2026-07-23):** the agent-name/
  phone parser itself works correctly once given real page content --
  the actual blocker is that Redfin's bot detection reliably blocks the
  automated browser, even immediately after a human manually clears
  its own verification challenge on a brand-new profile. This was
  tested across a plain HTTP fetch, headless Playwright, and headed
  Playwright with both a fresh and a real trusted Chrome profile -- all
  four hit the same block. This is not a fixable selector/timing bug;
  getting past it would mean fingerprint-spoofing or proxy rotation,
  which is out of scope (see above).
- The one still-open, legitimate path: `flip_scout_redfin.py` (a
  separate repo, Bryan's) already fetches these same listing detail
  pages successfully, on an hourly schedule, without getting blocked --
  because it's an established, already-trusted scraper, not a new bot.
  Adding agent-name/phone extraction to that existing fetch (using the
  same parsing logic already proven to work, in
  `src/redfin/parseAgentInfo.js`) is a fundamentally different, much
  lower-risk ask than anything tried against Redfin directly from this
  repo. That change has not been made -- it needs Bryan's review since
  it's his pipeline.

### Auto-sending SMS (`src/voice/autoSendGoogleVoiceMessage.js`)

- Automating clicks against Google Voice's web UI is not an
  officially supported integration path and may run against Google's
  own terms for automated use of their consumer products; it also
  risks the Google account being rate-limited or flagged.
- No human reviews the final message or recipient before it sends.
  A bug in qualification, template rendering, or a stale merge field
  could result in a real text going to a real real-estate agent with
  no one having seen it first.
- Unsolicited commercial text messages carry real regulatory exposure
  (TCPA and similar rules) that this repo does not implement any
  compliance logic for (consent tracking, quiet hours, opt-out
  language beyond the YES/NO protocol already in the templates). The
  original plan's manual-Send step was, among other things, a
  practical compliance backstop; removing it removes that backstop.
- This has not been tested against the live Google Voice UI at all --
  the selectors in the script are unverified.

## Where each mode lives

| Capability | Manual/approved (original plan) | Auto (this addendum) |
| --- | --- | --- |
| Agent contact info | Verified by hand in the app (Phase 3) | "Enrich agent contacts (Redfin)" button -- currently blocked by Redfin's bot detection, see above |
| Email | Approve outreach, then Send approved emails, both in the app | Not currently available -- retired during the later move off the Sheet; see the note above |
| SMS | `npm run voice:prepare` / the app's "Prepare Google Voice texts" button -- always stops before Send | `npm run voice:autosend` / "Auto-send Google Voice texts" button -- clicks Send, gated by `ENABLE_AUTO_SMS_SEND` |

The manual/approved path is the primary one and is fully intact. Auto
mode (SMS side only, currently) is additive and separately gated, so
it's possible to turn it on without affecting anything else, or to go
back to the manual path at any time by just not running the auto-send
script/button.
