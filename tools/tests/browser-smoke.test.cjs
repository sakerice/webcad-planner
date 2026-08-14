// ブラウザで実際に開く起動テスト。
//
// なぜ要るか: 用途セレクタを消したとき、それを動かしていた関数への呼び出しが
// 6か所生きたまま残った。階を切り替えるたびに ReferenceError で止まる状態だったが、
// tools/tests の 600 件は全部緑だった。あの関数はテスト側で差し替えられていたので、
// 呼び出しが残っていることを検出しようがない。**ページを開いてコンソールを見る**
// 以外にこの種の欠落を捕まえる方法が無い。
//
// ここで見るのは1つだけ: 普通の操作を一通りして、コンソールにエラーが出ないこと。
// 画面の中身は他のテストが見ているので、ここでは見ない。
//
// Playwright はこのリポジトリの依存ではない。見つからなければテストごと skip する
// （入っていない環境で赤くしても、その環境では直しようがない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync, readdirSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const PORT = 8793;   // 開発用サーバ(8788/8791)とぶつからない番号

// npx のキャッシュに置かれた playwright を拾う。プロジェクトに入っていればそちらが先。
function findPlaywright() {
  const local = join(ROOT, 'node_modules', 'playwright', 'index.mjs');
  if (existsSync(local)) return local;
  const cache = join(process.env.HOME || '', '.npm', '_npx');
  if (!existsSync(cache)) return null;
  for (const d of readdirSync(cache)) {
    const p = join(cache, d, 'node_modules', 'playwright', 'index.mjs');
    if (existsSync(p)) return p;
  }
  return null;
}

const PLAYWRIGHT = findPlaywright();

// 実ブラウザでの操作は子プロセスへ追い出す。ここ(CJS)から ESM の playwright を
// 直接読むと、入っていない環境で読み込み自体が落ちて他のテストまで巻き込む。
const SCRIPT = `
import { chromium } from ${JSON.stringify(PLAYWRIGHT || '')};
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 375, height: 780 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:${PORT}/index.html', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  // 普通の操作を一通り。ここを通る関数が消えていれば ReferenceError になる。
  onFloorChange(2); onFloorChange(1);
  setView('2d'); setView('3d-ext');
  await new Promise(s => setTimeout(s, 1200));
  setView('3d-int'); setView('3d-walk'); setView('3d-ext');
  await new Promise(s => setTimeout(s, 800));
  openUnityRenderModal(); closeUnityRenderModal();
  openVideoRenderDialog(); closeVideoRenderModal();
  openJisDrawingDialog && openJisDrawingDialog();
  closeJisDrawingDialog && closeJisDrawingDialog();
});
await page.waitForTimeout(500);
console.log(JSON.stringify(errors));
await b.close();
`;

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, opts);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

test('ブラウザで開いて普通に操作しても、コンソールにエラーが出ない', { skip: PLAYWRIGHT ? false : 'playwright が見つからない' }, async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  try {
    await new Promise((s) => setTimeout(s, 900));
    const r = await run(process.execPath, ['--input-type=module', '-e', SCRIPT], { cwd: ROOT });
    assert.equal(r.code, 0, 'ブラウザ側が落ちた:\n' + r.err.slice(0, 1200));
    const errors = JSON.parse(r.out.trim().split('\n').pop());
    assert.deepEqual(errors, [], 'コンソールにエラーが出ている:\n' + errors.join('\n'));
  } finally {
    server.kill();
  }
});
