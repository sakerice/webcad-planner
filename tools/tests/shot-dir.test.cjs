// 画面テストの撮影画像は git 管理外(output/test-shots)に出す。
//
// 以前は docs/quality-review に直接書いていて、テストを走らせるたびに
// 追跡中の画像が書き換わり、差分が汚れた。出力先は shotDir() に一本化する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const HELPER = pathToFileURL(path.join(HERE, 'shot-dir.mjs')).href;

async function load() {
  // 環境変数は import ごとではなく呼び出し時に読まれるので、同じモジュールでよい。
  return import(HELPER);
}

test('SHOT_DIR 未設定なら output/test-shots/<parts> を作って返す', async () => {
  const saved = process.env.SHOT_DIR;
  delete process.env.SHOT_DIR;
  try {
    const { shotDir } = await load();
    const dir = shotDir('shot-dir-selftest', 'b');
    assert.equal(dir, path.join(ROOT, 'output', 'test-shots', 'shot-dir-selftest', 'b'));
    assert.ok(fs.statSync(dir).isDirectory());
    fs.rmSync(path.join(ROOT, 'output', 'test-shots', 'shot-dir-selftest'), { recursive: true, force: true });
  } finally {
    if (saved !== undefined) process.env.SHOT_DIR = saved;
  }
});

test('SHOT_DIR があればそれを根にする', async () => {
  const saved = process.env.SHOT_DIR;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shotdir-'));
  process.env.SHOT_DIR = base;
  try {
    const { shotDir } = await load();
    const dir = shotDir('a', 'b');
    assert.equal(dir, path.join(base, 'a', 'b'));
    assert.ok(fs.statSync(dir).isDirectory());
  } finally {
    if (saved === undefined) delete process.env.SHOT_DIR; else process.env.SHOT_DIR = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('画面テストは docs/quality-review へ書き込まない', () => {
  // 画像を「読む」(比較する)側は許す。書き込みの目印: screenshot の path、
  // writeFile*、mkdirSync、出力先を表す変数(dir/out)への代入に docs/quality-review が現れる行。
  // 文字列だけで読み書きを完全には区別できないので、書き込みの目印を含む行だけを見る。
  const files = fs.readdirSync(HERE).filter((f) => /\.browser\.(mjs|cjs)$/.test(f));
  const WRITE = /(screenshot|writeFile|writeFileSync|mkdirSync|copyFile|\bdir\s*=|\bout\s*=|path\s*:)/;
  const offenders = [];
  for (const f of files) {
    fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (line.includes('docs/quality-review') && WRITE.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'docs/quality-review へ書くテストがある。shotDir() を使うこと:\n' + offenders.join('\n'));
});
