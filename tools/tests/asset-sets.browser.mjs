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

  await page.click('.asset-set-option[data-asset-set="rpg-mansion"]');
  await page.waitForTimeout(400);
  assert.equal(await count(), standardOnly + 55, '洋館を足しても 55 点増えない');
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
  assert.equal(placement.length, 55, '「洋館」の検索で 55 点出ない');
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
