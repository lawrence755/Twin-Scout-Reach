# enrichment/ — MLSListings → Sheet → REI BlackBook

A small, modular Node + Playwright enrichment run: pull the listing
agent's contact from **MLSListings Pro Dashboard**, write it back to the
Sheet, and push it into **REI BlackBook** via a Zapier webhook.

## Flow

```
Flip Scout Leads  ──▶  rows missing agent phone/email        (sheets.js)
                       │
MLSListings login ─────┤  reuse saved session                (login.js)
                       ▼
  search by address ─▶ extract agent name/phone/email  (searchAndExtract.js)
                       │
   ┌───────────────────┴───────────────────┐
   ▼                                        ▼
Outreach Review tab  (sheets.js)     Zapier webhook  (blackbook.js)
                                     → REI BlackBook, tagged
                                       "Real Estate Agent"
```

## Files

| File | Responsibility |
| --- | --- |
| `index.js` | Orchestrates the run; per-row logging, best-effort error handling |
| `sheets.js` | Read "Flip Scout Leads", find rows needing enrichment, write to "Outreach Review" |
| `login.js` | Open MLSListings reusing the saved login profile |
| `searchAndExtract.js` | Search by address, extract agent name/phone/email |
| `blackbook.js` | POST `{ name, phone, email, address, source }` to the Zapier webhook |

The scraper core, sheet client, and config are shared with the main app
(`../src/…`) so selectors and credentials live in exactly one place — no
second copy to keep in sync, and it uses the repo's already-installed
dependencies (no separate `npm install`).

## Setup & run

1. Fill in `.env` (repo root) — `GOOGLE_SHEET_ID`,
   `GOOGLE_APPLICATION_CREDENTIALS`, and `ZAPIER_WEBHOOK_URL`. See
   `.env.example`.
2. Log into MLSListings once (persists the session; handles MFA/CAPTCHA):
   ```
   npm run mlslistings:login
   ```
3. Run the enrichment:
   ```
   npm run enrichment
   ```
   The browser is visible (`headless: false`) so you can watch.

## Not production-ready yet

The MLSListings **search and detail-page selectors are placeholders**
(`TODO(selectors)` in `../src/mlslistings/scrapeMlsListings.js`). Until
they're filled in from the live logged-in pages, step 3 reports "not wired
to the live UI yet" per row — by design. Provide the real search steps and
where the agent name/phone/email appear, and drop them into that one file;
everything here then works unchanged.

See `../docs/AGENT_CONTACT_SOURCING.md` for the full sourcing strategy.
