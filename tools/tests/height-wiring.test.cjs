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
  // Task 12-1: 屋根から天井を導く経路。宣言していない部屋はここを通らない。
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
    'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomCeilingSlopeM',
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
    topLevelVar('U'), topLevelVar('_ceilingClampWarned'),
    topLevelVar('CEILING_UNDER_ROOF_OFFSET_MM'), topLevelVar('_roofCeilingExtentCache'), topLevelVar('ROOM_OVERLAP_EPS_MM')
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

// Task 11-3(B): レンダが平らにしか作れないあいだ、ラベルは平らな高さだけを言う。
// これは以前ここで固定していた 'CH 2200-2700 ↑' の**撤回**である。低い側の 2200 は
// 3Dのどこにも無く、矢印が指す傾きも存在しなかった。設計 §12.2 はこのラベルを
// 「生成AIが空間の高さを知る唯一の手がかり」と定義しているので、そのずれは嘘になる。
// Task 14: 上に部屋があるかどうかで階高クランプの有無が変わるので、家の側で
// 「上階の部屋を載せるか」を選べるようにする。載せなければ最上階の部屋である。
function slopedHouse(lowMm, highMm, direction, floor, roomAbove) {
  const f = floor || 1;
  const rooms = [{ id: 's', floor: f, x: 0, y: 0, w: 4000, d: 3000,
                   ceiling: { type: 'sloped', lowMm: lowMm, highMm: highMm,
                              direction: direction } }];
  if (roomAbove) rooms.push({ id: 'up', floor: f + 1, x: 0, y: 0, w: 4000, d: 3000 });
  return { floors: {}, items: [], walls: [], rooms: rooms };
}

// Task 11-3(A): 3D が実際に傾けられるようになったので、(B) の抑制を外して
// 範囲と向きへ戻した。ただし**数値はどちらもレンダが置いた面から取る**。
// HeightModel の宣言値をそのまま書くと、階高でクランプされた分だけ嘘になる。
// Task 14-2: 上に部屋がある階でだけ丸める。丸めたときはラベルも丸めた値を言う。
test('勾配天井のラベルは範囲と向きを言い、数値はレンダが置いた面から取る', () => {
  const g = heights(slopedHouse(2200, 4000, 0, 1, true));   // 上に2階の部屋がある
  const room = g.DATA.rooms[0];
  const shape = g.roomRenderedCeilingShape(room);
  assert.equal(shape.type, 'sloped', '3D は傾けられるのに flat と書いている');
  assert.equal(shape.lowMm, 2200);
  // 4000 は階高 2700 を超えるのでレンダは 2700 に丸める。ラベルもそう言う。
  assert.equal(shape.highMm, 2700);
  assert.equal(g.roomRenderedCeilingLabel(room), 'CH 2200-2700 ↑');
  // 宣言のままの 4000 を書いてはいけない（レンダのどこにも 4000 は無い）
  assert.equal(HeightModel.ceilingLabel(g.DATA, room), 'CH 2200-4000 ↑');
});

// クランプで高い側が低い側を下回るとき、低い側が上を越えないこと。
test('階高が低い側にも足りなければ、低い側は高い側で止まる（範囲が反転しない）', () => {
  const g = heights(slopedHouse(3000, 4000, 0, 1, true));   // 階高 2700 / 上に部屋あり
  const shape = g.roomRenderedCeilingShape(g.DATA.rooms[0]);
  assert.equal(shape.highMm, 2700);
  assert.equal(shape.lowMm, 2700, '低い側が高い側を越えている: ' + shape.lowMm);
  const slope = g.roomCeilingSlopeM(g.DATA.rooms[0]);
  assert.ok(slope.lowY <= slope.highY);
});

