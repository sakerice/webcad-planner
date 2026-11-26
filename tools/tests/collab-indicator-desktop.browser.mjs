// マウスの画面(PC)での、共同編集の表示(#collab-indicator。人数を出し、押すと共有のダイアログが開く)の検査。
//
// 確かめること:
//   1. 共同編集中でなければ出ない(灰色の「接続中」が帯に出たままにならない)。
//   2. 共同編集中は、上の帯を横に送らなくても見えている。画面と帯からはみ出さず、
//      帯のほかのボタン・階の欄・ロゴと重ならず、ほかのボタンは消えない。押すと共有のダイアログが開く。
//
// タッチ端末(iPad・スマートフォン)は touch-layout.browser.mjs が見る。
// 共同編集中の状態は、画面が読む値(SHARED.roomId・SHARED.people)を入れて renderSharedUi() で作る。
// サーバーへは何も送らない(/api は止めている)。
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 1440x900・1024x700 はマウス向けの画面(帯は1段で横に送る並び)。
// 760x700 は幅 768px 以下なのでスマートフォン向けの画面(帯は2段)になるが、マウスの PC でも窓を狭めるとこうなる。
const SIZES = [[1440, 900], [1024, 700], [760, 700]];

const browser = await chromium.launch();
const errors = [];
try {
  for (const [width, height] of SIZES) {
    const name = `pc ${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route(/\/api\//, (r) => r.fulfill({ status: 503, body: '{}' }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);

    const shown = () => page.evaluate(() => {
      const e = document.getElementById('collab-indicator'), r = e.getBoundingClientRect();
      return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0;
    });
    // 帯の中で出ている部品(共同編集の表示を除く)
    const others = () => page.evaluate(() => [...document.querySelectorAll('#toolbar .tbtn, #toolbar #floor-sel, #toolbar .brand-logo, #toolbar .brand-word')]
      .filter((el) => el.id !== 'collab-indicator' && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0)
      .map((el) => el.id || el.className || el.textContent.trim()));

    // 1. 共同編集中でなければ出ない
    assert.equal(await shown(), false, `${name}: 共同編集中でなければ、共同編集の表示は出ない`);
    const before = await others();

    // 2. 共同編集中
    await page.evaluate(() => { SHARED.roomId = 'DesktopLayoutTestRoom01'; SHARED.people = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]; renderSharedUi(); });
    assert.equal(await shown(), true, `${name}: 共同編集中は、共同編集の表示が出る`);
    assert.match(await page.evaluate(() => document.getElementById('collab-count').textContent), /3人で編集中/);
    assert.deepEqual(await others(), before, `${name}: 共同編集の表示を出しても、帯のほかの部品は消えない`);
    const g = await page.evaluate(() => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const me = document.getElementById('collab-indicator'), tb = document.getElementById('toolbar'), a = me.getBoundingClientRect(), hits = [];
      document.querySelectorAll('#toolbar .tbtn, #toolbar #floor-sel, #toolbar .brand-logo, #toolbar .brand-word').forEach((el) => {
        if (el === me || getComputedStyle(el).display === 'none') return;
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) hits.push(el.id || el.className || el.textContent.trim());
      });
      const top = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
      return { r: box(me), tb: box(tb), scrollLeft: tb.scrollLeft, hits, onTop: !!top && !!top.closest('#collab-indicator') };
    });
    assert.equal(g.scrollLeft, 0, `${name}: 帯は横に送っていない`);
    assert.ok(g.r.left >= 0 && g.r.right <= width && g.r.top >= 0 && g.r.bottom <= height, `${name}: 共同編集の表示が画面からはみ出している ${JSON.stringify(g.r)}`);
    assert.ok(g.r.left >= g.tb.left && g.r.right <= g.tb.right && g.r.top >= g.tb.top && g.r.bottom <= g.tb.bottom, `${name}: 共同編集の表示が上の帯からはみ出している ${JSON.stringify(g)}`);
    assert.deepEqual(g.hits, [], `${name}: 共同編集の表示が帯のほかの部品と重なっている`);
    assert.equal(g.onTop, true, `${name}: 共同編集の表示がほかの物の下に隠れている`);
    await page.locator('#collab-indicator').click();
    assert.equal(await page.evaluate(() => document.getElementById('share-overlay').classList.contains('show')), true, `${name}: 共同編集の表示を押すと共有のダイアログが開く`);

    // 共同編集をやめると、また出なくなる
    await page.evaluate(() => { closeShareDialog(); SHARED.roomId = ''; SHARED.people = []; renderSharedUi(); });
    assert.equal(await shown(), false, `${name}: 共同編集をやめると、共同編集の表示は消える`);
    await context.close();
  }
  assert.deepEqual(errors, [], 'ページでエラーが出ていない');
  console.log('collab-indicator-desktop: ok');
} finally {
  await browser.close();
}
