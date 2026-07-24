# Items to confirm before activation

From the automation plan's Phase 10. None of these block building or
testing the system with live sending disabled, but all of them must be
resolved before any live-sending `.env` flag (`ENABLE_EMAIL_SENDING`,
`ENABLE_VOICE_AUTOMATION`, `ENABLE_AUTO_SMS_SEND`) is turned on. All
sender identity fields live in `.env` now, not a Sheet tab.

- [x] New GitHub repository URL -- `github.com/lawrence755/Twin-Scout-Reach`
- [x] Official sender name and Gmail address -- `SENDER_NAME`, `SENDER_EMAIL` in `.env`
- [ ] Google Voice account/number to automate against -- login flow tested; confirm it's the intended business number, not a personal one
- [x] Correct handoff person -- `HANDOFF_PERSON` in `.env` (currently set to the same person as `SENDER_NAME` -- worth a second look, since the follow-up/final templates reference the handoff person in the third person right after the sender's own signature)
- [x] Verified years-in-business claim -- `YEARS_IN_BUSINESS` in `.env`
- [x] Official Google review link -- `GOOGLE_REVIEW_LINK` in `.env` (review *count* still unconfirmed)
- [ ] Approved buyer-agent compensation wording (templates currently omit compensation entirely -- see `docs/TEMPLATE_VOICE_GUIDELINES.md`)
- [ ] Follow-up intervals (1st and 2nd follow-up, in days) -- also note Phase 9 (automatic follow-up scheduling) isn't built yet regardless
- [ ] Who is authorized to click "Approve outreach" / "Send approved emails" in the app -- currently just whoever has the `.env` and `gmail-token.json` on their machine
