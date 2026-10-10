// 壁・床・屋根をまとめて洋館風にする操作を、実物のページで通す。
//
// 見るもの: 確認の画面で外した部位は替わらない／それ以外は設定に入る／保存して開き直しても残る／
// Undo 1回で丸ごと戻る／設定欄の「素材」から1か所ずつ選び直せる／3D で例外が出ない。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP + '?preset=2f');
  await page.waitForSelector('.building-style-open', { timeout: 60000 });
  await page.waitForTimeout(800);
  const snapshot = () => page.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));

  await page.click('.building-style-open[data-asset-set="rpg-mansion"]');
  await page.waitForSelector('#asset-swap-modal input[data-style-part]');
  const parts = await page.locator('#asset-swap-modal input[data-style-part]').evaluateAll((els) => els.map((e) => e.dataset.stylePart));
  assert.deepEqual(parts, ['exterior', 'roof', 'interior', 'floor']);
  // 屋根だけ外して切り替える
  const roofBefore = await page.evaluate(() => JSON.stringify(ensureRoofAppearance().whole));
  await page.locator('#asset-swap-modal input[data-style-part="roof"]').uncheck();
  await page.click('#asset-swap-modal .asset-swap-apply');
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const ext = ensureExteriorWallSettings(), ins = ensureInteriorWallSettings();
    return {
      ext1: ext.floors[1].texture, ext2: ext.floors[2].texture, extLinked: [ext.whole.linked, ext.floors[1].linked],
      roof: JSON.stringify(ensureRoofAppearance().whole),
      interior: ins.whole.texture,
      tiled: Object.values(ins.faces).filter((f) => f.mode === 'custom' && f.texture === 'mansion_white_subway_tile').length,
      floors: DATA.rooms.map((r) => [r.n, r.floorMaterial]),
      status: document.getElementById('asset-swap-status').textContent,
    };
  });
  assert.equal(after.ext1, 'mansion_ashlar_stone');
  assert.equal(after.ext2, 'mansion_brick_red');
  assert.deepEqual(after.extLinked, [false, true]);
  assert.equal(after.roof, roofBefore, 'チェックを外した屋根まで替わっている');
  assert.equal(after.interior, 'mansion_damask_wallpaper');
  assert.ok(after.tiled >= 10, `水まわりの面に白いタイルが入っていない (${after.tiled})`);
  const bath = after.floors.find(([n]) => n === '浴室');
  const bedroom = after.floors.find(([n]) => n === '主寝室');
  assert.equal(bath[1], 'mansion_marble_checker');
  assert.equal(bedroom[1], 'mansion_herringbone_oak');
  assert.match(after.status, /洋館風にしました/);

  // 設定欄の「素材」から2階だけサイディングに戻せる
  await page.evaluate(() => toggleExteriorColorPanel());
  const sel = page.locator('#exterior-wall-panel-body .preset-texture-select').nth(2);
  assert.equal(await sel.inputValue(), 'mansion_brick_red');
  // 3D の描き直しで欄が組み直されると、Playwright の「止まるまで待つ」が終わらないことがあるので、
  // 選択を変えて change を送る(画面で選んだときと同じ onchange が動く)
  await sel.evaluate((el) => { el.value = 'siding'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => ensureExteriorWallSettings().floors[2].texture), 'siding');
  await page.evaluate(() => hideWallPanel());

  // 3D に切り替えて例外が出ない（ヘッドレスではモデルの読み込みが終わらないことがあるので、待ち切らない。
  // ソフトウェア描画で重いので、画面の操作は先に 2D で済ませておく）
  await page.evaluate(() => setView('3d-ext'));
  await page.waitForTimeout(3000);
  await page.evaluate(() => setView('2d'));

  // 保存して開き直しても残る
  await page.evaluate(() => savePlanToStorage());
  await page.reload();
  await page.waitForFunction(() => window.DATA && DATA.walls.length > 4 && window._defaultPlanPending === false, null, { timeout: 60000 });
  const reloaded = await page.evaluate(() => ({
    ext1: DATA.exteriorWallSettings.floors[1].texture,
    interior: DATA.interiorWallSettings.whole.texture,
    bath: DATA.rooms.find((r) => r.n === '浴室').floorMaterial,
  }));
  assert.deepEqual(reloaded, { ext1: 'mansion_ashlar_stone', interior: 'mansion_damask_wallpaper', bath: 'mansion_marble_checker' });

  // Undo 1回で丸ごと戻る（新しいページで、切り替え直後に確かめる）
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(APP + '?preset=2f');
  await p2.waitForSelector('.building-style-open', { timeout: 60000 });
  await p2.waitForTimeout(800);
  const before2 = await p2.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));
  await p2.evaluate(() => BuildingStyle.apply(BuildingStyle.planFor('rpg-mansion')));
  assert.notEqual(await p2.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v))), before2);
  await p2.evaluate(() => undoAction());
  const undone = await p2.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));
  assert.equal(undone, before2, 'Undo 1回で元に戻らない');
  assert.ok((await snapshot()).length > 0);

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('壁・床・屋根の切り替え: 外した部位は残り、設定欄での選び直し・保存・開き直し・Undo も通った');
} finally {
  await browser.close();
}
