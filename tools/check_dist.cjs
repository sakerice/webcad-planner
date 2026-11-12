#!/usr/bin/env node
// 配信物(dist)に、編集用ファイルが混ざっていないか調べる。
// 使い方: node tools/check_dist.cjs <dir>
// 混ざっていれば、見つけたパスを1行ずつ出して終了コード1。
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
if (!root) {
  console.error('使い方: node tools/check_dist.cjs <dir>');
  process.exit(2);
}

function isForbidden(name) {
  return name.endsWith('.blend') || name === '.DS_Store' ||
    name.endsWith('_preview.png') || name.endsWith('.py');
}

const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (isForbidden(e.name)) found.push(p);
  }
})(root);

if (found.length) {
  console.error('配信物に入れてはいけないファイルがあります:');
  for (const f of found) console.error(f);
  process.exit(1);
}
