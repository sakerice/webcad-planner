// plan-core/operations.js の単体テスト。ctx は偽物で、グローバルには触らない。
// 画面の placeItem / delSel / updateSelectedProp との1項目ずつの一致は、
// 画面を包みに変えたあと operations-golden(ブラウザ)が見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../../assets/js/plan-core/operations.js');
const S = require('../../assets/js/plan-core/snap.js');
const PlanSettable = require('../../assets/js/plan-settable.js');

// plan-core-factories.test.cjs と同じ偽カタログ。
function makeCtx(over) {
  let n = 100;
  const ctx = {
    newId: () => ++n,
    catalog: {
      known: () => true,
      resolveType: (t) => t,
      defaultSize: (t) => (t === 'sofa' ? { w: 1800, d: 900 } : { w: 900, d: 900 }),
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
      wallHeightForFloor: () => 2400,
      floorRaiseForFloor: () => 0,
      foundationHeight: () => 0,
    },
  };
  return Object.assign(ctx, over || {});
}

function basePlan() {
  return {
    walls: [
      { id: 1, x1: 0, y1: 0, x2: 4000, y2: 0, floor: 1, thick: 120 },
      { id: 2, x1: 0, y1: 0, x2: 0, y2: 3000, floor: 1, thick: 120, locked: true },
    ],
    rooms: [
      { id: 'rm_a', type: 'room', x: 0, y: 0, w: 4000, d: 3000, floor: 1, n: '洋室' },
      { id: 'rm_lock', type: 'room', x: 5000, y: 0, w: 2000, d: 2000, floor: 1, locked: true },
    ],
    items: [
      { id: 10, type: 'sofa', x: 1000, y: 1000, w: 1800, d: 900, rot: 0, floor: 1 },
      { id: 11, type: 'bed-s', x: 3000, y: 2000, w: 1000, d: 2000, rot: 90, floor: 1, locked: true },
      { id: 12, type: 'window', x: 1000, y: -75, w: 1690, d: 150, rot: 0, floor: 1, windowSill: 900, windowHeight: 1200 },
      { id: 13, type: 'wood-fence', x: 0, y: 5000, w: 3000, d: 100, rot: 0, floor: 1, fenceHeight: 1600 },
      { id: 14, type: 'fmp-Sofa01', x: 0, y: 0, w: 1800, d: 900, rot: 0, floor: 1 },
      { id: 15, type: 'site-rect', x: -1000, y: -1000, w: 10000, d: 10000, rot: 0, floor: 1, siteSurface: 'grass' },
      { id: 16, type: 'light-x', x: 500, y: 500, w: 300, d: 300, rot: 0, floor: 1, elev: 2390 },
    ],
  };
}

function run(plan, ops, ctx) { return O.applyOperations(plan, ops, ctx || makeCtx()); }
function itemById(plan, id) { return plan.items.find((o) => o.id === id); }
function center(o) { return [o.x + o.w / 2, o.y + o.d / 2]; }

// ── 各操作の成功例 ───────────────────────────────────────────────────

test('OPS に10個の操作がある', () => {
  assert.deepEqual(Object.keys(O.OPS).sort(), ['addRoom', 'addWall', 'deleteObjects', 'moveObject', 'placeItem',
    'removeWall', 'renameRoom', 'resizeRoom', 'rotateObject', 'setProps'].sort());
});

test('addRoom は中心と寸法から北西の角を出し、roomId を使う', () => {
  const ctx = makeCtx({ roomId: () => 'rm_fixed' });
  const r = run(basePlan(), [{ op: 'addRoom', args: { name: '寝室', floor: 2, x: 3000, y: 2000, w: 2000, d: 1000 } }], ctx);
  assert.deepEqual(r.errors, []);
  const room = r.plan.rooms[2];
  assert.deepEqual([room.id, room.x, room.y, room.w, room.d, room.floor, room.n], ['rm_fixed', 2000, 1500, 2000, 1000, 2, '寝室']);
  assert.deepEqual(r.changedIds, ['rm_fixed']);
});

test('addRoom は roomId を省くと rm_連番、名前を省くと n を持たない', () => {
  const r = run(basePlan(), [{ op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000 } }]);
  const room = r.plan.rooms[2];
  assert.equal(room.id, 'rm_101');
  assert.equal(room.floor, 1);
  assert.ok(!('n' in room));
});

