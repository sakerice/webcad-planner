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

// type属性が無い/JavaScriptを指すものだけが実行されるスクリプト。
// importmapやJSONデータブロックはJSとして構文検査してはいけない。
const JS_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'module',
]);

function typeOf(attrs) {
  const m = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return '';
  return (m[2] || m[3] || m[4] || '').trim().toLowerCase();
}

function lineOf(offset) {
  return html.slice(0, offset).split(/\r\n|\r|\n/).length;
}

let skipped = 0;

while ((match = scriptRe.exec(html)) !== null) {
  const attrs = match[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;

  const type = typeOf(attrs);
  if (type && !JS_TYPES.has(type)) {
    skipped += 1;
    continue;
  }

  const code = match[2];
  if (!code.trim()) continue;

  checked += 1;
  const startLine = lineOf(match.index);
  // module はimport/exportを含み得るのでESMとして検査する(.jsだとCommonJS扱いで誤検出)
  const ext = type === 'module' ? 'mjs' : 'js';
  const tmp = path.join(os.tmpdir(), `webcad-html-script-${process.pid}-${checked}.${ext}`);
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
console.log(`Checked ${checked} inline script block(s) in ${target}` +
  (skipped ? ` (skipped ${skipped} non-JavaScript block(s))` : ''));
