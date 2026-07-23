# Items to confirm before activation

From the automation plan's Phase 10. None of these block building or
testing the system with live sending disabled, but all of them must be
resolved before either live-sending switch (Settings tab "Enable Email
Sending" / "Enable Voice Automation", and the matching `.env` flags) is
turned on.

- [ ] New GitHub repository URL
- [ ] Official sender name and Gmail address (`Settings` tab / `SENDER_NAME`, `SENDER_EMAIL`)
- [ ] Google Voice account/number to automate against
- [ ] Correct handoff person: Juan, Cherry, or another team member (`Settings` tab / `HANDOFF_PERSON`)
- [ ] Verified years-in-business claim used in the initial email template
- [ ] Official Google review link and review count
- [ ] Approved buyer-agent compensation wording (templates currently omit compensation entirely -- see `docs/TEMPLATE_VOICE_GUIDELINES.md`)
- [ ] Follow-up intervals (1st and 2nd follow-up, in days)
- [ ] Who is authorized to click "Approve outreach" in the Sheet
