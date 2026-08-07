const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
const PLAN = JSON.parse(readFileSync(join(ROOT, 'assets', 'default_plan.json'), 'utf8'));

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

// ════════════════════════════════════════════════════════════════════════════
// ここから下は grep ではない。index.html から高さの関数を波括弧の対応で切り出し、
// node:vm で**実際に走らせて**戻り値を測る。
//
// 理由: この計画では grep のアサーションが7回、未修正のコードに対して通っている。
// 全体レビューの実測では 22 の変異のうち 16 が全テスト緑のまま生き残り、その中に
// 「Task 2 の取り消し」「Task 2b の取り消し」「階高クランプの復活」が含まれていた。
// 上の doesNotMatch(/FLOOR_H/) は、クランプを storyHeightM() で書き直されると
// 素通りする。値を測れば書き方に依存しない。
// ════════════════════════════════════════════════════════════════════════════

function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  if (at === -1) at = html.indexOf('\nasync function ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}

const HEIGHT_FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomRenderedCeilingMm', 'roomRenderedCeilingShape', 'roomRenderedCeilingLabel',
  'roomAtPointOnFloor', 'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'wallHeightMm', 'wallDisplayHeightM'
];

// data を食わせた高さの計算機。DATA はコンテキストの変数なので、テストごとに
// 別の家を渡せる。
function heights(data) {
  const ctx = vm.createContext({ console: console, HeightModel: HeightModel, DATA: data });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'),
    topLevelVar('U'), topLevelVar('_ceilingClampWarned')
  ].concat(HEIGHT_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// 天井高を明示した部屋を持つ家。既定プランの部屋はどれも明示していないので、
// 「明示した値がそのまま届くか」はこちらで測る。
function houseWithCeiling(mm, floor) {
  const f = floor || 1;
  return {
    floors: {}, items: [],
    rooms: [{ id: 'low', n: '低い部屋', floor: f, x: 0, y: 0, w: 4000, d: 3000,
              ceiling: { type: 'flat', heightMm: mm } }],
    // 部屋の内側を通る間仕切り壁。両側とも部屋なので wallCeilingHeightM は
    // 天井高を採る（外皮に面する壁は階高まで伸びる、が別の分岐）。
    walls: [{ id: 1, floor: f, x1: 500, y1: 1500, x2: 3500, y2: 1500, thick: 120 }]
  };
}

// ── Task 2b: 階高クランプは復活していないか（値で測る）────────────────────
test('2400mm 未満の天井高がそのまま届く（階高でクランプされない）', () => {
  const g = heights(houseWithCeiling(2200, 1));
  const room = g.DATA.rooms[0];
  // 1階は床スラブを持たないので、天井面 = 床からの天井高そのもの。
  assert.equal(Math.round(g.roomCeilingHeightM(room) / g.U), 2200,
    'クランプが復活すると階高 2700 が返る');
  assert.equal(g.roomRenderedCeilingMm(room), 2200);
});

test('2520mm 未満の天井高は2階でもそのまま届く（クランプの実測上の境目）', () => {
  const g = heights(houseWithCeiling(2300, 2));
  const room = g.DATA.rooms[0];
  // 2階の天井面は floorBaseY 基準。床スラブ 180 の上に 2300 が乗る。
  assert.equal(Math.round(g.roomCeilingHeightM(room) / g.U), 2300 + 180);
  assert.equal(g.roomRenderedCeilingMm(room), 2300, '室内で測れる高さが 2300 でない');
});

test('階高を超える天井高だけは階高へ丸める（上階の床を持ち上げない）', () => {
  const g = heights(houseWithCeiling(4000, 1));
  const room = g.DATA.rooms[0];
  assert.equal(Math.round(g.roomCeilingHeightM(room) / g.U), 2700, '階高を超えて伸びている');
});

test('天井高を明示しない部屋は階高をそのまま受け取る（保存済みの家が下がらない）', () => {
  const g = heights(PLAN);
  const f1 = PLAN.rooms.filter((r) => r.floor === 1);
  const f2 = PLAN.rooms.filter((r) => r.floor === 2);
  assert.ok(f1.length > 0 && f2.length > 0);
  f1.forEach((r) => assert.equal(Math.round(g.roomCeilingHeightM(r) / g.U), 2700, r.id));
  f2.forEach((r) => assert.equal(Math.round(g.roomCeilingHeightM(r) / g.U), 2700, r.id));
  // HeightModel の既定 (2400) へ落としていないこと。落とすと家が 300mm 下がる。
  assert.notEqual(HeightModel.ceilingHeightMm(PLAN, f1[0]), 2700);
});

// ── Task 2b: 壁1枚の高さ（wallDisplayHeightM）────────────────────────────
test('間仕切り壁は接する部屋の天井高まで（階高いっぱいに戻っていない）', () => {
  const g = heights(houseWithCeiling(2200, 1));
  const wall = g.DATA.walls[0];
  assert.equal(Math.round(g.wallDisplayHeightM(wall) / g.U), 2200,
    'wallFullHeightM へ戻すと 2700 になる');
  // 同じ家で外皮の高さは 2700 のまま。2つが別物であることを固定する
  // （両方 2700 なら「戻した」と区別できない）。
  assert.equal(Math.round(g.wallFullHeightM(1) / g.U), 2700);
});

test('壁ごとの高さ指定はそのまま効く（階高で潰されない）', () => {
  const h = houseWithCeiling(2200, 1);
  h.walls[0].wallHeight = 2000;
  const g = heights(h);
  assert.equal(Math.round(g.wallDisplayHeightM(g.DATA.walls[0]) / g.U), 2000);
});

test('外皮に面する壁は階高まで伸びる（外壁と上階の床の間に穴を開けない）', () => {
  const h = houseWithCeiling(2200, 1);
  // 部屋の外へ出した壁。片側に部屋が無いので外皮の下限が効く。
  h.walls[0] = { id: 2, floor: 1, x1: 8000, y1: 8000, x2: 11000, y2: 8000, thick: 120 };
  const g = heights(h);
  assert.equal(Math.round(g.wallDisplayHeightM(g.DATA.walls[0]) / g.U), 2700);
});

// ── Task 10-1: ラベルと記録がレンダと同じ高さを言う ──────────────────────
// 設計 §12.2 はこのラベルを「生成AIが空間の高さを知る唯一の手がかり」と定義する。
// 全体レビューの実測: 既定プランの全部屋で、絵は 2700 / 2520 なのにラベルは
// 「CH 2400」だった。値で固定する。
test('天井高ラベルの数値は、レンダが置いた天井の実寸と一致する', () => {
  const g = heights(PLAN);
  const seen = {};
  PLAN.rooms.forEach((r) => {
    const rendered = g.roomRenderedCeilingMm(r);
    const label = g.roomRenderedCeilingLabel(r);
    assert.equal(label, 'CH ' + rendered, r.id + ' のラベルが実寸と違う: ' + label);
    seen[r.floor] = rendered;
  });
  // 実測値そのもの。ここが 2400 に戻ったら、それが直した不良である。
  assert.equal(seen[1], 2700, '1階の実寸が 2700 でない');
  assert.equal(seen[2], 2520, '2階の実寸が 2520 でない（階高 2700 - 床スラブ 180）');
  assert.equal(seen[3], 2520);
});

test('HeightModel の既定をそのまま出すと実寸と食い違う（＝これが直した不良）', () => {
  const g = heights(PLAN);
  const room = PLAN.rooms.filter((r) => r.floor === 1)[0];
  assert.equal(HeightModel.ceilingLabel(PLAN, room), 'CH 2400');
  assert.notEqual(g.roomRenderedCeilingLabel(room), 'CH 2400',
    'ラベルが HeightModel の既定へ戻っている');
});

test('天井高を明示した部屋では、ラベルはその値を言う（階を問わず）', () => {
  const a = heights(houseWithCeiling(2200, 1));
  assert.equal(a.roomRenderedCeilingLabel(a.DATA.rooms[0]), 'CH 2200');
  const b = heights(houseWithCeiling(2300, 2));
  assert.equal(b.roomRenderedCeilingLabel(b.DATA.rooms[0]), 'CH 2300');
});

test('勾配天井は形を保ったまま、高い側だけレンダの実寸に直る', () => {
  const g = heights({
    floors: {}, items: [], walls: [],
    rooms: [{ id: 's', floor: 1, x: 0, y: 0, w: 4000, d: 3000,
              ceiling: { type: 'sloped', lowMm: 2200, highMm: 4000, direction: 0 } }]
  });
  const shape = g.roomRenderedCeilingShape(g.DATA.rooms[0]);
  assert.equal(shape.type, 'sloped');
  assert.equal(shape.lowMm, 2200);
  // 4000 は階高 2700 を超えるのでレンダは 2700 に丸める。ラベルもそう言う。
  assert.equal(shape.highMm, 2700);
  assert.equal(g.roomRenderedCeilingLabel(g.DATA.rooms[0]), 'CH 2200-2700 ↑');
});

// ── Task 2: buildRooms3D が置く天井の高さ ────────────────────────────────
// 天井メッシュの Y は roomCeilingHeightM から来ていなければならない。
// three.js は要らない: buildRooms3D を切り出し、記録するだけのスタブを食わせて、
// buildRoomCeilingMesh が受け取った ceilY を測る。
function ceilingYsFor(data, floor) {
  const got = [];
  const noop = function () { return { position: { set: function () {} }, userData: {} }; };
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, DATA: data,
    ST: { view: '3d-ext', floor: floor },
    isInt: false, PV_INTERIOR_DAYLIGHT: false,
    LIGHT_SETTINGS: { room: 1, env: 0 },
    isWalkView: function () { return false; },
    isLightItemType: function () { return false; },
    makeCeilingMaterial: function () { return {}; },
    makeRoomFloorMaterial: function () { return {}; },
    buildRoomFloorMeshes: function () { return { slab: {}, slabBody: null }; },
    buildRoomCeilingMesh: function (r, ceilY) { got.push({ id: r.id, floor: r.floor, ceilY: ceilY }); return {}; },
    roomHasCoverAbove: function () { return true; },
    stairwellQuadsForFloor: function () { return []; },
    stairwellHolesForRoom: function () { return []; },
    mark3DSelectable: function () {},
    sc3: { add: function () {} },
    THREE: {
      Mesh: noop, PointLight: noop, CylinderGeometry: noop,
      MeshStandardMaterial: function () { return {}; },
      Color: function () { return {}; }
    }
  });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'),
    topLevelVar('U'), topLevelVar('_ceilingClampWarned')
  ].concat(HEIGHT_FNS.map(topLevelFunction))
   .concat([topLevelFunction('buildRooms3D')]).join('\n'), ctx);
  ctx.buildRooms3D(floor);
  return { got: got, U: ctx.U, floorBaseY: ctx.floorBaseY };
}