test('resizeRoom は省いた値を今のままにし、中心を保つ', () => {
  const r = run(basePlan(), [{ op: 'resizeRoom', args: { id: 'rm_a', w: 3000 } }]);
  const room = r.plan.rooms[0];
  assert.deepEqual([room.x, room.y, room.w, room.d], [500, 0, 3000, 3000]);
  assert.deepEqual(r.changedIds, ['rm_a']);
  const r2 = run(basePlan(), [{ op: 'resizeRoom', args: { id: 'rm_a', x: 5000, y: 6000, d: 2000 } }]);
  const room2 = r2.plan.rooms[0];
  assert.deepEqual([room2.x, room2.y, room2.w, room2.d], [3000, 5000, 4000, 2000]);
});

test('renameRoom は n を変える', () => {
  const r = run(basePlan(), [{ op: 'renameRoom', args: { id: 'rm_a', name: '書斎' } }]);
  assert.equal(r.plan.rooms[0].n, '書斎');
  assert.deepEqual(r.changedIds, ['rm_a']);
});

test('addWall は makeWall で作る', () => {
  const r = run(basePlan(), [{ op: 'addWall', args: { x1: 0, y1: 3000, x2: 4000, y2: 3000, floor: 2, thick: 90 } }]);
  const w = r.plan.walls[2];
  assert.deepEqual([w.id, w.x1, w.y1, w.x2, w.y2, w.floor, w.thick, w.wallHeight], [101, 0, 3000, 4000, 3000, 2, 90, 2400]);
  assert.deepEqual(r.changedIds, [101]);
});

test('removeWall は壁を消し、afterDelete に消した id を渡す', () => {
  const seen = [];
  const ctx = makeCtx({ hooks: { afterDelete: (plan, ids) => seen.push(ids.slice()) } });
  const r = run(basePlan(), [{ op: 'removeWall', args: { id: 1 } }], ctx);
  assert.deepEqual(r.plan.walls.map((w) => w.id), [2]);
  assert.deepEqual(r.changedIds, [1]);
  assert.deepEqual(r.removedIds, [1]);
  assert.deepEqual(seen, [[1]]);
});

test('placeItem: 回転90・2000×800(既定寸法と違う)を中心(5000,5000)に置くと x:4000, y:4600', () => {
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'sofa', x: 5000, y: 5000, rot: 90, w: 2000, d: 800 } }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const it = r.plan.items[r.plan.items.length - 1];
  assert.deepEqual([it.id, it.type, it.x, it.y, it.w, it.d, it.rot, it.floor], [101, 'sofa', 4000, 4600, 2000, 800, 90, 1]);
  assert.deepEqual(r.changedIds, [101]);
});

test('placeItem: 寸法を省くと makeItem の寸法で角を出す', () => {
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'chair', x: 1000, y: 1000, floor: 2 } }]);
  const it = r.plan.items[r.plan.items.length - 1];
  assert.deepEqual([it.x, it.y, it.w, it.d, it.rot, it.floor], [550, 550, 900, 900, 0, 2]);
});

test('placeItem: 手順は openingPreset → canPlace → placeFloor → makeItem → 角 → 格子 → afterPlace → 追加', () => {
  const calls = [];
  const ctx = makeCtx({
    snap: { grid: 100 },
    hooks: {
      openingPreset: (t) => { calls.push('preset:' + t); return t === 'tool:door' ? { type: 'door-swing', props: { windowKind: 'x' }, apply: (it) => { calls.push('apply'); it.w = 780; it.d = 780; it.doorFinish = 'bath-clear'; } } : null; },
      canPlace: (t, fl) => { calls.push('can:' + t + ':' + fl); return null; },
      placeFloor: (t, fl) => { calls.push('floor:' + t + ':' + fl); return { floor: 1, indoor: true }; },
      afterPlace: (it, plan) => { calls.push('after:' + it.x + ',' + it.y + ':' + plan.items.includes(it)); it.elev = 5; },
    },
  });
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'tool:door', x: 1234, y: 1234, floor: 2 } }], ctx);
  assert.deepEqual(r.errors, []);
  const it = r.plan.items[r.plan.items.length - 1];
  const grid = S.snapRectOriginToGrid(1234 - 390, 1234 - 390, 780, 780, 0, 100);
  assert.deepEqual(calls, ['preset:tool:door', 'can:door-swing:2', 'floor:door-swing:2', 'apply', 'after:' + grid.x + ',' + grid.y + ':false']);
  assert.deepEqual([it.type, it.x, it.y, it.w, it.d, it.floor, it.indoor, it.windowKind, it.doorFinish, it.elev],
    ['door-swing', grid.x, grid.y, 780, 780, 1, true, 'x', 'bath-clear', 5]);
  // 項目の並び: indoor → プリセットの項目 → apply が足した項目
  const keys = Object.keys(it);
  assert.ok(keys.indexOf('indoor') < keys.indexOf('windowKind') && keys.indexOf('windowKind') < keys.indexOf('doorFinish'));
});

