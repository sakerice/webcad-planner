// 3Dの再構築が重いとき、操作は即座に返り、待っていることが画面に出ること。
//
// なぜ在るのか
// ------------
// 「3Dで一時的に非表示」を押しても、なかなか反映されない、という報告。
// 実測すると、押してから画面が戻るまで PC で 700ms 以上、その間なんの表示も
// 出ていなかった。再構築を先に画面へ返してインジケーターを出す仕組みは既に
// あったのに、入口が isTouchInputDevice() で始まっていて、マウスのPCでは
// 間取りがどれだけ大きくても同期のまま走っていた。
//
// grep では「触っている機械で実際に重いか」を測れないので、実物の
// ブラウザで間取りを読み、3Dを出し、押して、時計を見る。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.evaluate(() => { const m = document.getElementById('preset-choice-modal'); if (m) m.classList.remove('show'); });

  await page.evaluate((plan) => {
    window._defaultPlanPending = false;
    DATA = JSON.parse(JSON.stringify(plan));
    syncNorthFromPlan(); ensureObjectIds();
    ensureExteriorWallSettings(); ensureInteriorWallSettings();
    ensureRoofAppearance(); ensureFloorMetadata(); syncExteriorWallSettings();
    normalizeLegacyFurnitureItems(); clearEditHistory();
  }, PLAN);

  await page.evaluate(() => { setView('3d-int'); });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 120000 });
  // GLBが入りきるまで待つ。家具の入っていないシーンを測っても意味が無い。
  await page.waitForTimeout(4000);

  // 機械の速さで結果が変わらないようにする。「重いと分かっている」状態を作って
  // から押し、そのときの振る舞いだけを見る。閾値そのものの判定は
  // tools/tests/rebuild-indicator.test.cjs が数値で見ている。
  const r = await page.evaluate(() => {
    const el = document.getElementById('app-loading');
    el.classList.remove('show');
    _tablet3DRebuildQueued = false;
    _last3DRebuildMs = HEAVY_3D_REBUILD_MS + 1;
    const li = DATA.items.filter((i) => isLightItemType(i.type) && i.floor === ST.floor)[0];
    ST.selected = li;
    const t0 = performance.now();
    updateSelectedProp('hidden3D', true);
    const sync = performance.now() - t0;
    return { touch: isTouchInputDevice(), sync: sync, id: li.id,
             overlay: el.classList.contains('show'),
             text: document.getElementById('app-loading-text').textContent };
  });

  assert.equal(errors.length, 0, 'ページ内エラー: ' + errors.join(' / '));
  // 押した手が待たされないこと。再構築そのものは数百 ms かかる。
  assert.ok(r.sync < 100, '押してから戻るまで ' + r.sync.toFixed(0) + 'ms: 同期のまま走っている');
  assert.equal(r.overlay, true, '重い再構築なのにインジケーターが出ていない');
  assert.match(r.text, /3D/);
  // マウスのPCでも出ること（ここが touch 判定で閉じていたのが元の不具合）
  assert.equal(r.touch, false, 'この検査はマウス環境で走らせる前提');

  // 反映されること、そしてインジケーターが出しっぱなしにならないこと。
  let state = null;
  for (let i = 0; i < 60; i++) {
    state = await page.evaluate(() => ({
      show: document.getElementById('app-loading').classList.contains('show'),
      queued: _tablet3DRebuildQueued,
      last: Math.round(_last3DRebuildMs),
      visibility: document.visibilityState
    }));
    if (!state.show && !state.queued) break;
    await page.waitForTimeout(500);
  }
  assert.ok(state && !state.show && !state.queued,
    'インジケーターが消えない: ' + JSON.stringify(state));
  const applied = await page.evaluate((id) => {
    const li = DATA.items.filter((i) => i.id === id)[0];
    let lights = 0; sc3.traverse((o) => { if (o.isLight) lights++; });
    return { hidden3D: !!li.hidden3D, queued: _tablet3DRebuildQueued, lights: lights };
  }, r.id);
  assert.equal(applied.hidden3D, true);
  assert.equal(applied.queued, false, '再構築の予約が残ったまま');
  console.log('PASS 押してから戻るまで ' + r.sync.toFixed(0) + 'ms / インジケーターが出て消えた / ' +
    '再構築の実測 ' + state.last + 'ms');
} finally {
  await browser.close();
}
