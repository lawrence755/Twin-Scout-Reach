# Template Voice Guidelines

These rules apply to every file in `templates/`. Anyone editing or adding a
template must follow them, and any new version should be reviewed against
this checklist before it's approved for use.

## Voice

- Direct and practical -- no filler, no hype.
- Bay Area-specific -- reference the property's city/area, not generic
  "we buy houses" language.
- Property-specific -- always reference the actual address; never send a
  template that could apply to any listing anywhere.
- Respectful of the agent -- they represent the seller, not us. Ask, don't
  push.
- Relationship-building (mentioning other listings, offering to be a
  resource) only comes up in follow-up/final messages, after the current
  property has been discussed. Never lead with it.

## Hard rules (compliance)

Templates must **never** state or imply:

- An exaggerated promise ("guaranteed cash in 7 days!").
- Fake urgency ("offer expires today").
- A guaranteed offer, price, or closing timeline.
- A guaranteed or specific buyer-agent commission/compensation amount.
  Buyer-agent compensation wording is one of the items on the
  "confirm before activation" list (see `docs/OPEN_ITEMS.md`) -- until
  that wording is approved, templates must not mention compensation at
  all.

## SMS reply protocol

Every SMS template must make the `YES` / `NO` reply protocol obvious:

- `YES` -> agent is flagged for follow-up / handoff.
- `NO` -> the current outreach sequence stops immediately.
- Any explicit opt-out language in a reply (regardless of YES/NO) sets
  `Opted Out? = Yes` and suppresses all future outreach to that contact.

## Merge fields

| Field | Description |
| --- | --- |
| `agentFirstName` | Listing agent's first name |
| `propertyAddress` | Full street address of the property |
| `city` | Property city |
| `senderName` | Outreach sender's name |
| `senderPhone` | Outreach sender's phone |
| `senderEmail` | Outreach sender's email |
| `handoffPerson` | Person who takes over on a positive reply (e.g. Juan) |
| `companyWebsite` | Twin Home Buyer website |
| `yearsInBusiness` | Verified years in business claim |
| `googleReviewLink` | Verified Google review link |

Each template file declares its own `requiredFields` -- only the fields it
actually references. The template engine (`shared/templateEngine.js`)
refuses to render if any required field is missing or blank, so an
incomplete message can never reach the send step.

## Versioning

Templates are versioned in the filename (`initial-sms.v1.json`, etc.) and
inside the file's `version` property. Never edit an in-use template file
in place once it has sent live messages -- add a new version instead, so
the Communication Log's recorded `templateVersion` always points at
content that still exists and is unambiguous.
