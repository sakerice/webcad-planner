#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const target = process.argv[2] || 'index.html';
const htmlPath = path.resolve(process.cwd(), target);
const html = fs.readFileSync(htmlPath, 'utf8');

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let checked = 0;
let failed = false;

function lineOf(offset) {
  return html.slice(0, offset).split(/\r\n|\r|\n/).length;
}

while ((match = scriptRe.exec(html)) !== null) {
  const attrs = match[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;

  const code = match[2];
  if (!code.trim()) continue;

  checked += 1;
  const startLine = lineOf(match.index);
  const tmp = path.join(os.tmpdir(), `webcad-html-script-${process.pid}-${checked}.js`);
  fs.writeFileSync(tmp, code, 'utf8');

  const result = spawnSync(process.execPath, ['--check', tmp], {
    encoding: 'utf8',
  });

  fs.rmSync(tmp, { force: true });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Script ${checked} starting near ${target}:${startLine} failed syntax check\n`);
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exit(1);
console.log(`Checked ${checked} inline script block(s) in ${target}`);