test('placeItem: canPlace が理由を返したら置かない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const ctx = makeCtx({ hooks: { canPlace: () => '地面にしか置けません' } });
  const r = run(plan, [{ op: 'placeItem', args: { type: 'ac-outdoor', x: 0, y: 0, floor: 2 } }], ctx);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /地面にしか置けません/);
  assert.equal(r.plan, plan);
  assert.equal(JSON.stringify(plan), before);
});

test('placeItem: 物の端への吸着と階段の吸着を使う', () => {
  const plan = basePlan();
  // ソファ(id 10)の右端 2800 の近くに、幅 900 の物を置く: 右端が 2830 → 2800 に吸い付く。
  const ctx = makeCtx({ snap: { edges: true, edgeThreshold: 80 } });
  const r = run(plan, [{ op: 'placeItem', args: { type: 'chair', x: 2830 - 450, y: 1450 } }], ctx);
  const it = r.plan.items[r.plan.items.length - 1];
  const want = S.edgeSnap({ x: 2830 - 900, y: 1000, w: 900, d: 900, rot: 0 }, plan, { floor: 1, threshold: 80, excludeIds: [null] });
  assert.deepEqual([it.x, it.y], [want.x, want.y]);
  assert.equal(it.x + it.w, 2800);

  // 階段の部材は stairSnap を通る。partEdges を呼んだことで確かめる。
  let asked = 0;
  const ctx2 = makeCtx({ snap: { stair: true, stairPartEdges: () => { asked++; return []; } } });
  run(basePlan(), [{ op: 'placeItem', args: { type: 'stair', x: 0, y: 0 } }], ctx2);
  assert.ok(asked > 0);
});

test('placeItem: set で PlanSettable の項目を設定する', () => {
  const ctx = makeCtx({ settable: PlanSettable });
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'wood-fence', x: 0, y: 0, w: 2000, d: 100, set: { fenceHeight: 1200, fencePattern: 'vertical' } } }], ctx);
  assert.deepEqual(r.errors, []);
  const it = r.plan.items[r.plan.items.length - 1];
  assert.deepEqual([it.fenceHeight, it.fencePattern], [1200, 'vertical']);
});

test('moveObject: 中心で動かすと角は 中心 − 寸法の半分、回転していても同じ', () => {
  const plan = basePlan();
  plan.items[0].rot = 90;
  const r = run(plan, [{ op: 'moveObject', args: { id: 10, x: 5000, y: 5000 } }]);
  const it = itemById(r.plan, 10);
  assert.deepEqual([it.x, it.y, it.rot], [4100, 4550, 90]);
  assert.deepEqual(r.changedIds, [10]);
  const r2 = run(basePlan(), [{ op: 'moveObject', args: { id: 'rm_a', dx: 100, dy: -50 } }]);
  assert.deepEqual([r2.plan.rooms[0].x, r2.plan.rooms[0].y], [100, -50]);
});

test('moveObject: 壁は dx,dy だけで動かす', () => {
  const r = run(basePlan(), [{ op: 'moveObject', args: { id: 1, dx: 0, dy: 500 } }]);
  const w = r.plan.walls[0];
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2], [0, 500, 4000, 500]);
  const bad = run(basePlan(), [{ op: 'moveObject', args: { id: 1, x: 0, y: 500 } }]);
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0].message, /dx/);
});

test('rotateObject: rot は絶対値、by は足す。どちらも中心を保つ', () => {
  const plan = basePlan();
  const c0 = center(plan.items[0]);
  const r = run(plan, [{ op: 'rotateObject', args: { id: 10, rot: 90 } }]);
  const it = itemById(r.plan, 10);
  assert.equal(it.rot, 90);
  assert.deepEqual(center(it), c0);
  const r2 = run(r.plan, [{ op: 'rotateObject', args: { id: 10, by: 300 } }]);
  const it2 = itemById(r2.plan, 10);
  assert.equal(it2.rot, 30);
  assert.deepEqual(center(it2), c0);
  assert.deepEqual(r2.changedIds, [10]);
});