test('天井メッシュは roomCeilingHeightM の高さに置かれる（階高いっぱいではなく）', () => {
  const r = ceilingYsFor(houseWithCeiling(2200, 1), 1);
  assert.equal(r.got.length, 1, '天井が1枚も作られていない');
  const above = Math.round((r.got[0].ceilY - r.floorBaseY(1)) / r.U);
  assert.equal(above, 2200, 'wallFullHeightM へ戻すと 2700 になる');
});

test('既定プランでは天井は階高の位置に置かれる（既存の家が動かない）', () => {
  [1, 2].forEach(function (f) {
    const r = ceilingYsFor(PLAN, f);
    assert.ok(r.got.length > 0, 'floor ' + f + ' の天井が作られていない');
    r.got.forEach(function (e) {
      assert.equal(Math.round((e.ceilY - r.floorBaseY(f)) / r.U), 2700, e.id);
    });
  });
});

test('天井の実寸とラベルは同じ1つの経路から出る（2つの真実を持たない）', () => {
  const house = houseWithCeiling(2350, 2);
  const g = heights(house);
  const r = ceilingYsFor(house, 2);
  const room = house.rooms[0];
  // 天井メッシュの床上がりの高さ = ラベルの数値
  const aboveFloorMm = Math.round((r.got[0].ceilY - r.floorBaseY(2)) / r.U) - 180;
  assert.equal(g.roomRenderedCeilingLabel(room), 'CH ' + aboveFloorMm);
  assert.equal(aboveFloorMm, 2350);
});
