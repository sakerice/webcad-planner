const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

test('height-model.js が読み込まれている', () => {
  assert.match(html, /<script src="assets\/js\/height-model\.js"><\/script>/);
});

test('既定値の定数は現行値のまま残っている（他の参照が壊れないように）', () => {
  assert.match(html, /var WALL_H = 2400;/);
  assert.match(html, /var FLOOR_H = 2700;/);
  assert.match(html, /var FLOOR_SLAB_H = 180;/);
});

test('部屋の天井高は HeightModel 経由で読まれる', () => {
  assert.match(html, /HeightModel\.ceilingHeightMm\(/);
});

test('隣家の階高は HeightModel を経由しない（設計対象外の別概念）', () => {
  const fn = html.slice(html.indexOf('function contextStoryHeightMm'),
                        html.indexOf('function contextStoryHeightM('));
  assert.doesNotMatch(fn, /HeightModel/);
});
