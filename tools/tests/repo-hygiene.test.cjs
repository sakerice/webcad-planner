// リポジトリの整理状態を守る検査。
// 一度きりの作業スクリプトや再開メモがルート直下に積もらないようにする。
// ルート直下に新しいファイルを置くときは、ここの許可リストに理由つきで足す。
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

// ルート直下に置いてよいファイル。
const ROOT_ALLOWED = [
  'AGENTS.md',
  'CLAUDE.md',
  'DESIGN.md',
  'build.sh',
  'index.html',
  'worker.mjs',
  'wrangler.toml',
  'wrangler.default-plans.toml',
  '.gitignore',
  // 静的アセットに付ける見出し(CSP の報告だけ)。Workers の静的アセットは dist/_headers を読むので、build.sh が写す。
  '_headers',
  // 無いパスに返す案内(wrangler.toml の not_found_handling = "404-page")。build.sh が dist へ写す。
  '404.html',
];

test('リポジトリ直下には決まったファイルだけがある', () => {
  const rootFiles = trackedFiles().filter((f) => !f.includes('/'));
  const unexpected = rootFiles.filter((f) => !ROOT_ALLOWED.includes(f));
  assert.deepEqual(
    unexpected,
    [],
    'ルート直下に許可リスト外のファイルがあります: ' + unexpected.join(', ')
  );
});

test('scripts/ ディレクトリは無い', () => {
  const inScripts = trackedFiles().filter((f) => f.startsWith('scripts/'));
  assert.deepEqual(inScripts, [], 'scripts/ に残っているファイル: ' + inScripts.join(', '));
});
