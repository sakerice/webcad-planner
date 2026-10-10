// カタログの「表示するセット」を実物のページで確かめる。
//
// なぜ要るか: 検索結果のカードに位置の基準が無く、「洋館」の札がすべて結果欄の
// 左上1か所に重なって、どのカードにも出ていなかった。単体のテストでは札の HTML は
// 正しく作られていて通る。**画面の上でカードの中に出ているか**は、ページで測るしかない。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const APP = process.env.APP_URL || 'http://localhost:8932/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP + '?preset=2f');
  await page.waitForSelector('#asset-set-picker', { timeout: 60000 });
  await page.waitForTimeout(800);
  const count = () => page.evaluate(() => Number((document.querySelector('.catalogue-count').textContent.match(/\d+/) || [0])[0]));

  const standardOnly = await count();
  assert.equal(await page.locator('.asset-set-mark').count(), 0, '標準だけのとき、見出しにセットの印が出ている');
  assert.equal(await page.locator('#sidebar [data-tool^="rpg-mansion-"]').count(), 0, '標準だけのとき、洋館の物が並んでいる');

  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../../assets/models/packs/rpg-mansion/manifest.json', import.meta.url), 'utf8'));
  // 扉(category「ドア」)は家具のカタログではなく、建具の「開き戸」「玄関ドアの扉」に並ぶ(標準の扉と同じ)。
  // 件数(.catalogue-count)は建具の選択肢も数えるので、扉も含めて増える
  const isDoor = (i) => i.category === 'ドア';
  const isWindow = (i) => i.category === '窓';   // 窓も建具の「窓」に並ぶ(家具の検索には出ない)
  const listed = manifest.items.filter((i) => !i.retired).length;
  const doorIds = manifest.items.filter((i) => !i.retired && isDoor(i)).map((i) => i.id);
  const doorTiles = () => page.evaluate(() => [...document.querySelectorAll('#opening-door-model-tools [data-tool^="opening-door-model:rpg-mansion-"]')].length);
  assert.equal(await doorTiles(), 0, '標準だけのとき、建具に洋館の扉が出ている');
  const retired = manifest.items.filter((i) => i.retired).map((i) => i.id);
  await page.click('.asset-set-option[data-asset-set="rpg-mansion"]');
  await page.waitForTimeout(400);
  assert.equal(await count(), standardOnly + listed, `洋館を足しても ${listed} 点増えない`);
  assert.equal(await doorTiles(), doorIds.length, `洋館を表示しても、建具に洋館の扉 ${doorIds.length} 点が出ない`);
  // カタログから外した版は並ばないが、登録は残っている（置いてあるプランが描ける）
  for (const id of retired) {
    assert.equal(await page.locator(`#sidebar [data-tool="${id}"]`).count(), 0, `${id}: カタログから外した版が並んでいる`);
    assert.ok(await page.evaluate((id) => !!getFmpItem(id), id), `${id}: カタログから外した版の登録が消えている`);
  }
  assert.ok(await page.locator('#fmp-furniture .asset-subhdr[title="チェア"] .asset-set-mark').count(), 'チェアの見出しに洋館の印が無い');

  // 検索結果のカードに、そのカードの中に札が出ていること
  await page.fill('#object-search-input', '洋館');
  await page.waitForTimeout(400);
  const placement = await page.evaluate(() => [...document.querySelectorAll('.catalogue-result[data-tool^="rpg-mansion-"]')].map((card) => {
    const badge = card.querySelector('.asset-set-badge');
    if (!badge) return 'no-badge';
    const c = card.getBoundingClientRect(), b = badge.getBoundingClientRect();
    return b.left >= c.left - 1 && b.top >= c.top - 1 && b.right <= c.right + 1 && b.bottom <= c.bottom + 1 ? 'inside' : 'outside';
  }));
  const windowCount = manifest.items.filter((i) => !i.retired && isWindow(i)).length;
  const searchable = listed - doorIds.length - windowCount;
  assert.equal(placement.length, searchable, `「洋館」の検索で ${searchable} 点出ない`);
  assert.deepEqual([...new Set(placement)], ['inside'], '検索結果の札がカードの中に出ていない: ' + [...new Set(placement)].join(','));
  await page.fill('#object-search-input', '');

  // 洋館だけを表示すると、洋館の物が無い見出しは出ない
  await page.click('.asset-set-option[data-asset-set="standard"]');
  await page.waitForTimeout(400);
  const emptyHeadings = await page.evaluate(() => [...document.querySelectorAll('#fmp-furniture .asset-subcat, #fmp-fixtures .asset-subcat')]
    .filter((s) => !s.querySelector('[data-tool^="rpg-mansion-"]')).length);
  assert.equal(emptyHeadings, 0, '洋館だけのとき、洋館の物が無い見出しが出ている');

  // 置いた洋館の家具は、表示を標準だけに戻しても描ける（登録は表示に関係なく残る）
  await page.click('.asset-set-option[data-asset-set="standard"]');
  await page.click('.asset-set-option[data-asset-set="rpg-mansion"]');
  await page.waitForTimeout(400);
  const still = await page.evaluate(() => { placeItem('rpg-mansion-chair-01', 3000, 3000); return !!getFmpItem('rpg-mansion-chair-01'); });
  assert.ok(still, '標準だけの表示に戻すと、洋館の家具の登録が消える');

  assert.deepEqual(errors, [], 'ページで例外: ' + errors.join(' / '));
  console.log('表示するセット: 切り替え・見出しの印・検索結果の札・空の見出しを出さないこと、を確かめた');
} finally {
  await browser.close();
}
