# Session report: reply-verification pipeline, follow-up sequence, identity migration, dashboard UI (2026-07-24, continued)

Picks up after `docs/SESSION_REPORT_2026-07-24.md` (the git reconciliation /
Flip Quality verification / approval-gate bug). This covers everything
built and verified after that point, in the order it happened. Every
capability below was tested with **real sends and real replies**, not
just unit tests -- several genuine bugs were only found this way.

## 1. Gmail-based reply verification (`checkReplies()`)

New capability: detects when an agent replies to an outreach text, via
Google Voice's own "email me when I get a text" notification emails
(landing in whichever Gmail account is authorized), and auto-routes the
Outreach Queue row accordingly.

- **YES** reply -> row moves to `Handed Off`, human takes over
- **NO** / stop / unsubscribe language -> row moves to `Opted Out`
- Anything else -> `Replied`, left for a human to read
- **No reply for 3 days** -> `Follow-Up Due`

Real bug found and fixed: the sender-matching regex required the Gmail
"From" header to be *just* the bare address
(`15103945339.15107408898.xxx@txt.voice.google.com`), but real headers
include a display name (`"John Decena (SMS) <...>"`). The regex never
matched, so every real reply was silently discarded. Fixed by extracting
the address from angle brackets first. Verified against real reply
emails (parses "Received!" and "YES" correctly from actual raw Gmail
API payloads, not just samples).

New file: `src/gmail/gmailClient.js` gained `searchVoiceReplyEmails()`
(read access -- OAuth scope widened to include `gmail.readonly`
alongside the existing `gmail.send`).

## 2. Google Chat notifications

Incoming webhook (no OAuth) posts to a Chat space whenever `checkReplies()`
routes a YES or NO. Verified live -- both message types confirmed visible
in the actual space. Config: `GOOGLE_CHAT_WEBHOOK_URL` in `.env`.
Failures here never block the actual status routing (caught and reported
separately).

## 3. Follow-up send sequence -- the big gap from earlier is now closed

Previously, `checkReplies()` could detect silence and move a row to
`Follow-Up Due`, but **nothing ever sent the follow-up** -- the
`followup-sms`/`final-sms` templates existed but were never referenced
anywhere in the code.

Now `src/voice/autoSendGoogleVoiceMessage.js` picks the right template
based on a new `followupCount` field on each row:

| followupCount | Template sent | Next state |
| --- | --- | --- |
| (row just `Approved`) | `initial-sms` | `Contacted`, count 0 |
| 0 | `followup-sms` | `Contacted`, count 1 |
| 1 | `final-sms` | `Contacted`, count 2 |
| 2 (exhausted) | nothing sent | `Failed Contact` |

All four stages verified with real sends/receipts to a real phone,
including the exhaustion case (confirmed no browser even opens once the
sequence is used up). Confirmed a reply to the *final* message still
gets detected and routed correctly by `checkReplies()` -- reply-matching
is phone-number + time-window based, not tied to which template was sent,
so this needed no extra code.

## 4. Real bug: auto-send silently failed to deliver (race condition)

While testing the above, found that `voice:autosend` would log `Sent`
but the message never actually arrived. Root cause: `sendOne()` clicked
the Send button and returned immediately with no wait; for a
single-item batch, `main()`'s `context.close()` right after could kill
the browser before the click's async network request finished.
Playwright saw a successful click; the SMS never went out. Fixed by
adding a 3-second wait after the click. Verified by deliberately
reproducing the failure, then confirming the fix delivers reliably
across three separate real sends.

## 5. Email delivery -- verified for the first time

`sendApprovedEmails()` had working Gmail auth but had never been proven
to actually deliver (unlike SMS, which got the thorough real-send
treatment). Ran a real test row through the full pipeline and
**independently confirmed delivery** by searching the recipient's actual
inbox via the Gmail API directly (not just trusting the "Sent" log) --
sender, subject, and body all matched exactly.

## 6. Sheet integrations (read/write scope widened)

