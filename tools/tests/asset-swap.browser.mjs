// 置いてある家具の一括差し替えを、実物のページで通す。
//
// 見るもの: 確認の一覧で外した物は替わらない／それ以外は替わる／Undo 1回で丸ごと戻る／
// 差し替えたプランを保存して開き直しても残る／3D で例外が出ない。
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
  await page.waitForSelector('.asset-swap-open', { timeout: 60000 });
  await page.waitForTimeout(800);
  const snapshot = () => page.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));
  const before = await snapshot();

  await page.click('.asset-swap-open[data-asset-set="rpg-mansion"]');
  await page.waitForSelector('#asset-swap-modal');
  const rows = await page.locator('.asset-swap-row input[type=checkbox]').count();
  assert.ok(rows >= 40, `差し替えの候補が少なすぎる (${rows})`);
  // 1つだけチェックを外す
  const kept = await page.locator('.asset-swap-row input').first().getAttribute('data-swap-id');
  await page.locator('.asset-swap-row input').first().uncheck();
  await page.click('.asset-swap-apply');
  await page.waitForTimeout(500);

  const after = await page.evaluate((kept) => ({
    keptType: (DATA.items.find((i) => String(i.id) === kept) || {}).type,
    mansion: DATA.items.filter((i) => /^rpg-mansion-/.test(i.type)).length,
    status: document.getElementById('asset-swap-status').textContent,
  }), kept);
  assert.ok(!/^rpg-mansion-/.test(after.keptType || ''), 'チェックを外した物まで替わっている');
  assert.ok(after.mansion >= rows - 1, `差し替わった数が足りない (${after.mansion} / ${rows - 1})`);
  assert.match(after.status, /点を洋館に差し替えました/);

  // 3D に切り替えて例外が出ない（ヘッドレスではモデルの読み込みが終わらないことがあるので、待ち切らない）
  await page.evaluate(() => setView('3d-int'));
  await page.waitForTimeout(4000);
  await page.evaluate(() => setView('2d'));

  // 保存して開き直しても残る
  await page.evaluate(() => savePlanToStorage());
  await page.reload();
  await page.waitForFunction(() => window.DATA && DATA.walls.length > 4 && window._defaultPlanPending === false, null, { timeout: 60000 });
  const reloaded = await page.evaluate(() => DATA.items.filter((i) => /^rpg-mansion-/.test(i.type)).length);
  assert.equal(reloaded, after.mansion, '保存して開き直すと、差し替えた家具が減っている');

  // Undo 1回で丸ごと戻る（新しいページで、差し替え直後に確かめる）
  const p2 = await context.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(APP + '?preset=2f');
  await p2.waitForSelector('.asset-swap-open', { timeout: 60000 });
  await p2.waitForTimeout(800);
  const before2 = await p2.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));
  await p2.evaluate(() => AssetSwap.apply(AssetSwap.planFor('rpg-mansion').filter((r) => r.action !== 'keep')));
  await p2.evaluate(() => undoAction());
  const undone = await p2.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v)));
  assert.equal(undone, before2, 'Undo 1回で元に戻らない');
  assert.ok(before.length > 0);

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log(`一括差し替え: ${rows}点の候補、外した物は残り、保存・開き直し・Undo も通った`);
} finally {
  await browser.close();
}
