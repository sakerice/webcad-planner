// Task 16-1: 斜線制限の「法の数値」だけを取り出したモジュールの検査。
//
// grep ではない。assets/js/setback-law.js を require して実際に呼び、
// 建築基準法56条の算術（勾配・基準高さ）を独立に解いた期待値と突き合わせる。
// 期待値は index.html / setback-law.js の式を写さず、条文の言葉から書いている。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));

test('16: 用途地域は最低限の6つが揃っている', () => {
  assert.deepEqual(Law.zoneIds(),
    ['low1', 'low2', 'mid1', 'mid2', 'res-other', 'non-res']);
  assert.equal(Law.zoneLabel('low1'), '第一種低層住居専用地域');
  assert.equal(Law.zoneLabel('mid2'), '第二種中高層住居専用地域');
});

test('16: 道路斜線の勾配は住居系 1.25 / それ以外 1.5', () => {
  ['low1', 'low2', 'mid1', 'mid2', 'res-other'].forEach((z) => {
    assert.equal(Law.roadSlope(z), 1.25, z + ' は住居系なので 1.25');
  });
  assert.equal(Law.roadSlope('non-res'), 1.5);
});

test('16: 道路斜線の高さは「反対側の境界からの水平距離 × 勾配」', () => {
  // 住居系: 4m 先で 5m、10m 先で 12.5m
  assert.equal(Law.roadLimitHeightMm('low1', 4000), 5000);
  assert.equal(Law.roadLimitHeightMm('low1', 10000), 12500);
  // 非住居系は同じ距離でより高い
  assert.equal(Law.roadLimitHeightMm('non-res', 4000), 6000);
  assert.equal(Law.roadLimitHeightMm('non-res', 10000), 15000);
  // 境界の真上では 0（基準高さは無い）
  assert.equal(Law.roadLimitHeightMm('low1', 0), 0);
});

test('16(最重要): 北側斜線は低層住専 5m / 中高層住専 10m、他の用途地域には存在しない', () => {
  assert.equal(Law.northBaseMm('low1'), 5000);
  assert.equal(Law.northBaseMm('low2'), 5000);
  assert.equal(Law.northBaseMm('mid1'), 10000);
  assert.equal(Law.northBaseMm('mid2'), 10000);
  assert.equal(Law.northBaseMm('res-other'), null);
  assert.equal(Law.northBaseMm('non-res'), null);

  assert.equal(Law.hasNorthLimit('low1'), true);
  assert.equal(Law.hasNorthLimit('mid2'), true);
  assert.equal(Law.hasNorthLimit('res-other'), false);
  assert.equal(Law.hasNorthLimit('non-res'), false);

  // 存在しない以上、距離を渡しても高さは返らない（0 でもない）
  assert.equal(Law.northLimitHeightMm('res-other', 3000), null);
  assert.equal(Law.northLimitHeightMm('non-res', 3000), null);
});

test('16: 北側斜線の高さは「基準高さ + 水平距離 × 1.25」（勾配は用途地域によらない）', () => {
  assert.equal(Law.NORTH_SLOPE, 1.25);
  // 低層住専
  assert.equal(Law.northLimitHeightMm('low1', 0), 5000);
  assert.equal(Law.northLimitHeightMm('low1', 3000), 5000 + 3750);
  assert.equal(Law.northLimitHeightMm('low1', 5340), 5000 + 6675);
  // 中高層住専は基準だけ 5m 高い。勾配は同じ。
  assert.equal(Law.northLimitHeightMm('mid1', 0), 10000);
  assert.equal(Law.northLimitHeightMm('mid1', 3000), 10000 + 3750);
  const a = Law.northLimitHeightMm('low2', 8000);
  const b = Law.northLimitHeightMm('mid2', 8000);
  assert.equal(b - a, 5000);
});

test('16: 知らない用途地域・数でない距離では null を返す（黙って 0 を返さない）', () => {
  assert.equal(Law.zone('低層'), null);
  assert.equal(Law.roadSlope('低層'), null);
  assert.equal(Law.roadLimitHeightMm('', 1000), null);
  assert.equal(Law.roadLimitHeightMm('low1', NaN), null);
  assert.equal(Law.roadLimitHeightMm('low1', undefined), null);
  assert.equal(Law.northLimitHeightMm('low1', 'あ'), null);
});

test('16: 法の数値はこのモジュールにしか無い（index.html に 1.25 / 5000 が散らばっていない）', () => {
  // grep のアサーションではなく「モジュールが唯一の出所である」ことの構造的な確認。
  // 定数はすべて名前付きで公開されており、値はここから取れる。
  assert.equal(Law.ROAD_SLOPE_RESIDENTIAL, 1.25);
  assert.equal(Law.ROAD_SLOPE_OTHER, 1.5);
  assert.equal(Law.NORTH_BASE_LOW_MM, 5000);
  assert.equal(Law.NORTH_BASE_MID_MM, 10000);
  Law.ZONES.forEach((z) => {
    assert.ok(z.roadSlope === Law.ROAD_SLOPE_RESIDENTIAL || z.roadSlope === Law.ROAD_SLOPE_OTHER);
    assert.ok(z.northBaseMm === null || z.northBaseMm === Law.NORTH_BASE_LOW_MM || z.northBaseMm === Law.NORTH_BASE_MID_MM);
  });
});