test('勾配を宣言していない部屋では roomCeilingSlopeM は null（既存の家の通り道）', () => {
  const g = heights(PLAN);
  PLAN.rooms.forEach(function (r) {
    assert.equal(g.roomCeilingSlopeM(r), null, r.id + ' が勾配の枝に入っている');
  });
  const flat = heights(houseWithCeiling(2200, 1));
  assert.equal(flat.roomCeilingSlopeM(flat.DATA.rooms[0]), null);
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
    makeCeilingMaterial: function () { return { base: true }; },
    makeRoomFloorMaterial: function () { return {}; },
    buildRoomFloorMeshes: function () { return { slab: {}, slabBody: null }; },
    buildRoomCeilingMesh: function (r, ceilY, mat, holes, slope) {
      got.push({ id: r.id, floor: r.floor, ceilY: ceilY, mat: mat, slope: slope === undefined ? null : slope });
      return {};
    },
    // Task 22: 天井の仕上げ。本物の makeRoomCeilingMaterial を通し、
    // テクスチャまわりだけ最小のスタブで支える。
    getTexture3D: function (k) { return k ? { key: k } : null; },
    cloneRepeatReadyTexture: function (t) { return t ? { key: t.key } : null; },
    setTextureRepeatNoDistort: function () {},
    applyTextureFlip: function () {},
    roomHasCoverAbove: function () { return true; },
    stairwellQuadsForFloor: function () { return []; },
    stairwellHolesForRoom: function () { return []; },
    mark3DSelectable: function () {},
    makeAutoLightFixtureMesh: noop,
    sc3: { add: function () {} },
    THREE: {
      Mesh: noop, PointLight: noop, CylinderGeometry: noop,
      MeshStandardMaterial: function () { return {}; },
      Color: function () { return {}; }
    }
  });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'),
    topLevelVar('U'), topLevelVar('_ceilingClampWarned'),
    topLevelVar('CEILING_UNDER_ROOF_OFFSET_MM'), topLevelVar('_roofCeilingExtentCache'), topLevelVar('ROOM_OVERLAP_EPS_MM'),
    topLevelVar('CEILING_TEXTURE_TILE_M')
  ].concat(HEIGHT_FNS.map(topLevelFunction))
   .concat(['appearanceWithTextureOrientation', 'resolveRoomCeilingAppearance',
            'makeRoomCeilingMaterial', 'buildRooms3D'].map(topLevelFunction)).join('\n'), ctx);
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

// ── Task 11-3(A): 3D が実際に勾配天井を作る ──────────────────────────────
// 「何も変わっていない」と「何も繋がっていない」は外から見分けが付かない。
// ここは buildRoomCeilingMesh を実際に走らせ、出来た天井面の**頂点の高さ**を測る。
// three.js は要らないが、替え玉は本物と同じ座標を出す必要がある（頂点が全部
// 原点にある替え玉では、傾きが効いていなくてもテストが通ってしまう）。
function geometryStub() {
  function Vec3() { this.x = 0; this.y = 0; this.z = 0; }
  Vec3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  function makeGeo(type, pts) {
    const a = new Float64Array(pts.length * 3);
    pts.forEach(function (p, i) { a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2]; });
    return {
      type: type,
      attributes: { position: {
        count: pts.length, array: a,
        getX: (i) => a[i * 3], getY: (i) => a[i * 3 + 1], getZ: (i) => a[i * 3 + 2],
        setY: function (i, v) { a[i * 3 + 1] = v; }, needsUpdate: false } },
      rotateX: function (ang) {
        const c = Math.cos(ang), s = Math.sin(ang);
        for (let i = 0; i < pts.length; i++) {
          const y = a[i * 3 + 1], z = a[i * 3 + 2];
          a[i * 3 + 1] = y * c - z * s;
          a[i * 3 + 2] = y * s + z * c;
        }
        return this;
      },
      translate: function (dx, dy, dz) {
        for (let i = 0; i < pts.length; i++) {
          a[i * 3] += dx; a[i * 3 + 1] += dy; a[i * 3 + 2] += dz;
        }
        return this;
      },
      computeVertexNormals: function () { return this; }
    };
  }
  return {
    // three の PlaneGeometry(w,h) は XY 平面。1分割の頂点順もそのまま写す。
    PlaneGeometry: function (w, h) {
      return makeGeo('PlaneGeometry', [
        [-w / 2, h / 2, 0], [w / 2, h / 2, 0], [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0]]);
    },
    CylinderGeometry: function () { return makeGeo('CylinderGeometry', [[0, 0, 0]]); },
    // Shape の輪郭点をそのまま頂点にする（穴の三角形分割までは真似ない）。
    ShapeGeometry: function (shape) { return makeGeo('ShapeGeometry', shape.$pts); },
    Shape: function () {
      const self = this;
      this.$pts = []; this.holes = [];
      this.moveTo = function (x, y) { self.$pts.push([x, y, 0]); };
      this.lineTo = function (x, y) { self.$pts.push([x, y, 0]); };
      this.closePath = function () {};
    },
    Path: function () {
      this.moveTo = function () {}; this.lineTo = function () {}; this.closePath = function () {};
    },
    Mesh: function (geometry, material) {
      this.isMesh = true; this.geometry = geometry; this.material = material;
      this.position = new Vec3(); this.rotation = new Vec3(); this.userData = {};
    }
  };
}