test('deleteObjects は壁・物・部屋を消し、changedIds と removedIds に入れる', () => {
  let synced = null;
  const ctx = makeCtx({ hooks: { afterDelete: (plan, ids) => { synced = ids.slice(); } } });
  const r = run(basePlan(), [{ op: 'deleteObjects', args: { ids: [10, 1, 'rm_a', 10] } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.ok(!itemById(r.plan, 10));
  assert.deepEqual(r.plan.walls.map((w) => w.id), [2]);
  assert.deepEqual(r.plan.rooms.map((x) => x.id), ['rm_lock']);
  assert.deepEqual(r.changedIds, [10, 1, 'rm_a']);
  assert.deepEqual(r.removedIds, [10, 1, 'rm_a']);
  assert.deepEqual(synced, [10, 1, 'rm_a']);
});

test('setProps props: アプリの欄名をそのまま書き、色を変えたら colorCustom を立てる', () => {
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 10, props: { color: '#ff0000', flipX: true } } }], makeCtx({ allowProps: true }));
  const it = itemById(r.plan, 10);
  assert.deepEqual([it.color, it.colorCustom, it.flipX], ['#ff0000', true, true]);
  assert.deepEqual(r.changedIds, [10]);
});

test('setProps props: 天井を変えると、天井付けの器具も changedIds に入る', () => {
  const plan = basePlan();
  let elev = 2400;
  const ctx = makeCtx({
    allowProps: true,
    hooks: {
      ceilingElevation: (room) => (room.ceiling ? room.ceiling.heightMm : elev),
      shiftCeilingFixtures: (room, delta, p) => { const l = p.items.find((o) => o.id === 16); l.elev += delta; return [16]; },
    },
  });
  plan.rooms[0].ceilingHeight = 2400;
  const r = run(plan, [{ op: 'setProps', args: { id: 'rm_a', props: { ceiling: { type: 'flat', heightMm: 2600 } } } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changedIds, ['rm_a', 16]);
  assert.equal(itemById(r.plan, 16).elev, 2590);
  assert.ok(!('ceilingHeight' in r.plan.rooms[0]));
});

test('setProps props: 既定へ戻した項目は受け口ごと消す', () => {
  const plan = basePlan();
  plan.items[0].stairTarget = 'level';
  plan.items[0].stairTo = '9';
  const r = run(plan, [{ op: 'setProps', args: { id: 10, props: { stairTarget: '' } } }], makeCtx({ allowProps: true }));
  const it = itemById(r.plan, 10);
  assert.ok(!('stairTarget' in it));
  assert.ok(!('stairTo' in it));
});

test('setProps set: 範囲外の数は端へ寄せて warnings に書く', () => {
  const ctx = makeCtx({ settable: PlanSettable });
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 1, set: { thick: 1000 } } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.plan.walls[0].thick, 400);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /thick/);
});

test('setProps set: 窓の高さは画面と同じ正規化を通る', () => {
  const ctx = makeCtx({ settable: PlanSettable });
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 12, set: { windowKind: 'fix', windowHeight: 3000 } } }], ctx);
  assert.deepEqual(r.errors, []);
  const it = itemById(r.plan, 12);
  // 壁の高さ 2400 − 50 = 2350 が上端。腰高 900 なので高さは 1450。
  assert.deepEqual([it.windowKind, it.windowSill, it.windowHeight], ['fix', 900, 1450]);
});

test('setProps set: 敷地の地面は siteSurface に書く', () => {
  const ctx = makeCtx({ settable: PlanSettable });
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 15, set: { surface: 'gravel' } } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(itemById(r.plan, 15).siteSurface, 'gravel');
  assert.ok(!('surface' in itemById(r.plan, 15)));
});

test('setProps set: 選択肢に無い値・知らない項目・引けない種類は errors', () => {
  const ctx = makeCtx({ settable: PlanSettable });
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const a = run(plan, [{ op: 'setProps', args: { id: 12, set: { windowKind: 'bogus' } } }], ctx);
  assert.equal(a.errors.length, 1);
  assert.match(a.errors[0].message, /windowKind/);
  assert.ok(a.errors[0].candidates.includes('sliding'));
  const b = run(plan, [{ op: 'setProps', args: { id: 10, set: { foo: 1 } } }], ctx);
  assert.equal(b.errors.length, 1);
  const c = run(plan, [{ op: 'setProps', args: { id: 14, set: { fenceHeight: 1000 } } }], ctx);
  assert.equal(c.errors.length, 1);
  assert.match(c.errors[0].message, /fmp-Sofa01/);
  const d = run(plan, [{ op: 'setProps', args: { id: 13, set: { fenceHeight: 1000, windowKind: 'fix' } } }], ctx);
  assert.equal(d.errors.length, 1);
  assert.ok(d.errors[0].candidates.includes('fenceHeight'));
  assert.equal(JSON.stringify(plan), before);
});

