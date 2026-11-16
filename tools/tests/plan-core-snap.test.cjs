// plan-core/snap.js の単体テスト。グローバルには触らない。
// 期待値は、切り出す前の画面の関数(app-state.js の snapRectOriginToGrid / applyEdgeSnap、
// index.html の stairSnapPosition)を app-source.cjs の仕組みで node:vm に載せて走らせ、
// 出た値をそのまま数値で写したもの。ここで値を作り直していない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../assets/js/plan-core/snap.js');

function close(actual, expected, label) {
  for (const k of Object.keys(expected)) {
    const a = actual[k], e = expected[k];
    if (typeof e === 'number') assert.ok(Math.abs(a - e) < 1e-9, label + ' の ' + k + ': ' + a + ' / 期待 ' + e);
    else assert.equal(a, e, label + ' の ' + k);
  }
}

test('snapRectOriginToGrid: 格子 0・50・910、回転 0/90/45', () => {
  const cases = [
    [[1000, 2000, 600, 400, 0, 0], { x: 1000, y: 2000 }],
    [[1013, 2027, 600, 400, 0, 50], { x: 1000, y: 2050 }],
    [[1000, 2000, 600, 400, 0, 910], { x: 910, y: 1820 }],
    [[1013, 2027, 600, 400, 90, 50], { x: 1000, y: 2050 }],
    [[1000, 2000, 600, 400, 45, 910], { x: 963.5533905932738, y: 1973.553390593274 }],
  ];
  for (const [args, want] of cases) {
    const got = S.snapRectOriginToGrid(...args);
    assert.deepEqual(Object.keys(got), ['x', 'y']);
    close(got, want, 'grid ' + JSON.stringify(args));
  }
});

const EDGE_PLAN = {
  items: [
    { id: 1, type: 'sofa', floor: 1, x: 1000, y: 1000, w: 1800, d: 800, rot: 0 },
    { id: 2, type: 'bed', floor: 2, x: 3000, y: 1000, w: 1000, d: 2000, rot: 0 },
    { id: 3, type: 'memo', floor: 1, x: 5000, y: 5000, w: 300, d: 300, rot: 0 },
    { id: 4, type: 'desk', floor: 1, x: 6000, y: 1000, w: 1200, d: 600, rot: 90 },
  ],
  rooms: [{ id: 'rm_1', type: 'room', floor: 1, x: 0, y: 4000, w: 3640, d: 2730 }],
  walls: [{ id: 9, floor: 1, x1: 8000, y1: 0, x2: 8000, y2: 4000, thick: 120 }],
};

test('edgeSnap: 閾値の内と外、違う階の物は候補にならない、自分は外す、回転、部屋の中心', () => {
  const NO = { snapX: false, snapXVal: null };
  const cases = [
    // [x, y, w, d, 外す id, rot], 期待
    [[2840, 1100, 500, 500, null, 0], { x: 2800, y: 1050, snapX: true, snapXVal: 2800, snapY: true, snapYVal: 1300 }],
    [[2900, 1100, 500, 500, null, 0], { x: 2900, y: 1050, ...NO, snapY: true, snapYVal: 1300 }],
    [[3010, 1010, 500, 500, null, 0], { x: 3010, y: 1000, ...NO, snapY: true, snapYVal: 1000 }],
    [[1050, 1020, 1800, 800, 1, 0], { x: 1050, y: 1020, ...NO, snapY: false, snapYVal: null }],
    [[6250, 900, 1200, 600, null, 90], { x: 6250, y: 900, ...NO, snapY: true, snapYVal: 1800 }],
    [[7800, 2000, 400, 400, null, 45], { x: 7800, y: 1982.842712474619, snapX: true, snapXVal: 8000, snapY: true, snapYVal: 1900 }],
    [[1200, 5170, 400, 400, null, 0], { x: 1200, y: 5165, ...NO, snapY: true, snapYVal: 5365 }],
  ];
  for (const [[x, y, w, d, ex, rot], want] of cases) {
    const got = S.edgeSnap({ x, y, w, d, rot }, EDGE_PLAN, { floor: 1, threshold: 80, excludeIds: [ex] });
    assert.deepEqual(Object.keys(got), ['x', 'y', 'snapX', 'snapXVal', 'snapY', 'snapYVal']);
    close(got, want, 'edge ' + JSON.stringify([x, y, w, d, ex, rot]));
  }
});

