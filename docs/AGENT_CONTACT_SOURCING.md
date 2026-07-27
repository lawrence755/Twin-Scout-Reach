# Agent contact sourcing: Paragon-first, Redfin as fallback

## Decision

Stop relying on scraping Redfin for the listing agent's contact. Instead,
capture the agent's name/phone/email **on Paragon, at the moment Juan's
Flip Scout Agent flags the deal**, and carry it through the existing feed
into this app. Scraping (Redfin / REI BlackBook) is demoted to a
**fallback** used only when a lead arrives with no contact.

Why: the agent's name, phone, and email are already on the Paragon/MLS
listing the Flip Scout Agent is scraping to build the deal. Grabbing them
there is reliable and free; scraping Redfin afterward fights Redfin's bot
detection, which (per `docs/AUTO_MODE_RISKS.md`) reliably blocks the
automated browser even after a human clears the challenge.

## The data flow

```
Juan's Flip Scout Agent  (scrapes Paragon/MLS to build each deal)
   -> emits flip_scout/leads_for_sheets.json
   -> Bryan's Apps Script (apps-script/FlipScoutSheet.js) pulls that JSON
      hourly into the "Flip Scout Leads" tab
   -> this app reads that tab (src/sheets/sheetsClient.js)
```

Agent contact just needs to ride the same rails every other field already
uses.

## What each repo does

| Repo | Change | Status |
| --- | --- | --- |
| Juan's Flip Scout Agent | Emit `agent_name` / `agent_phone` / `agent_email` per lead in `leads_for_sheets.json` (blank `""` when a listing has none). | **Juan — not in this repo** |
| Bryan's Apps Script feed | Add three `COLUMNS` entries mapping those keys to headers `Agent Name` / `Agent Phone` / `Agent Email`. | **Bryan — `apps-script/FlipScoutSheet.js`** |
| This app | Read those columns and treat feed contact as authoritative; fall back to REI BlackBook / Redfin only when absent. | **Done** |

### Juan's agent — the one change that matters

```json
{
  "address": "...",
  "score": 0,
  "agent_name":  "Jane Smith",
  "agent_phone": "5551234567",
  "agent_email": "jane@brokerage.com"
}
```

### Bryan's Apps Script — `COLUMNS`

```js
{ key: 'agent_name',  header: 'Agent Name',  format: '@' },
{ key: 'agent_phone', header: 'Agent Phone', format: '@' },
{ key: 'agent_email', header: 'Agent Email', format: '@' },
```

## What changed in this app

- `src/sheets/sheetsClient.js` — `FLIP_SCOUT_HEADERS` now reads `Agent Name`
  / `Agent Phone` / `Agent Email` from the Flip Scout Leads tab **if the
  columns exist**. Absent columns are simply ignored, so this is safe to
  ship *before* the feed and Apps Script emit them — it starts working the
  moment they do, with no further app change.
- `src/outreach/actions.js` — new pure `resolveAgentContact(lead, redfinMatch)`
  helper encodes the trust order:
  1. Feed contact carried on the lead (Paragon-sourced) — authoritative.
  2. The REI link's agent name (name only).
  3. Cowork's "Redfin Agent Contacts" match — fallback only.
  Each field falls through independently. It's used by `addFromFlipScout`
  (queue rows), `syncGoodFlipLeadsToReview` (pre-fills the Outreach Review
  tab straight from the feed, no scrape needed), and surfaced by
  `listFlipScoutLeads`. Covered by `tests/resolveAgentContact.test.js`.

## Redfin scraper status

`src/redfin/` (the in-app Playwright scraper) is **fallback-only** and is
not wired into the automation loop. Keep it as a cheap backstop; do not
build the pipeline around it. If a stronger fallback is ever needed, a
third-party data API (BatchData / REAPI / PropStream) is more reliable than
fighting Redfin — but with Paragon-sourced contact in the feed, neither
should be on the critical path.
