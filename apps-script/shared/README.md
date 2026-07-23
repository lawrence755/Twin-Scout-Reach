# Generated directory

This directory is populated by `npm run build:apps-script`, which copies
every file from `../../shared/` in verbatim. Apps Script has no module
system and no filesystem access at deploy time, so the same rule-engine
files that Node.js `require()`s directly get physically copied in here
before `clasp push` uploads the whole `apps-script/` folder as one
project (all files share global scope regardless of folder nesting).

Do not hand-edit files in this directory -- edit `shared/*.js` instead
and re-run the build script. The copied `.js` files themselves are
gitignored so there is only ever one source of truth in git history;
only this README is tracked.