test('edgeSnap: 閾値を広げれば外だった物も吸い付く(閾値は引数で決まる)', () => {
  const got = S.edgeSnap({ x: 2900, y: 1100, w: 500, d: 500, rot: 0 }, EDGE_PLAN, { floor: 1, threshold: 150, excludeIds: [null] });
  close(got, { x: 2800, snapX: true, snapXVal: 2800 }, 'edge wide');
});

// 階段の辺。画面の stairPartEdgesRaw と同じ計算(踊り場は全辺が出入り口、直階段は ±d が出入り口)。
function partEdges(it) {
  const r = (Number(it.rot) || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const w = Number(it.w) || 0, d = Number(it.d) || 0;
  const cx = (Number(it.x) || 0) + w / 2, cy = (Number(it.y) || 0) + d / 2;
  const fx = it.flipX ? -1 : 1, fy = it.flipY ? -1 : 1;
  const P = (lx, ly) => { lx *= fx; ly *= fy; return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; };
  const V = (lx, ly) => { lx *= fx; ly *= fy; return { x: lx * cos - ly * sin, y: lx * sin + ly * cos }; };
  const landing = it.type === 'stair-landing', corner = it.type === 'stair-corner';
  const role = (k) => landing ? 'any' : corner ? (k === '+d' ? 'down' : (k === '+w' ? 'up' : 'side')) : (k === '+d' ? 'up' : (k === '-d' ? 'down' : 'side'));
  return [
    { k: '+d', a: P(-w / 2, d / 2), b: P(w / 2, d / 2), n: V(0, 1) },
    { k: '-d', a: P(w / 2, -d / 2), b: P(-w / 2, -d / 2), n: V(0, -1) },
    { k: '+w', a: P(w / 2, d / 2), b: P(w / 2, -d / 2), n: V(1, 0) },
    { k: '-w', a: P(-w / 2, -d / 2), b: P(-w / 2, d / 2), n: V(-1, 0) },
  ].map((e) => Object.assign(e, { role: role(e.k), len: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) }));
}

test('stairSnap: 階段でない物、半径の内と外、違う階、回転 90/45、同じ id は外す', () => {
  const A = { id: 11, type: 'stair', floor: 1, x: 0, y: 0, w: 900, d: 2700, rot: 0 };
  const L = { id: 12, type: 'stair-landing', floor: 1, x: 0, y: 2700, w: 900, d: 900, rot: 0 };
  const L2 = { id: 13, type: 'stair-landing', floor: 2, x: 5000, y: 2700, w: 900, d: 900, rot: 0 };
  const R = { id: 14, type: 'stair', floor: 1, x: 3000, y: 0, w: 900, d: 2700, rot: 90 };
  const plan = { items: [A, L, L2, R] };
  const land = (rot) => ({ id: 20, type: 'stair-landing', floor: 1, w: 900, d: 900, rot });
  const cases = [
    [{ id: 20, type: 'sofa', floor: 1, w: 900, d: 900 }, 0, 2800, { x: 0, y: 2800, other: null }],
    [land(0), 40, 2800, { x: 0, y: 2700, other: 11 }],
    [land(0), 0, 3100, { x: 0, y: 3100, other: null }],
    [land(0), 5000, 2750, { x: 5000, y: 2750, other: null }],
    [land(90), 120, 2780, { x: 0, y: 2700, other: 11 }],
    [land(45), 30, 2850, { x: 30, y: 2850, other: null }],
    [{ id: 11, type: 'stair', floor: 1, w: 900, d: 2700, rot: 0 }, 30, 20, { x: 0, y: 0, other: 12 }],
  ];
  for (const [it, x, y, want] of cases) {
    const got = S.stairSnap(it, x, y, plan, { radius: 250, partEdges });
    const label = 'stair ' + JSON.stringify([it, x, y]);
    close(got, { x: want.x, y: want.y }, label);
    assert.equal(got.other ? got.other.id : null, want.other, label + ' の相手');
  }
  // 吸い付かないときは {x,y} だけを返す(画面の関数と同じ)。
  assert.deepEqual(S.stairSnap(land(0), 0, 3100, plan, { radius: 250, partEdges }), { x: 0, y: 3100 });
  // 半径は引数で決まる: 隙間 400 も半径 500 なら吸い付く。
  close(S.stairSnap(land(0), 0, 3100, plan, { radius: 500, partEdges }), { x: 0, y: 2700 }, 'stair wide');
});

test('plan-core/snap.js はグローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/plan-core/snap.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'nextId', 'EDGE_SNAP_THRESH', 'STAIR_SNAP_MM']) {
    assert.ok(!src.includes(w), w + ' が残っている');
  }
});
