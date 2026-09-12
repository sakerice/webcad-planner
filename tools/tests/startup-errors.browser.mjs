// 起動時に JavaScript のエラーが出ないこと。**2回目の読み込みまで**見る。
//
// なぜ2回読むのか
// ----------------
// アプリの JS を index.html のインライン script から assets/js/ の外部ファイルへ
// 分けたとき、この形の不具合を1件出した。
//
//   plan-data.js の末尾が 2D 用スプライト画像の読み込みを始める
//   → 画像の onload が draw2d() を呼ぶ
//   → draw2d() は本体(index.html)側の drawDim() を使う
//
// インライン script 1枚だった頃は、そこに到達する時点で全部の関数がそろって
// いた。外部ファイルに分けると、script と script の合間にもイベントを処理
// できるので、**画像がブラウザのキャッシュに載っている2回目の読み込みだけ**
// 本体より先に draw2d() が走り、"drawDim is not defined" で落ちた。
//
// 1回目は画像の取得に時間がかかるので、まず再現しない。画面のスクリーン
// ショット比較でも見つからない(例外が出ても、その後の描画で絵は揃う)。
// 2回読んでエラーを数えるのが、いちばん確実で速い。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const url = process.env.APP_URL || 'http://localhost:8932/';
  for (const pass of ['1回目', '2回目（画像はキャッシュから）']) {
    errors.length = 0;
    await page.goto(url);
    await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
    await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
    // 遅れて走るものを拾うため、少し待ってから数える。
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    // 画像の取得失敗など、アプリの不良ではないものは除く。
    const real = errors.filter((m) => !/Failed to load resource|net::ERR_/.test(m));
    assert.deepEqual(real, [], pass + 'の読み込みでエラーが出ている');
  }

  // 本体側の関数が、外部ファイル側から実際に呼べる状態になっていること。
  const wired = await page.evaluate(() => ({
    draw2d: typeof draw2d,        // assets/js/draw-2d.js
    drawDim: typeof drawDim,      // index.html 本体
    ST: typeof ST,                // assets/js/app-state.js
    canvas: !!document.getElementById('c2d'),
  }));
  assert.deepEqual(wired, { draw2d: 'function', drawDim: 'function', ST: 'object', canvas: true });
  console.log('起動時のエラー: 2回とも0件');
} finally {
  await browser.close();
}
