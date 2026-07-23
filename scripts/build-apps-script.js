#!/usr/bin/env node
/**
 * Prepares apps-script/ for `clasp push` by:
 *   1. Copying shared/*.js into apps-script/shared/ verbatim, so the
 *      rule engine has exactly one source of truth in git.
 *   2. Regenerating apps-script/Templates.js from templates/*.json,
 *      since Apps Script has no filesystem access to read them
 *      directly at runtime.
 *
 * This script never touches shared/ or templates/ -- it only reads
 * from them and writes into apps-script/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'shared');
const APPS_SCRIPT_SHARED_DIR = path.join(ROOT, 'apps-script', 'shared');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATES_OUTPUT = path.join(ROOT, 'apps-script', 'Templates.js');

function copySharedFiles() {
  fs.mkdirSync(APPS_SCRIPT_SHARED_DIR, { recursive: true });
  const files = fs.readdirSync(SHARED_DIR).filter((f) => f.endsWith('.js'));
  files.forEach((file) => {
    fs.copyFileSync(path.join(SHARED_DIR, file), path.join(APPS_SCRIPT_SHARED_DIR, file));
    console.log('copied shared/' + file + ' -> apps-script/shared/' + file);
  });
}

function templateIdFromFilename(filename) {
  // "initial-sms.v1.json" -> "initial-sms"
  return filename.replace(/\.v\d+\.json$/, '');
}

function regenerateTemplatesFile() {
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  const entries = files.map((file) => {
    const id = templateIdFromFilename(file);
    const contents = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8'));
    return "  '" + id + "': " + JSON.stringify(contents, null, 2).replace(/\n/g, '\n  ') + ',';
  });

  const output = [
    '/**',
    ' * GENERATED FILE -- do not hand-edit.',
    ' *',
    ' * Mirrors templates/*.json so Apps Script (which has no filesystem',
    ' * access) can render the same versioned templates Node.js reads',
    ' * directly from disk. Regenerate with `npm run build:apps-script`',
    ' * whenever a template file under templates/ changes.',
    ' */',
    'var TEMPLATES = {',
    entries.join('\n'),
    '};',
    ''
  ].join('\n');

  fs.writeFileSync(TEMPLATES_OUTPUT, output);
  console.log('regenerated apps-script/Templates.js from ' + files.length + ' template file(s)');
}

copySharedFiles();
regenerateTemplatesFile();