test('setProps set: ctx.settable が無ければ errors', () => {
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 1, set: { thick: 100 } } }]);
  assert.equal(r.errors.length, 1);
});

test('setProps set: 土間は hooks.set.floorLevel が無ければ errors、あれば任せる', () => {
  const plan = basePlan();
  const a = run(plan, [{ op: 'setProps', args: { id: 'rm_a', set: { floorLevel: 'doma' } } }], makeCtx({ settable: PlanSettable }));
  assert.equal(a.errors.length, 1);
  const ctx = makeCtx({ settable: PlanSettable, hooks: { set: { floorLevel: (room, v) => { room.floorRaiseMm = -300; return [room.id]; } } } });
  const b = run(plan, [{ op: 'setProps', args: { id: 'rm_a', set: { floorLevel: 'doma', floorMaterial: 'tile_floor' } } }], ctx);
  assert.deepEqual(b.errors, []);
  assert.deepEqual([b.plan.rooms[0].floorRaiseMm, b.plan.rooms[0].floorMaterial], [-300, 'tile_floor']);
});

// ── Review Focus 2: 全部か無しか ───────────────────────────────────

test('3件のうち2件めが失敗したら、渡したプランそのものを返し、1項目も変えない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const r = run(plan, [
    { op: 'moveObject', args: { id: 10, dx: 100, dy: 0 } },
    { op: 'moveObject', args: { id: 999, dx: 100, dy: 0 } },
    { op: 'deleteObjects', args: { ids: [1] } },
  ]);
  assert.equal(r.plan, plan);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(r.changedIds, []);
  assert.deepEqual(r.removedIds, []);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].index, 1);
  assert.equal(r.errors[0].op, 'moveObject');
});

test('成功したときは写しを返し、渡したプランは変えない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const r = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 100, dy: 0 } }, { op: 'deleteObjects', args: { ids: [1] } }]);
  assert.notEqual(r.plan, plan);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(r.changedIds, [10, 1]);
});

test('inPlace: 成功すれば渡したプランを直接変える', () => {
  const plan = basePlan();
  const r = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 100, dy: 0 } }], makeCtx({ inPlace: true }));
  assert.equal(r.plan, plan);
  assert.equal(plan.items[0].x, 1100);
});

test('inPlace: 失敗したら1項目も変えない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const ctx = makeCtx({ inPlace: true, settable: PlanSettable, allowProps: true });
  for (const op of [
    { op: 'moveObject', args: { id: 11, dx: 100, dy: 0 } },
    { op: 'deleteObjects', args: { ids: [10, 11] } },
    { op: 'setProps', args: { id: 13, set: { fenceHeight: 1000, fencePattern: 'zigzag' } } },
    { op: 'setProps', args: { id: 11, props: { color: '#000', hidden3D: true } } },
    { op: 'placeItem', args: { type: 'sofa', x: 0, y: NaN } },
  ]) {
    const r = run(plan, [op], ctx);
    assert.equal(r.errors.length, 1, op.op);
    assert.equal(r.plan, plan);
    assert.equal(JSON.stringify(plan), before, op.op);
  }
});

test('inPlace で ops が2件なら errors', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const r = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 1, dy: 0 } }, { op: 'moveObject', args: { id: 10, dx: 1, dy: 0 } }], makeCtx({ inPlace: true }));
  assert.equal(r.errors.length, 1);
  assert.equal(JSON.stringify(plan), before);
});

// ── Review Focus 3: ロック ─────────────────────────────────────────

test('ロックした物は、動かす・回す・消す・大きさを変える・壁を消す・名前を変えるが errors', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  for (const op of [
    { op: 'moveObject', args: { id: 11, x: 0, y: 0 } },
    { op: 'rotateObject', args: { id: 11, by: 90 } },
    { op: 'deleteObjects', args: { ids: [11] } },
    { op: 'resizeRoom', args: { id: 'rm_lock', w: 1000 } },
    { op: 'renameRoom', args: { id: 'rm_lock', name: 'x' } },
    { op: 'removeWall', args: { id: 2 } },
    { op: 'setProps', args: { id: 11, props: { w: 500 } } },
  ]) {
    const r = run(plan, [op], makeCtx({ allowProps: true }));
    assert.equal(r.errors.length, 1, op.op);
    assert.match(r.errors[0].message, /ロック/, op.op);
  }
  assert.equal(JSON.stringify(plan), before);
});

