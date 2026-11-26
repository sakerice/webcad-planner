// 画面のスタイルシート(assets/app.css)が読めなかったときの動きを確かめる(headless)。
//   1. ずっと読めない: 理由と「再読み込み」が画面に出る(飾りの無い HTML と「読み込み中」のまま放置しない)
//   2. 最初の1回だけ読めない: 読み直して、ふつうの画面になる。知らせは出ない
//   3. ふつうに読める: 知らせは出ず、読み直しもしない
//
// sh tools/run_browser_tests.sh app-css-load-failure
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();

async function open(failFirst) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let asked = 0;
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    if (u.pathname === '/assets/app.css') {
      asked++;
      if (asked <= failFirst) return route.abort();
    }
    return route.continue();
  });
  await page.goto(APP, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => {
    const box = document.getElementById('app-css-failed');
    const loading = document.getElementById('app-loading');
    return {
      told: !!box,
      text: box ? box.textContent : '',
      button: box ? !!box.querySelector('button') : false,
      covers: box ? (() => { const r = box.getBoundingClientRect(); return r.width >= innerWidth && r.height >= innerHeight; })() : false,
      onTop: box ? box.contains(document.elementFromPoint(innerWidth / 2, 10)) : false,
      loadingPosition: getComputedStyle(loading).position,
    };
  });
  await context.close();
  return { asked, state };
}

try {
  const never = await open(99);
  assert.equal(never.asked, 2, '読み直しは1回だけ(計2回の要求)');
  assert.ok(never.state.told, '読めないままのとき、知らせが出る');
  assert.ok(/読み込めませんでした/.test(never.state.text) && never.state.button, '理由と「再読み込み」のボタンがある');
  assert.ok(never.state.covers && never.state.onTop, '知らせが画面全体を覆い、いちばん手前にある');

  const once = await open(1);
  assert.equal(once.asked, 2, '1回読み直す');
  assert.ok(!once.state.told, '読み直しで読めたら、知らせは出ない');
  assert.equal(once.state.loadingPosition, 'fixed', '読み直した CSS が当たっている');

  const fine = await open(0);
  assert.equal(fine.asked, 1, 'ふつうに読めたら、読み直さない');
  assert.ok(!fine.state.told, 'ふつうに読めたら、知らせは出ない');
  assert.equal(fine.state.loadingPosition, 'fixed', 'CSS が当たっている');
  console.log('ok app-css-load-failure');
} finally {
  await browser.close();
}