function ceilingBuilder(data) {
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, DATA: data,
    THREE: geometryStub(), PV_INTERIOR_DAYLIGHT: false, isInt: false
  });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'),
    topLevelVar('U'), topLevelVar('_ceilingClampWarned'),
    topLevelVar('CEILING_UNDER_ROOF_OFFSET_MM'), topLevelVar('_roofCeilingExtentCache'), topLevelVar('ROOM_OVERLAP_EPS_MM')
  ].concat(HEIGHT_FNS.map(topLevelFunction)).concat([
    topLevelFunction('ceilingSlopeUnit'),
    topLevelFunction('ceilingSlopeSpan'),
    topLevelFunction('buildSlopedCeilingGeometry'),
    topLevelFunction('buildRoomCeilingShapeGeometry'),
    topLevelFunction('makeAutoLightFixtureMesh'),
    topLevelFunction('buildRoomCeilingMesh')
  ]).join('\n'), ctx);
  return ctx;
}
// 天井メッシュの頂点を [x, y, z] の配列で取り出す（mesh.position を足した世界座標）。
function verticesOf(mesh) {
  const p = mesh.geometry.attributes.position, out = [];
  for (let i = 0; i < p.count; i++) {
    out.push([p.getX(i) + mesh.position.x, p.getY(i) + mesh.position.y,
              p.getZ(i) + mesh.position.z]);
  }
  return out;
}
// 部屋 4000x3000（平面図 mm、原点）。1階（床スラブ 0）。階高は 3900 まで上げる。
function slopedRoom(direction, lowMm, highMm) {
  return {
    floors: { 1: { storyHeight: 3900 } }, walls: [], items: [],
    rooms: [{ id: 's', floor: 1, x: 0, y: 0, w: 4000, d: 3000,
              ceiling: { type: 'sloped', lowMm: lowMm || 2200,
                         highMm: highMm || 3600, direction: direction } }]
  };
}

test('勾配を宣言した部屋の天井面は、実際に傾いて作られる', () => {
  const data = slopedRoom(0);                      // 0 = 北。矢印は高い側を指す
  const c = ceilingBuilder(data);
  const room = data.rooms[0];
  const slope = c.roomCeilingSlopeM(room);
  assert.notEqual(slope, null, '勾配として解決されていない');
  const ceilY = c.floorBaseY(1) + c.roomCeilingHeightM(room);
  const mesh = c.buildRoomCeilingMesh(room, ceilY, {}, null, slope);
  const v = verticesOf(mesh);
  const ys = v.map((p) => p[1]);
  const spread = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  assert.ok(spread > 1.3, '天井が平らなまま作られている（高低差 ' + spread.toFixed(4) + 'm）');
  // 宣言どおりの高低差 3600-2200 = 1400mm
  assert.ok(Math.abs(spread - 1.4) < 1e-9, '高低差が宣言と違う: ' + spread);
  // 北 = 平面図の -Y = 世界座標の -Z が高い側
  const north = v.filter((p) => Math.abs(p[2] - 0) < 1e-9);
  const south = v.filter((p) => Math.abs(p[2] - 3.0) < 1e-9);
  assert.ok(north.length && south.length, '南北の頂点が取れていない');
  assert.ok(north[0][1] > south[0][1],
    '矢印は高い側（北）を指すのに、北が低い: ' + north[0][1] + ' vs ' + south[0][1]);
  // 高い側は平らに作ったときと同じ高さ（レンダの実寸＝ラベルの上限）
  assert.ok(Math.abs(north[0][1] - (ceilY - 0.012)) < 1e-9,
    '高い側がレンダの天井高と一致しない: ' + north[0][1]);
  assert.ok(Math.abs(south[0][1] - (ceilY - 0.012 - 1.4)) < 1e-9,
    '低い側が宣言の 2200 と一致しない: ' + south[0][1]);
  // ラベルが同じ面を語ること
  assert.equal(c.roomRenderedCeilingLabel(room), 'CH 2200-3600 ↑');
});

test('向きを変えると、高い側も一緒に回る', () => {
  [[90, 'east'], [180, 'south'], [270, 'west']].forEach(function (pair) {
    const data = slopedRoom(pair[0]);
    const c = ceilingBuilder(data);
    const room = data.rooms[0];
    const ceilY = c.floorBaseY(1) + c.roomCeilingHeightM(room);
    const v = verticesOf(c.buildRoomCeilingMesh(room, ceilY, {}, null, c.roomCeilingSlopeM(room)));
    const high = v.filter((p) => p[1] > ceilY - 0.012 - 1e-9);
    assert.ok(high.length === 2, pair[1] + ': 高い側の辺が2頂点でない');
    if (pair[0] === 90) high.forEach((p) => assert.ok(Math.abs(p[0] - 4.0) < 1e-9, 'east'));
    if (pair[0] === 180) high.forEach((p) => assert.ok(Math.abs(p[2] - 3.0) < 1e-9, 'south'));
    if (pair[0] === 270) high.forEach((p) => assert.ok(Math.abs(p[0] - 0) < 1e-9, 'west'));
  });
});

