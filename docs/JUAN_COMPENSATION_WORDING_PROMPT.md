# Prompt for Juan (buyer-agent compensation wording)

Copy everything below the line into your conversation with Juan's AI.

---

I run outreach automation for Twin Home Buyer that texts/emails Bay Area
listing agents about direct, as-is cash offers on their sellers' properties
(sourced from our own lead-scoring tool, Flip Scout). I need your help
deciding on and drafting buyer-agent compensation wording for these
templates -- this has been deliberately left out until now, and I need
your actual business decision, not just generic advice.

## Why this matters right now

Since the 2024 NAR settlement, buyer-agent commission is no longer
automatically offered via MLS. When we reach out to a *listing* agent
(who represents the seller) about a *direct* off-market sale, they may
reasonably want to know: if they help make this deal happen, is there
any compensation for them, and if so, how much / on what terms?

Right now, every template below says nothing about this at all. Our own
internal voice guidelines (`docs/TEMPLATE_VOICE_GUIDELINES.md`) currently
have this as a hard rule: *"Templates must never state or imply a
guaranteed or specific buyer-agent commission/compensation amount... until
[approved] wording is confirmed, templates must not mention compensation
at all."* I need that wording now.

## Decisions I need from you

1. **Do we offer a buyer-agent commission / co-op fee on these direct
   deals at all?** If not, say so plainly and I'll leave the templates
   as-is.
2. **If yes: how much, and on what terms?** (Flat percentage, flat
   dollar amount, negotiable case-by-case, contingent on certain
   conditions, etc.) I need the actual number/policy, not a placeholder.
3. **How should this be phrased so it's compliant** -- no guaranteed
   promise if that's legally required, but still clear enough to be
   useful to the agent reading it.
4. **Which messages should mention it?** My guess: worth including in
   the initial email (more room, more detail-appropriate) and maybe the
   initial SMS (in a short form) -- not necessarily every follow-up
   message, to avoid sounding repetitive/pushy. Tell me if you'd rather
   handle it differently (e.g., only on request, only after they reply
   YES).

## Constraints to respect

- **Voice**: direct and practical, no filler/hype, Bay Area-specific,
  respectful that the agent represents the seller (ask, don't push).
  Never exaggerate, never state fake urgency, never guarantee a price/
  timeline.
- **SMS length**: keep any addition short -- these are texts, not emails.
  Look at the existing SMS body lengths below as your ceiling.
- **YES/NO reply protocol must stay intact** in every SMS template
  exactly as-is (`YES` = agent flagged for follow-up, `NO` = sequence
  stops immediately) -- don't disrupt that mechanic when adding
  compensation language.
- **Merge fields available**: `{{agentFirstName}}`, `{{propertyAddress}}`,
  `{{city}}`, `{{senderName}}`, `{{senderPhone}}`, `{{senderEmail}}`,
  `{{handoffPerson}}`, `{{companyWebsite}}`, `{{yearsInBusiness}}`,
  `{{googleReviewLink}}`. Add a new one (e.g. `{{buyerAgentCompRate}}`)
  only if you give me the actual value it should hold.

## Current templates (verbatim, nothing about compensation in any of them)

**initial-sms** (sent first):
> Hi {{agentFirstName}}, this is {{senderName}} with {{companyWebsite}}
> -- we buy homes directly in the Bay Area and noticed
> {{propertyAddress}} in {{city}}. Would your seller be open to a
> direct, as-is offer alongside anything else on the table? Reply YES
> if you'd like details, or NO if it's not a fit.

**initial-email** (sent alongside, if agent email is known):
> Subject: Interest in {{propertyAddress}}, {{city}}
>
> Hi {{agentFirstName}},
>
> My name is {{senderName}} with {{companyWebsite}}. We're a local Bay
> Area home buying company, and I came across your listing at
> {{propertyAddress}} in {{city}}.
>
> We work directly with homeowners who want a straightforward, as-is
> sale, and I wanted to check whether your seller would be open to
> discussing a direct offer alongside anything else you're currently
> evaluating.
>
> We've been buying homes in the Bay Area for {{yearsInBusiness}}, and
> you can see feedback from past sellers here: {{googleReviewLink}}.
>
> If this could be useful for your seller, I'd welcome a short call. If
> not, no problem at all -- just let me know and I won't follow up
> further.
>
> Thanks for your time,
> {{senderName}}
> {{senderPhone}}
> {{senderEmail}}
> {{companyWebsite}}

**followup-sms** (sent if no reply after ~3 days):
> Hi {{agentFirstName}}, following up on {{propertyAddress}} in
> {{city}}. Still checking whether your seller has interest in a direct
> offer -- no pressure either way. Reply YES to keep talking or NO and
> I'll close this out. -- {{senderName}}

**followup-email**:
> Subject: Following up: {{propertyAddress}}
>
> Hi {{agentFirstName}},
>
> Wanted to follow up on my note about {{propertyAddress}} in {{city}}.
> If your seller has already accepted an offer or isn't interested in a
> direct sale, that's completely fine -- just let me know and I'll
> close this out on my end.
>
> If it's still open, I'm happy to answer any questions about how we
> work.
>
> Thanks,
> {{senderName}}
> {{senderPhone}}
> {{senderEmail}}

**final-sms** (last message in the sequence, sent if still no reply):
> Hi {{agentFirstName}}, last check-in on {{propertyAddress}}. If now
> isn't the right time, no problem -- reply NO and I'll stop here. If
> you'd like to talk it through, reply YES. Thanks for your time. --
> {{senderName}}, {{companyWebsite}}

**final-email**:
> Subject: Last note on {{propertyAddress}}
>
> Hi {{agentFirstName}},
>
> This will be my last note on {{propertyAddress}} unless I hear back.
> If your seller's situation changes down the road, feel free to reach
> out -- {{senderPhone}} or {{senderEmail}}.
>
> If you ever have other Bay Area listings where a seller might want a
> direct, as-is offer, {{handoffPerson}} on our team is also a good
> contact.
>
> Thanks again for your time,
> {{senderName}}
> {{companyWebsite}}

## What I need back

For each template you think should change, give me the **exact full
replacement body/subject text** (not just the compensation sentence in
isolation) -- I'll version them as `v2` files and wire them in directly.
If a new merge field is needed, tell me its exact value/source too.

---
