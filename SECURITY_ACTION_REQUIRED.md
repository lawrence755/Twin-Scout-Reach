# SECURITY — ACTION REQUIRED

This file lists credentials that should be **rotated**, and the security
state of the repo. It intentionally contains **no actual secret values**.

## Scan result (repo)

- ✅ **No secrets are committed.** `git ls-files` shows no `.env`, tokens,
  service-account, OAuth client, browser profiles, or capture files tracked.
- ✅ **No credential literals** found in any tracked file.
- ✅ `.gitignore` covers: `.env`, `service-account.json`, `gmail-*.json`,
  all `*-profile/` browser sessions, `enrichment/captures/`, `data/*.json`
  and `data/_backup_*/`, `dist/`, storage-state/session files.

Secrets live only in local, gitignored files (`.env`, `service-account.json`,
`gmail-token.json`, and the persistent browser profiles) — and in the
packaged app's copy under `dist/win-unpacked/resources/app/`.

## Rotate these (exposed outside the repo)

These were shared in chat and/or captured by a Playwright recording during
setup. They were **not committed**, but treat them as exposed and rotate:

1. **REI BlackBook account password** — change it in REI BlackBook, then log
   in again via `npm run reiblackbook:login`.
2. **MLSListings account** (username + password) — change the password in
   MLSListings, then log in again via `npm run mlslistings:login`. If auto-
   login is used, update `MLS_USERNAME` / `MLS_PASSWORD` in your local `.env`
   (and the packaged app's `.env`) — never commit them.

After rotating, delete any leftover Playwright recording files from your
temp/scratch folder (they can contain typed credentials).

## Good practices already in place

- Credentials are read fresh from `.env` at runtime (`config.liveEnvValue`),
  never hard-coded in source.
- Logging masks/omits secrets — passwords, tokens, and cookies are never
  written to the communication log or console.
- Auto-login helpers read credentials from `.env` only and never print them.