test('ロック中でも locked・hidden3D・vis3D は変えられる', () => {
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 11, props: { hidden3D: true, vis3D: 'x' } } }], makeCtx({ allowProps: true }));
  assert.deepEqual(r.errors, []);
  assert.deepEqual([itemById(r.plan, 11).hidden3D, itemById(r.plan, 11).vis3D], [true, 'x']);
  const r2 = run(basePlan(), [{ op: 'setProps', args: { id: 11, props: { locked: false } } }], makeCtx({ allowProps: true }));
  assert.ok(!('locked' in itemById(r2.plan, 11)));
});

test('hooks.isLocked でロックの判定を差し替えられる', () => {
  const ctx = makeCtx({ hooks: { isLocked: (o) => o.id === 10 } });
  const r = run(basePlan(), [{ op: 'moveObject', args: { id: 10, dx: 1, dy: 0 } }], ctx);
  assert.equal(r.errors.length, 1);
});

// ── Review Focus 4: AI の誤り ───────────────────────────────────────

test('知らない種類は errors に入れ、catalog.suggest の候補を添える', () => {
  const ctx = makeCtx();
  ctx.catalog.known = (t) => t === 'sofa';
  ctx.catalog.suggest = (t) => ['sofa'];
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'sofaa', x: 0, y: 0 } }], ctx);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /sofaa/);
  assert.deepEqual(r.errors[0].candidates, ['sofa']);
});

test('無い id・NaN・0 以下の寸法・知らない op・配列でない ops は例外にせず errors', () => {
  const plan = basePlan();
  const cases = [
    [{ op: 'moveObject', args: { id: 999, dx: 1, dy: 1 } }],
    [{ op: 'deleteObjects', args: { ids: [10, 999] } }],
    [{ op: 'placeItem', args: { type: 'sofa', x: NaN, y: 0 } }],
    [{ op: 'placeItem', args: { type: 'sofa', x: '100', y: 0 } }],
    [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, w: 0 } }],
    [{ op: 'addRoom', args: { x: 0, y: 0, w: -1, d: 100 } }],
    [{ op: 'addWall', args: { x1: 0, y1: 0, x2: Infinity, y2: 0 } }],
    [{ op: 'rotateObject', args: { id: 10, rot: NaN } }],
    [{ op: 'resizeRoom', args: { id: 10, w: 100 } }],
    [{ op: 'removeWall', args: { id: 10 } }],
    [{ op: 'noSuchOp', args: {} }],
    [null],
  ];
  for (const ops of cases) {
    const r = run(plan, ops);
    assert.equal(r.errors.length, 1, JSON.stringify(ops));
    assert.equal(typeof r.errors[0].message, 'string');
    assert.equal(r.plan, plan);
  }
  for (const ops of [undefined, null, {}, 'moveObject']) {
    const r = run(plan, ops);
    assert.equal(r.errors.length, 1);
    assert.equal(r.plan, plan);
  }
});

test('hooks が例外を投げても外へ出さない', () => {
  const plan = basePlan();
  const ctx = makeCtx({ hooks: { afterPlace: () => { throw new Error('boom'); } } });
  const r = run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0 } }], ctx);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /boom/);
  assert.equal(r.plan, plan);
});

// ── applyProp ───────────────────────────────────────────────────────

test('applyProp: 窓の上端(windowTop)は高さに直して消す。hooks の正規化を使う', () => {
  const it = { id: 1, type: 'window', windowSill: 900, windowHeight: 1200, windowStd: 'x' };
  const calls = [];
  const ctx = makeCtx({ hooks: { windowSill: () => 800, normalizeWindow: (o, k) => calls.push(k) } });
  const res = O.applyProp(it, 'windowTop', 2000, { items: [it], walls: [], rooms: [] }, ctx);
  assert.deepEqual(res.changed, [1]);
  assert.equal(it.windowHeight, 1200);
  assert.ok(!('windowTop' in it));
  assert.ok(!('windowStd' in it));
  assert.deepEqual(calls, ['windowTop']);
});

test('applyProp: 外壁の色は hooks.prop に任せる', () => {
  const w = { id: 1, x1: 0, y1: 0, x2: 1, y2: 0 };
  const seen = [];
  const ctx = makeCtx({ hooks: { prop: { exteriorColor: (o, v) => seen.push(v) } } });
  O.applyProp(w, 'exteriorColor', '#123', { walls: [w], items: [], rooms: [] }, ctx);
  assert.deepEqual(seen, ['#123']);
  assert.equal(w.exteriorColor, '#123');
});

test('applyProp: 照明の色は color にも書く', () => {
  const l = { id: 1, type: 'light-x', color: '#fff' };
  O.applyProp(l, 'lightColor', '#f00', { items: [l] }, makeCtx());
  assert.deepEqual([l.color, l.colorCustom, l.lightColor], ['#f00', true, '#f00']);
});

