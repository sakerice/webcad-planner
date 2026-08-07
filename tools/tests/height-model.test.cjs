// tools/tests/height-model.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const HeightModel = require('../../assets/js/height-model.js');

// ── 後方互換。ここが崩れたら既存プランのレンダが変わる ──
test('高さフィールドを持たないプランは現行の定数と完全に一致する', () => {
  const plan = { walls: [], rooms: [{ id: 'r1', floor: 1 }], items: [] };
  assert.equal(HeightModel.storyHeightMm(plan, 1), 2700);
  assert.equal(HeightModel.storyHeightMm(plan, 3), 2700);
  assert.equal(HeightModel.ceilingHeightMm(plan, plan.rooms[0]), 2400);
  assert.equal(HeightModel.DEFAULTS.floorSlabMm, 180);
});

test('plan が空でも room が undefined でも既定へ落ちる', () => {
  assert.equal(HeightModel.ceilingHeightMm(null, null), 2400);
  assert.equal(HeightModel.storyHeightMm(undefined, 2), 2700);
});

// ── 明示された値は尊重する ──
test('room.ceilingHeight は読まれる', () => {
  const room = { id: 'r1', floor: 1, ceilingHeight: 2200 };
  assert.equal(HeightModel.ceilingHeightMm({}, room), 2200);
});

test('room.ceiling.heightMm は room.ceilingHeight より優先される', () => {
  const room = { ceilingHeight: 2200, ceiling: { type: 'flat', heightMm: 2500 } };
  assert.equal(HeightModel.ceilingHeightMm({}, room), 2500);
});

test('floors[n].storyHeight は階ごとに読まれる', () => {
  const plan = { floors: { 1: { storyHeight: 3000 }, 2: {} } };
  assert.equal(HeightModel.storyHeightMm(plan, 1), 3000);
  assert.equal(HeightModel.storyHeightMm(plan, 2), 2700);
});

// ── 不正値は既定へ落とす。壊れたプランでレンダを壊さない ──
test('数値でない・0以下・NaN の天井高は既定へ落ちる', () => {
  for (const bad of ['2400', 0, -100, NaN, Infinity, null]) {
    assert.equal(HeightModel.ceilingHeightMm({}, { ceilingHeight: bad }), 2400,
      'ceilingHeight=' + JSON.stringify(bad) + ' should fall back');
  }
});

// ── 勾配天井 ──
test('flat な部屋の形状は単一の高さを返す', () => {
  assert.deepEqual(HeightModel.ceilingShape({}, { ceilingHeight: 2400 }),
    { type: 'flat', heightMm: 2400 });
});

test('sloped な部屋は低い側・高い側・向きを返す', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 180 } };
  assert.deepEqual(HeightModel.ceilingShape({}, room),
    { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 180 });
});

test('sloped で low > high なら入れ替えて返す（描画側で符号を気にせず済むように）', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 3600, highMm: 2200, direction: 0 } };
  const shape = HeightModel.ceilingShape({}, room);
  assert.equal(shape.lowMm, 2200);
  assert.equal(shape.highMm, 3600);
});

test('sloped だが寸法が欠けていれば既定の 2200-3600 になる', () => {
  const shape = HeightModel.ceilingShape({}, { ceiling: { type: 'sloped' } });
  assert.equal(shape.lowMm, 2200);
  assert.equal(shape.highMm, 3600);
  assert.equal(shape.direction, 0);
});

// ── 平面図に載せるラベル ──
test('flat のラベルは CH と高さ', () => {
  assert.equal(HeightModel.ceilingLabel({}, { ceilingHeight: 2400 }), 'CH 2400');
});

test('sloped のラベルは範囲と向きの矢印', () => {
  const room = { ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 } };
  assert.equal(HeightModel.ceilingLabel({}, room), 'CH 2200-3600 ↑');
});
