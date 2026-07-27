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

## Second at-source path: MLSListings Pro Dashboard (fully in our control)

The feed path above depends on Juan adding the agent fields upstream. The
MLSListings path needs no one else: we pull the listing agent's contact
straight from our **own authenticated MLSListings Pro Dashboard**
subscription (`https://prodashboard.mlslistings.com/`), searched by
address. The agent's name/phone/email are on the MLS listing itself, so
this is at-the-source and reliable — and, unlike Redfin, it's a logged-in
session we're entitled to, not a bot fight.

Built exactly like the REI BlackBook enricher (same persistent-profile
login pattern, same write-back to the Outreach Review tab):

- `src/mlslistings/scrapeMlsListings.js` — `scrapeListingAgent(page, address)`
  searches by address, opens the listing, and reads the agent contact.
  `extractAgentContact()` is pure, text-pattern based, and unit-tested
  (`tests/mlsListings.test.js`).
- `scripts/login-mlslistings.js` (`npm run mlslistings:login`) — opens a
  visible window to log in once by hand (handles MFA/CAPTCHA); the session
  persists in `.mlslistings-profile/` (gitignored). Optional
  `MLS_USERNAME`/`MLS_PASSWORD` pre-fill the form but are never required.
- `src/outreach/actions.js#enrichFromMlsListings` (`npm run mlslistings:enrich`)
  — visits every queue row still missing a phone/email, fills it from the
  MLS listing, rate-limited by `MLS_SCRAPE_DELAY_MS`, best-effort per row,
  and mirrors results into the Outreach Review tab.

**Not yet production-ready:** the search/detail-page selectors are
`TODO(selectors)` placeholders until someone inspects the live logged-in
pages. Until they're filled in, `mlslistings:enrich` reports "not wired to
the live UI yet" per row — by design. It's also deliberately **not** wired
into the automation loop yet; run it manually first, confirm the
selectors, then wire it in. To finish it: log in, note the exact
search-by-address steps and where the agent name/phone/email appear on the
detail page, and drop those selectors into the marked spots.

**Compliance:** authenticated access to our own MLS subscription for
listing-agent contact (info the MLS shares with members to facilitate
transactions). Keep it to that — rate-limited, one lead at a time, no bulk
export or redistribution — and respect MLSListings' Terms of Use.

## Redfin scraper status

`src/redfin/` (the in-app Playwright scraper) is **fallback-only** and is
not wired into the automation loop. Keep it as a cheap backstop; do not
build the pipeline around it. With Paragon-sourced contact in the feed,
neither it nor a paid data API (BatchData / REAPI / PropStream) should be
on the critical path.