test('斜め45度でも面は平ら（高さは x,z の一次関数）', () => {
  const data = slopedRoom(45);
  const c = ceilingBuilder(data);
  const room = data.rooms[0];
  const ceilY = c.floorBaseY(1) + c.roomCeilingHeightM(room);
  const v = verticesOf(c.buildRoomCeilingMesh(room, ceilY, {}, null, c.roomCeilingSlopeM(room)));
  // 4隅から平面 y = a*x + b*z + d を最初の3点で決め、4点目が乗ることを見る
  const [p0, p1, p2, p3] = v;
  const det = (p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2]);
  assert.ok(Math.abs(det) > 1e-9);
  const a = ((p1[1] - p0[1]) * (p2[2] - p0[2]) - (p2[1] - p0[1]) * (p1[2] - p0[2])) / det;
  const b = ((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) / det;
  const d = p0[1] - a * p0[0] - b * p0[2];
  assert.ok(Math.abs(a * p3[0] + b * p3[2] + d - p3[1]) < 1e-9, '4隅が同一平面に乗らない');
  assert.ok(Math.abs(a) > 1e-6 && Math.abs(b) > 1e-6, '斜めなのに片方の軸しか傾いていない');
});

test('階段の吹き抜けを持つ勾配天井も、輪郭の頂点ごとに傾く', () => {
  const data = slopedRoom(0);
  const c = ceilingBuilder(data);
  const room = data.rooms[0];
  const ceilY = c.floorBaseY(1) + c.roomCeilingHeightM(room);
  const holes = [[{ x: 1.0, z: 1.0 }, { x: 2.0, z: 1.0 }, { x: 2.0, z: 2.0 }]];
  const mesh = c.buildRoomCeilingMesh(room, ceilY, {}, holes, c.roomCeilingSlopeM(room));
  assert.equal(mesh.geometry.type, 'ShapeGeometry', '穴あきの枝を通っていない');
  const ys = verticesOf(mesh).map((p) => p[1]);
  assert.ok(Math.max.apply(null, ys) - Math.min.apply(null, ys) > 1.3,
    '穴あきの天井が平らなまま');
});

// 勾配を宣言していない部屋は、従来の枝をそのまま通る。
test('勾配でない部屋の天井は、形も姿勢も位置も従来どおり', () => {
  const data = { floors: {}, walls: [], items: [],
    rooms: [{ id: 'f', floor: 1, x: 0, y: 0, w: 4000, d: 3000 }] };
  const c = ceilingBuilder(data);
  const room = data.rooms[0];
  const ceilY = c.floorBaseY(1) + c.roomCeilingHeightM(room);
  const mesh = c.buildRoomCeilingMesh(room, ceilY, {}, null, c.roomCeilingSlopeM(room));
  assert.equal(mesh.geometry.type, 'PlaneGeometry');
  assert.ok(Math.abs(mesh.rotation.x + Math.PI / 2) < 1e-12,
    '面の姿勢が変わっている（平らなプランのジオメトリを動かしてはならない）');
  assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z],
    [2.0, ceilY - 0.012, 1.5]);
  // 頂点は PlaneGeometry のまま（回転も移動も焼き込まれていない）
  const p = mesh.geometry.attributes.position;
  assert.deepEqual([p.getX(0), p.getY(0), p.getZ(0)], [-2.0, 1.5, 0]);
});

// M15 で見つかった穴。buildRoomCeilingMesh が正しく傾けても、buildRooms3D が
// 勾配を渡さなければ 3D は平らなまま。「作れる」と「繋がっている」は別である。
test('buildRooms3D は勾配天井の部屋にだけ勾配を渡す', () => {
  const house = {
    floors: { 1: { storyHeight: 3900 } }, walls: [], items: [],
    rooms: [
      { id: 'flat', floor: 1, x: 0, y: 0, w: 4000, d: 3000 },
      { id: 'slope', floor: 1, x: 5000, y: 0, w: 4000, d: 3000,
        ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 } }
    ]
  };
  const r = ceilingYsFor(house, 1);
  const by = {};
  r.got.forEach(function (e) { by[e.id] = e; });
  assert.ok(by.flat && by.slope, '天井が2枚作られていない');
  assert.equal(by.flat.slope, null, '平らな部屋に勾配が渡っている');
  assert.ok(by.slope.slope, '勾配天井の部屋に勾配が渡っていない（3D は平らなまま）');
  assert.ok(by.slope.slope.highY > by.slope.slope.lowY);
  assert.equal(Math.round(by.slope.slope.lowY / r.U), 2200);
  assert.equal(Math.round(by.slope.slope.highY / r.U), 3600);
});

test('既定プランでは、どの部屋にも勾配は渡らない（既存の家の通り道）', () => {
  [1, 2].forEach(function (f) {
    ceilingYsFor(PLAN, f).got.forEach(function (e) {
      assert.equal(e.slope, null, e.id + ' が勾配の枝に入っている');
    });
  });
});
