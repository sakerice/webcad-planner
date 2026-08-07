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

test('天井面は階高でクランプされない', () => {
  const src = html.slice(html.indexOf('function roomCeilingHeightM'));
  const body = src.slice(0, src.indexOf('\n}') + 2);
  assert.doesNotMatch(body, /Math\.max\([^)]*FLOOR_H/,
    'the storey clamp is what makes ceilings below 2520mm unreachable');
});

// 上のテストは実測すると**変更前のコードでも通ってしまう**。`[^)]*` が
// `floorSlabHeightMForFloor(...)` の閉じ括弧を跨げず、元の
// `Math.max(mm*U+floorSlabHeightMForFloor(...),FLOOR_H*U)` に一致しないため。
// クランプが本当に消えたことは、本体に FLOOR_H が1つも残っていないことで押さえる。
test('roomCeilingHeightM の本体に FLOOR_H は残っていない', () => {
  const src = html.slice(html.indexOf('function roomCeilingHeightM'));
  const body = src.slice(0, src.indexOf('\n}') + 2);
  assert.doesNotMatch(body, /FLOOR_H/,
    'a room ceiling must not be clamped to the storey constant at all');
});

test('階高は HeightModel から読まれる', () => {
  assert.match(html, /HeightModel\.storyHeightMm\(/);
});

test('壁の高さは接する部屋の天井高の最大値を採る', () => {
  assert.match(html, /wallCeilingHeightM|maxAdjacentCeiling/);
});

test('隣家の階高は HeightModel を経由しない（設計対象外の別概念）', () => {
  const fn = html.slice(html.indexOf('function contextStoryHeightMm'),
                        html.indexOf('function contextStoryHeightM('));
  assert.doesNotMatch(fn, /HeightModel/);
});