// ── レビュー対応 ───────────────────────────────────────────────────

test('id は文字でも数でも同じ物を引く。同じ文字になる id が2つあれば errors', () => {
  const r = run(basePlan(), [{ op: 'moveObject', args: { id: '10', dx: 100, dy: 0 } }]);
  assert.deepEqual(r.errors, []);
  assert.equal(itemById(r.plan, 10).x, 1100);
  const plan = basePlan();
  plan.items[0].id = '10';
  const r2 = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 100, dy: 0 } }]);
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.plan.items[0].x, 1100);
  plan.items[1].id = 10;
  const r3 = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 100, dy: 0 } }]);
  assert.equal(r3.errors.length, 1);
  assert.match(r3.errors[0].message, /2 つ/);
});

test('無い id の message に、次にどうすればよいかを書く', () => {
  const r = run(basePlan(), [{ op: 'moveObject', args: { id: 999, dx: 1, dy: 0 } }]);
  assert.match(r.errors[0].message, /プランの要約にある id/);
});

test('存在しない階(99・0・1.5)は errors。範囲を message に書く。maxFloor で上限を変えられる', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  for (const floor of [99, 0, 1.5, 5]) {
    for (const op of [
      { op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, floor } },
      { op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000, floor } },
      { op: 'addWall', args: { x1: 0, y1: 0, x2: 1000, y2: 0, floor } },
    ]) {
      const r = run(plan, [op]);
      assert.equal(r.errors.length, 1, op.op + ' ' + floor);
      assert.match(r.errors[0].message, /1〜4/);
    }
  }
  assert.equal(JSON.stringify(plan), before);
  const ok = run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, floor: 5 } }], makeCtx({ maxFloor: 6 }));
  assert.deepEqual(ok.errors, []);
  const ng = run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, floor: 7 } }], makeCtx({ maxFloor: 6 }));
  assert.match(ng.errors[0].message, /1〜6/);
});

test('allowProps が無ければ props は errors', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const r = run(plan, [{ op: 'setProps', args: { id: 10, props: { color: '#000' } } }]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /props は使えません。set を使ってください/);
  const r2 = run(plan, [{ op: 'setProps', args: { id: 10, props: { color: '#000' } } }], makeCtx({ inPlace: true }));
  assert.equal(r2.errors.length, 1);
  assert.equal(JSON.stringify(plan), before);
});

test('allowProps でも id・__proto__・constructor・prototype は errors。set でも通らない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const ctx = makeCtx({ allowProps: true, settable: PlanSettable });
  // AI の JSON から来る形(JSON.parse は __proto__ を自前の項目として作る)。
  const evil = JSON.parse('{"__proto__": {"polluted": true}}');
  for (const props of [{ id: 77 }, evil, { constructor: 1 }, { prototype: 1 }, Object.assign(JSON.parse('{"__proto__": 1}'), { color: '#000' })]) {
    const r = run(plan, [{ op: 'setProps', args: { id: 10, props } }], ctx);
    assert.equal(r.errors.length, 1, JSON.stringify(Object.keys(props)));
    assert.match(r.errors[0].message, /書き換えられません/);
    const s = run(plan, [{ op: 'setProps', args: { id: 1, set: props } }], ctx);
    assert.equal(s.errors.length, 1);
  }
  assert.equal(JSON.stringify(plan), before);
  assert.equal(Object.getPrototypeOf(plan.items[0]), Object.prototype);
  assert.equal({}.polluted, undefined);
  // 入口が塞がっているので、プランの物は素のオブジェクトのまま。写しは別の物になる(同じ物を指さない)。
  const r = run(plan, [{ op: 'moveObject', args: { id: 10, dx: 1, dy: 0 } }], ctx);
  assert.notEqual(itemById(r.plan, 10), itemById(plan, 10));
  assert.equal(itemById(plan, 10).x, 1000);
});

test('写しに当てるとき、deleteObjects に1つでもロックした物があれば何も消えない', () => {
  const plan = basePlan();
  const before = JSON.stringify(plan);
  const r = run(plan, [{ op: 'deleteObjects', args: { ids: [10, 1, 11] } }]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /ロック/);
  assert.equal(r.plan, plan);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(r.removedIds, []);
});

