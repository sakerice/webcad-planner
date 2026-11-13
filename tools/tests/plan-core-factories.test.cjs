// plan-core/factories.js の単体テスト。ctx は偽物で、グローバルには触らない。
// 今の mkWall / mkItem との1項目ずつの一致は、factories-golden(ブラウザ)が全種類で見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../assets/js/plan-core/factories.js');

function makeCtx(over) {
  let n = 0, calls = 0;
  const ctx = {
    calls: () => calls,
    newId: () => { calls++; return ++n; },
    catalog: {
      resolveType: (t) => t,
      defaultSize: () => ({ w: 900, d: 900 }),
      defaultColor: () => undefined,
      model: () => null,
      is: (kind, t) => ({
        light: t === 'light-x', contextExterior: t === 'neighbor-house',
        windowLike: t === 'window' || t === 'window-door',
        doorLikeOpening: t === 'door-front' || t === 'door-swing', doorPanel: t === 'door-swing',
      }[kind] || false),
      canSetElevation: () => false,
      applyLightDefaults: (it) => { it.lightOn = true; },
      contextExteriorHeight: () => 6000,
      contextFloors: () => 2,
      constants: { rulerThickness: 60, walkRouteThickness: 50, walkDefaultSpeed: 1.2 },
    },
    plan: {
      wallHeightForFloor: (f) => 2400 + f,
      floorRaiseForFloor: (f) => 100 * f,
      foundationHeight: () => 0,
    },
  };
  return Object.assign(ctx, over || {});
}

test('makeWall は既定の厚み120・色#888888・階1で作る', () => {
  const ctx = makeCtx();
  const w = F.makeWall({ x1: 0, y1: 0, x2: 1000, y2: 0 }, ctx);
  assert.deepEqual(Object.keys(w), ['id', 'x1', 'y1', 'x2', 'y2', 'floor', 'thick', 'color', 'texture',
    'textureFlipX', 'textureFlipY', 'texScale', '_texObj', 'wallBand', 'wallStyle', 'wallHeight', 'wallTopShape', 'wallTopSide']);
  assert.equal(w.thick, 120);
  assert.equal(w.color, '#888888');
  assert.equal(w.floor, 1);
  assert.equal(w.wallHeight, ctx.plan.wallHeightForFloor(1));
  const w2 = F.makeWall({ x1: 0, y1: 0, x2: 0, y2: 1000, floor: 2, thick: 90, color: '#123456' }, ctx);
  assert.deepEqual([w2.floor, w2.thick, w2.color, w2.wallHeight], [2, 90, '#123456', 2402]);
});

test('makeItem は newId を1回だけ呼ぶ', () => {
  const ctx = makeCtx();
  F.makeItem('bed-s', { x: 0, y: 0 }, ctx);
  assert.equal(ctx.calls(), 1);
  F.makeWall({ x1: 0, y1: 0, x2: 1, y2: 0 }, ctx);
  assert.equal(ctx.calls(), 2);
});

test('カタログに無い種類は 900×900・#ddd で作り、例外にしない', () => {
  const it = F.makeItem('no-such-type', { x: 5, y: 6 }, makeCtx());
  assert.deepEqual([it.type, it.w, it.d, it.color, it.rot, it.floor], ['no-such-type', 900, 900, '#ddd', 0, 1]);
  assert.deepEqual(Object.keys(it), ['id', 'type', 'x', 'y', 'rot', 'floor', 'modelFacingVersion', 'w', 'd', 'color',
    'flipX', 'flipY', 'textureFlipX', 'textureFlipY', 'sScale', 'sX', 'sY']);
});

test('引数の w・d・rot・floor は既定より優先される', () => {
  const it = F.makeItem('bed-s', { x: 0, y: 0, rot: 90, floor: 2, w: 500, d: 600 }, makeCtx());
  assert.deepEqual([it.rot, it.floor, it.w, it.d], [90, 2, 500, 600]);
});

test('窓は腰高900・高さ1200、掃き出し窓は腰高0・高さ2100', () => {
  const ctx = makeCtx();
  const a = F.makeItem('window', { x: 0, y: 0 }, ctx);
  assert.deepEqual([a.windowSill, a.windowHeight], [900, 1200]);
  const b = F.makeItem('window-door', { x: 0, y: 0 }, ctx);
  assert.deepEqual([b.windowSill, b.windowHeight], [0, 2100]);
});

test('ドアは高さ2000(玄関は2330)で、扉は開いた状態', () => {
  const ctx = makeCtx();
  const a = F.makeItem('door-swing', { x: 0, y: 0 }, ctx);
  assert.deepEqual([a.doorHeight, a.doorOpenState], [2000, 'open']);
  const b = F.makeItem('door-front', { x: 0, y: 0 }, ctx);
  assert.deepEqual([b.doorHeight, b.doorOpenState], [2330, undefined]);
});

test('モデル付きの種類は fmpId を持ち、色を外し、既定の高さを使う', () => {
  const ctx = makeCtx();
  ctx.catalog.model = (t) => (t === 'fmp-a' ? { defaultElevation: 1200 } : null);
  ctx.catalog.canSetElevation = () => true;
  const it = F.makeItem('fmp-a', { x: 0, y: 0 }, ctx);
  assert.deepEqual([it.fmpId, it.color, it.colorCustom, it.elev], ['fmp-a', null, false, 1200]);
  const m = F.makeItem('meter-box', { x: 0, y: 0 }, ctx);
  assert.equal(m.elev, 1600);
});

test('屋根・基礎つき階段・照明の追加項目', () => {
  const ctx = makeCtx();
  ctx.plan.foundationHeight = () => 600;
  assert.equal(F.makeItem('exterior-stair', { x: 0, y: 0 }, ctx).targetHeight, 600);
  assert.equal(F.makeItem('ramp', { x: 0, y: 0 }, makeCtx()).targetHeight, 450);
  const r = F.makeItem('roof', { x: 0, y: 0 }, ctx);
  assert.deepEqual([r.roofType, r.pitch, r.color], ['gable', 30, '#2a2a30']);
  const l = F.makeItem('light-x', { x: 0, y: 0 }, ctx);
  assert.deepEqual([l.lightOn, l.colorCustom], [true, true]);
});

test('makeRoom は id を渡せばそれを使い、無ければ rm_連番', () => {
  const ctx = makeCtx();
  const a = F.makeRoom({ x: 0, y: 0, w: 3000, d: 2000 }, ctx);
  assert.equal(a.id, 'rm_1');
  assert.deepEqual(Object.keys(a), ['id', 'type', 'x', 'y', 'w', 'd', 'floor', 'floorRaiseMm', 'textureFlipX', 'textureFlipY']);
  assert.deepEqual([a.floor, a.floorRaiseMm], [1, 100]);
  const b = F.makeRoom({ x: 0, y: 0, w: 1, d: 1, floor: 2, n: '洋室', id: 'rm_keep' }, ctx);
  assert.equal(b.id, 'rm_keep');
  assert.equal(ctx.calls(), 1);
  assert.deepEqual(Object.keys(b), ['id', 'type', 'x', 'y', 'w', 'd', 'floor', 'n', 'floorRaiseMm', 'textureFlipX', 'textureFlipY']);
  assert.equal(b.floorRaiseMm, 200);
});

test('plan-core はグローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-core/factories.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'nextId']) assert.ok(!src.includes(w), w + ' が残っている');
});
