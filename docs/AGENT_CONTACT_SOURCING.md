# Agent contact sourcing: Paragon feed, no Redfin scraping

## Decision

Stop scraping Redfin for the listing agent's contact. Instead, take the
agent's name/phone/email from **Juan's Flip Scout Agent feed** — the
Paragon-sourced JSON his agent already publishes — matched to each lead by
address. This is Juan's own recommendation: capture the agent on Paragon
when the deal is flagged, and let it ride the feed. Redfin/REI scraping is
demoted to a **fallback** used only for contacts the feed doesn't supply.

Why: the agent's name, phone, and email are already on the Paragon/MLS
listing the Flip Scout Agent scrapes to build the deal. Grabbing them there
is reliable and free; scraping Redfin afterward fights Redfin's bot
detection, which (per `docs/AUTO_MODE_RISKS.md`) reliably blocks the
automated browser even after a human clears the challenge.

**No changes to Bryan's Sheet or Apps Script are required.** We read the
feed directly, so the agent contact never has to become a Sheet column.

## The data flow

```
Juan's Flip Scout Agent  (scrapes Paragon/MLS to build each deal)
   -> publishes flip_scout/leads_for_sheets.json   (the feed)
        |                                   |
        |  (Bryan's Apps Script still       |  THIS app reads the agent
        |   pulls leads into the Sheet,     |  contact straight from the
        |   unchanged -- not our concern)   |  feed by address
        v                                   v
   "Flip Scout Leads" tab  --------->  this app merges feed contact onto
   (leads: address, score, ...)        each lead, then runs outreach
```

Lead data still comes from the Sheet (Bryan's curated set); only the agent
*contact* is looked up from the feed and merged on by address.

## What Juan needs to do (the one upstream change)

While the Flip Scout Agent is on the Paragon listing building a deal, also
capture the listing agent and add three fields to each lead object in
`leads_for_sheets.json` (blank `""` when a listing has none):

```json
{
  "address": "2745 Butters Dr",
  "score": 10,
  "agent_name":  "Jane Smith",
  "agent_phone": "5551234567",
  "agent_email": "jane@brokerage.com"
}
```

That's the whole upstream ask. The moment those fields appear in the feed,
this app starts using them — no further change here.

## What this app does (done)

- `src/feed/flipScoutFeed.js` — fetches the feed (`config.feed.flipScoutUrl`,
  overridable via `FLIP_SCOUT_FEED_URL`) and parses it into an
  address-keyed map of `{ agentName, agentPhone, agentEmail }`. The parse
  step is pure and unit-tested (`tests/flipScoutFeed.test.js`); the fetch
  is best-effort — an unreachable feed yields an empty map, never an error.
- `src/outreach/actions.js` —
  - `enrichLeadsWithFeedContact(leads)` merges feed contact onto each lead
    by address, without overwriting anything the lead already carries.
    Called by `listFlipScoutLeads`, `addFromFlipScout`, and
    `syncGoodFlipLeadsToReview` (which pre-fills the Outreach Review tab
    straight from the feed — no scrape needed).
  - `resolveAgentContact(lead, redfinMatch)` sets the trust order:
    1. Feed contact on the lead (Paragon-sourced) — authoritative.
    2. The REI link's agent name (name only).
    3. Cowork's "Redfin Agent Contacts" match — fallback only.
    Each field falls through independently. Covered by
    `tests/resolveAgentContact.test.js`.

## Redfin scraper status

`src/redfin/` (the in-app Playwright scraper) is **fallback-only** and is
not wired into the automation loop. Keep it as a cheap backstop; do not
build the pipeline around it. With Paragon-sourced contact in the feed,
neither it nor a paid data API (BatchData / REAPI / PropStream) should be
on the critical path.