test('addRoom: roomId が毎回同じ値でも、部屋の id は重ならない', () => {
  const ctx = makeCtx({ roomId: () => 'rm_same' });
  const r = run(basePlan(), [
    { op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000 } },
    { op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000 } },
  ], ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.changedIds.length, 2);
  assert.notEqual(r.changedIds[0], r.changedIds[1]);
  assert.deepEqual(r.changedIds, ['rm_same', 'rm_101']);
  const ids = r.plan.rooms.map((x) => String(x.id));
  assert.equal(new Set(ids).size, ids.length);
  const r2 = run(basePlan(), [{ op: 'addRoom', args: { x: 0, y: 0, w: 1000, d: 1000 } }], makeCtx({ roomId: () => 'rm_a' }));
  assert.deepEqual(r2.changedIds, ['rm_101']);
});

test('写しに当てるとき catalog.known が無ければ placeItem は errors、inPlace なら今のまま置く', () => {
  const ctx = makeCtx();
  delete ctx.catalog.known;
  const plan = basePlan();
  const r = run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0 } }], ctx);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /この ctx では物を置けません/);
  const r2 = run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0 } }], Object.assign(ctx, { inPlace: true }));
  assert.deepEqual(r2.errors, []);
  assert.equal(plan.items[plan.items.length - 1].type, 'sofa');
});

test('warnings: 天井高が変わったのに器具を動かせなかった', () => {
  const ctx = makeCtx({ allowProps: true, hooks: { ceilingElevation: (room) => (room.ceiling ? room.ceiling.heightMm : 2400) } });
  const r = run(basePlan(), [{ op: 'setProps', args: { id: 'rm_a', props: { ceiling: { type: 'flat', heightMm: 2600 } } } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /2400mm から 2600mm/);
  assert.match(r.warnings[0], /器具/);
  assert.equal(itemById(r.plan, 16).elev, 2390);
  // 天井高が変わらなければ書かない。
  const same = run(basePlan(), [{ op: 'setProps', args: { id: 'rm_a', props: { ceiling: { type: 'flat', heightMm: 2400 } } } }], ctx);
  assert.deepEqual(same.warnings, []);
});

test('warnings: AI が渡した寸法をプリセットが上書きした', () => {
  const ctx = makeCtx({ hooks: { openingPreset: (t) => (t === 'tool:door' ? { type: 'door-swing', apply: (it) => { it.w = 780; it.d = 780; } } : null) } });
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'tool:door', x: 0, y: 0, w: 900 } }], ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /w=900→780/);
});

test('warnings: 桁違いの寸法・座標は通したうえで書く(写しのときだけ)', () => {
  const r = run(basePlan(), [
    { op: 'placeItem', args: { type: 'sofa', x: 200000, y: 0, w: 30, d: 900 } },
    { op: 'addWall', args: { x1: 0, y1: 0, x2: 10, y2: 0 } },
    { op: 'addRoom', args: { x: 0, y: 0, w: 150000, d: 1000 } },
  ]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.changedIds.length, 3);
  assert.equal(r.warnings.length, 4);
  assert.ok(r.warnings.some((w) => /x=200000mm/.test(w)));
  assert.ok(r.warnings.some((w) => /w=30mm/.test(w)));
  assert.ok(r.warnings.some((w) => /長さ=10mm/.test(w)));
  assert.ok(r.warnings.some((w) => /w=150000mm/.test(w)));
  const r2 = run(basePlan(), [{ op: 'placeItem', args: { type: 'sofa', x: 200000, y: 0, w: 30 } }], makeCtx({ inPlace: true }));
  assert.deepEqual(r2.warnings, []);
});

test('角度を 0〜360 にそろえるのは写しのときだけ', () => {
  const r = run(basePlan(), [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, rot: 450 } }]);
  assert.equal(r.plan.items[r.plan.items.length - 1].rot, 90);
  const plan = basePlan();
  run(plan, [{ op: 'placeItem', args: { type: 'sofa', x: 0, y: 0, rot: 450 } }], makeCtx({ inPlace: true }));
  assert.equal(plan.items[plan.items.length - 1].rot, 450);
  run(plan, [{ op: 'rotateObject', args: { id: 10, by: -30 } }], makeCtx({ inPlace: true }));
  assert.equal(itemById(plan, 10).rot, -30);
});

// ── グローバル ─────────────────────────────────────────────────────

test('plan-core はグローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-core/operations.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'nextId', 'saveState', 'updateProps', 'draw2d',
    'isWindowLikeType', 'isLightItemType', 'roomCeilingElevationMm', 'shiftRoomCeilingFixtures', 'getExteriorWallSetting',
    'windowSillMm', 'normalizeWindowVerticalProps', 'Date.now', 'PlanSettable.']) {
    assert.ok(!src.includes(w), w + ' が残っている');
  }
});