`src/sheets/sheetsClient.js`'s service-account scope widened from
`spreadsheets.readonly` to full `spreadsheets` (the Sheet must be shared
with the service account as **Editor**, not just Viewer -- confirmed
working).

- **"Contacted?" column** on the Flip Scout Leads tab (user-added
  column) -- mirrors `Handed Off` / `Following Up` / blank, matched by
  property address. Synced as part of `checkReplies()`.
- **New "Outreach Status" tab** -- auto-created (no manual setup
  needed), full-overwrite snapshot of every Outreach Queue row that has
  agent info: Address, Agent Name, Agent Phone, Status, Campaign,
  Contacted At, Days Since Contacted, Last Updated. Synced on **every**
  outreach action (add row, update row, refresh validation, submit,
  approve, send emails, check replies) -- verified live against the
  real Sheet.
- Real bug found and fixed along the way: `updateRow()` recomputed
  `contactKey` when the agent phone changed but never recomputed
  `outreachKey` -- meaning any lead added via "Add from Flip Scout"
  (which always starts with no phone) permanently kept a blank
  `outreachKey` once agent info was filled in later, and got falsely
  flagged as a duplicate. Fixed.

## 7. Identity migration: Lawrence -> Bryan Cadahing

The Google Voice number (510-394-5339) was reassigned via Google
Workspace admin from the personal account used for earlier testing to
`bryan@twinhomebuyer.com`. Re-authorized both integrations under Bryan's
account (old credentials backed up, not deleted):

- `.env`: `SENDER_NAME`/`HANDOFF_PERSON` -> "Bryan Cadahing",
  `SENDER_EMAIL` -> `bryan@twinhomebuyer.com`
- Gmail: old token backed up as `gmail-token-old-lawrence.json`,
  re-authorized fresh, confirmed via `gmail.users.getProfile()`
- Google Voice: old profile backed up as `.voice-profile-old-lawrence`,
  fresh login confirmed via the account label
  ("Bryan Cadahing, bryan@twinhomebuyer.com")

Full pipeline re-verified end-to-end under the new identity: real send
-> real reply -> auto-route -> Chat notification -> Sheet write-back,
all confirmed.

## 8. Dashboard UI redesign (in progress as context ran low)

Electron app (`app/`) redesigned from one long stacked page into a
proper tabbed dashboard:

- Window resized 960x720 -> 1280x840 (resizable, min 980x640)
- Tabs: **Dashboard** (live stat cards + status breakdown chips + quick
  actions), **Flip Scout Leads**, **Outreach Queue**, **Automation**
- Persistent Activity Log drawer at the bottom across all tabs
- Color-coded status badges on the Outreach Queue table (green Handed
  Off, red Rejected/Opted Out, yellow Contacted/Follow-Up Due, etc.)
- All existing element IDs/functionality preserved -- this was additive
  styling + a small amount of new JS (tab switching, dashboard stat
  computation), not a rewrite of the business logic wiring

Verified in-browser via the `app:web` fallback: tab switching works,
dashboard stats computed correctly from real data (9 rows, counts
matched exactly), status badges render with correct colors (confirmed
via computed styles, not just visual guess). **Not yet verified in the
actual packaged Electron app** -- only the browser-tab fallback so far.

## Outstanding from before, still true

- Buyer-agent compensation wording -- prompt written for Juan's AI at
  `docs/JUAN_COMPENSATION_WORDING_PROMPT.md`, waiting on his answer
- TCPA/compliance layer (consent tracking, quiet hours) -- still
  entirely unbuilt
- Redfin agent-contact enrichment -- still non-functional (Redfin's bot
  detection blocks it reliably; manual verification remains the real
  fallback)
- The `stash@{0}` from earlier today (Redfin scraper Chrome-profile
  experiments, concluded blocked) is still un-popped -- contains the
  older `REDFIN_AUTOMATION_SESSION_2026-07-23.md` write-up among other
  things, recoverable via `git stash show -p stash@{0}` if ever needed
