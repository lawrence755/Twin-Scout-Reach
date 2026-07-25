# Prompt for Claude Cowork (Redfin agent-contact crawl)

Copy everything below the line into your Cowork session.

---

I need help fetching real estate listing agent contact info from Redfin
listing pages and saving it into a Google Sheet, so it doesn't have to be
looked up by hand.

**Google Sheet**: https://docs.google.com/spreadsheets/d/10kBdkMqQ6_7xiLt8peF0WfU3R1Go8bOZnYiUmNFJSIA/edit

**Source tab**: `Flip Scout Leads` -- has an `Address` column and a
`Redfin Link` column. For every row that has a Redfin Link, open that
link and extract the listing agent's info.

**Destination tab**: `Redfin Agent Contacts` (already created, header row
already in place). Append one row per property, writing **each field
into its own separate cell/column** -- Address in column A, Redfin Link
in column B, Agent Name in column C, and so on, matching the existing
header row exactly. Do not combine multiple fields into one cell (e.g.
one tab- or comma-joined string in column A) -- that breaks both the
app that reads this tab and human readability in the sheet itself.
Columns, in order:

1. Address
2. Redfin Link
3. Agent Name
4. Agent Phone
5. Brokerage
6. DRE # (license number)
7. Agent Email (leave blank if the page doesn't show one)
8. Fetched At (timestamp of when you fetched it)

**Skip rows that already have a matching Address in `Redfin Agent
Contacts`**, unless you're deliberately refreshing stale data -- in that
case, update the existing row instead of adding a duplicate.

**Only ever write to the `Redfin Agent Contacts` tab.** Read from
`Flip Scout Leads` (Address, Redfin Link) but never write, edit, or add
anything to `Flip Scout Leads` or any other tab in this sheet
(`Outreach Status`, etc.). This data gets manually reviewed and verified
against the actual Redfin listing before anyone uses it for outreach --
it does not get used automatically, so keep it fully isolated in its own
tab until that review happens.

## Where to find this on the page

Redfin's "Listed by" section (near the top of the listing detail page)
follows this pattern -- confirmed against a real listing:

```
Listed by Ivan Chen Chen • DRE #01925240 • Compass • 650-375-1111 (broker)
```

Parse out Name, DRE #, Brokerage, and Phone from that line. Watch for:
- The phone number is sometimes labeled `(broker)` after it -- strip
  that suffix, just keep the digits/formatted number.
- Not every listing has all four fields -- leave whatever's actually
  missing blank rather than guessing.

## A real risk to know about, not to work around

Redfin has bot detection that reliably blocked a previous automated
attempt at this exact task (a Playwright script) -- it showed a "confirm
you're human" challenge page, and even after a human solved that
challenge once, the very next automated request got flat blocked again
(a CloudFront/WAF 403, not a challenge -- nothing to solve). This wasn't
one fluke; it was reproduced multiple times.

If you hit something similar -- a verification page, a 403, anything
that looks like it's trying to stop automated access -- **don't try to
bypass, evade, or work around it**. Stop on that listing, note it as
"blocked" or "couldn't fetch," and move on to the next one, or report
back which ones you couldn't get to. Getting some of them is fine;
forcing all of them isn't worth the risk to the business (Redfin's ToS
prohibits automated scraping, and this hasn't been legally reviewed).

---
