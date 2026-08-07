// Task 12-1 / 12-2: 屋根が天井を決め、壁の上辺が勾配に沿う。
//
// この計画では grep のアサーションが未修正のコードに対して何度も通っている。
// なのでここでの検査は grep ではない。index.html から関数を波括弧の対応で切り出し、
// node:vm で**実際に走らせ**、出来た天井面と壁の頂点を測る。
// 偽の THREE は「頂点が本当にどこに置かれたか」を読むためだけのもので、
// PlaneGeometry の分割・回転・平行移動は本物と同じ結果を作る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
const PLAN = JSON.parse(readFileSync(join(ROOT, 'assets', 'default_plan.json'), 'utf8'));

// ── index.html からの切り出し（video-ui.test.cjs と同じやり方）───────────
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
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

// ── 頂点を読むためだけの最小 THREE ────────────────────────────────────────
function Attr(array, itemSize) {
  this.array = array; this.itemSize = itemSize;
  this.count = array.length / itemSize;
  this.needsUpdate = false;
}
Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };
Attr.prototype.setY = function (i, v) { this.array[i * this.itemSize + 1] = v; };
Attr.prototype.setXY = function (i, x, y) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; };

function Geo() { this.attributes = {}; this.groups = []; this.index = null; }
Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
Geo.prototype.setIndex = function (a) { this.index = a; return this; };
Geo.prototype.addGroup = function (s, c, m) { this.groups.push({ start: s, count: c, materialIndex: m }); };
Geo.prototype.computeVertexNormals = function () {};
Geo.prototype.rotateX = function (rad) {
  const p = this.attributes.position, c = Math.cos(rad), s = Math.sin(rad);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    p.array[i * 3 + 1] = y * c - z * s;
    p.array[i * 3 + 2] = y * s + z * c;
  }
  return this;
};
Geo.prototype.translate = function (x, y, z) {
  const p = this.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.array[i * 3] += x; p.array[i * 3 + 1] += y; p.array[i * 3 + 2] += z;
  }
  return this;
};

function PlaneGeometry(w, h, sw, sh) {
  Geo.call(this);
  sw = Math.max(1, sw || 1); sh = Math.max(1, sh || 1);
  const pos = [];
  for (let iy = 0; iy <= sh; iy++) {
    for (let ix = 0; ix <= sw; ix++) {
      pos.push(-w / 2 + w * ix / sw, h / 2 - h * iy / sh, 0);
    }
  }
  this.setAttribute('position', new Attr(pos, 3));
  this.setAttribute('uv', new Attr(new Array(((sw + 1) * (sh + 1)) * 2).fill(0), 2));
  this.parameters = { width: w, height: h, widthSegments: sw, heightSegments: sh };
}
PlaneGeometry.prototype = Object.create(Geo.prototype);

function BoxGeometry(w, h, d) {
  Geo.call(this);
  const p = [];
  [-w / 2, w / 2].forEach((x) => [-h / 2, h / 2].forEach((y) => [-d / 2, d / 2].forEach((z) => p.push(x, y, z))));
  this.setAttribute('position', new Attr(p, 3));
  this.parameters = { width: w, height: h, depth: d };
  this.isBox = true;
}
BoxGeometry.prototype = Object.create(Geo.prototype);

function Mesh(geo, mat) {
  this.isMesh = true; this.geometry = geo; this.material = mat;
  this.userData = {}; this.castShadow = false; this.receiveShadow = false;
  const self = this;
  this.position = { x: 0, y: 0, z: 0, set: function (x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
  this.rotation = { x: 0, y: 0, z: 0 };
}
function Group() {
  this.children = [];
  const self = this;
  this.add = function (o) { self.children.push(o); return o; };
  this.userData = {};
}
const THREE = {
  Mesh: Mesh, Group: Group, PlaneGeometry: PlaneGeometry, BoxGeometry: BoxGeometry,
  BufferGeometry: Geo,
  Float32BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  MeshStandardMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  Shape: function () { this.holes = []; this.moveTo = function () {}; this.lineTo = function () {}; this.closePath = function () {}; },
  Path: function () { this.moveTo = function () {}; this.lineTo = function () {}; this.closePath = function () {}; },
  ShapeGeometry: function () { Geo.call(this); this.setAttribute('position', new Attr([0, 0, 0], 3)); }
};
THREE.Float32BufferAttribute.prototype = Attr.prototype;

const HEIGHT_FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'roofItemOverRoom',
  'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomRenderedCeilingMm', 'roomRenderedCeilingShape', 'roomRenderedCeilingLabel',
  'roomAtPointOnFloor', 'wallTouchesSlopedCeiling', 'wallTopHeightAtM',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'wallHeightMm', 'wallDisplayHeightM',
  'buildRoomCeilingShapeGeometry', 'buildSlopedCeilingGeometry', 'buildRoomCeilingMesh',
  'getWallBandRange', 'hasWallTopShape', 'wallTopSide', 'applyWallFaceUv',
  'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM',
  'buildWall3D'
];
const HEIGHT_VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', 'CEILING_SAMPLE_STEP_M', '_roofCeilingExtentCache',
  'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M'];

// 壁は「両側とも部屋」の内部間仕切りか、外皮に面するかを exteriorSpans で決める。
// テストごとに切り替えられるよう、この2つだけスタブにする。
function makeCtx(data, opts) {
  const o = opts || {};
  const built = [];
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, DATA: data, THREE: THREE,
    Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN, Array: Array,
    Object: Object, JSON: JSON,
    PV_INTERIOR_DAYLIGHT: false, isInt: false,
    sc3: { add: function (o2) { built.push(o2); return o2; } },
    __built: built,
    mark3DSelectable: function () {},
    markInteriorCutawayCandidate: function () {},
    makeWallCoreMaterial: function () { return { core: true }; },
    makeExteriorWallMaterial: function () { return { ext: true }; },
    makeInteriorWallMaterial: function () { return { int: true }; },
    makeWallGlassMaterial: function () { return { glass: true }; },
    makeCeilingMaterial: function () { return { ceil: true }; },
    resolveExteriorWallAppearance: function () { return {}; },
    applyTextureFlip: function () {},
    setTextureRepeatNoDistort: function () {},
    wallTextureTileHeight: function () { return 1; },
    getWallExteriorSpans: function (w) { return o.outer ? [{ a: 0, b: 1e9, sign: 1 }] : []; },
    getWallInteriorFaces: function (w) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      const len = Math.sqrt(dx * dx + dy * dy) / 1000;
      return [{ a: 0, b: len, sign: 1, atStart: false, atEnd: false, fillStartM: 0, fillEndM: 0 },
              { a: 0, b: len, sign: -1, atStart: false, atEnd: false, fillStartM: 0, fillEndM: 0 }];
    },
    getOpeningWallInfo: function () { return null; },
    isOpeningItemType: function () { return false; },
    isWindowLikeType: function () { return false; },
    isArchOpeningType: function () { return false; },
    doorHeightMm: function () { return 2000; },
    windowHeightMm: function () { return 1200; },
    windowSillMm: function () { return 900; },
    buildWinFrames: function () {}
  });
  vm.runInContext(HEIGHT_VARS.map(topLevelVar).concat(HEIGHT_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// ── 家 ────────────────────────────────────────────────────────────────────
// 2階建て。2階の上に切妻屋根(棟は東西=x方向に走り、pz=0 で折り返す)を載せる。
// 屋根の軒は部屋の途中(y=1000)から始まる -- だから勾配は壁の途中から始まり、
// 上辺は「平ら → 上がる → 棟で折り返す → 下がる」の折れ線になる。
const PITCH = 35;
const ROOF = { id: 9, type: 'roof', floor: 3, x: -500, y: 1000, w: 10500, d: 7000,
  rot: 0, elev: 0, roofType: 'gable', pitch: PITCH };
function house(roomCeiling, opts) {
  const o = opts || {};
  return {
    floors: {},
    rooms: [
      { id: 'attic', n: '勾配の部屋', floor: 2, x: 0, y: 0, w: 4000, d: 6000, ceiling: roomCeiling },
      { id: 'attic2', n: '勾配の部屋2', floor: 2, x: 4200, y: 0, w: 3000, d: 6000, ceiling: roomCeiling },
      { id: 'flat', n: '平天井の部屋', floor: 2, x: 7400, y: 0, w: 2000, d: 6000 }
    ],
    walls: [
      // 0: attic と attic2 のあいだ。両側とも勾配の部屋 = 内部間仕切り。
      { id: 1, floor: 2, x1: 4100, y1: -200, x2: 4100, y2: 6200, thick: 120 },
      // 1: attic の西(x=-100)。片側しか部屋が無い = 外皮に面する壁。
      { id: 2, floor: 2, x1: -100, y1: -200, x2: -100, y2: 6200, thick: 120 },
      // 2: attic2 と平天井の部屋のあいだ。高い方を採る規則の検査用。
      { id: 3, floor: 2, x1: 7300, y1: -200, x2: 7300, y2: 6200, thick: 120 }
    ],
    items: o.noRoof ? [] : [Object.assign({}, ROOF)]
  };
}

// テスト側で独立に解いた「屋根下面-250mm」の高さ(m, ワールド)。
// index.html の式を写さず、切妻の定義（棟は pz=0、軒は pz=±D/2）から解く。
function expectedCeilingWorldY(ctx, roofItem, xMm, yMm) {
  const U = ctx.U;
  const D = roofItem.d * U;
  const tanP = Math.tan(PITCH * Math.PI / 180);
  const lz = (yMm - (roofItem.y + roofItem.d / 2)) * U;
  const h = Math.min(tanP * D / 2, tanP * Math.max(0, D / 2 - Math.abs(lz)));
  return ctx.floorBaseY(roofItem.floor) + h - 250 * U;
}

// ── 12-1 ────────────────────────────────────────────────────────────────
test('12-1: 勾配を宣言した部屋の天井は、屋根下面から 250mm 下がった面をなぞる', () => {
  const data = house({ type: 'sloped', lowMm: 2200 });
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const roof = data.items[0];
  const p = ctx.roomCeilingProfile(room);
  assert.equal(p.source, 'roof', '屋根が載っているのに屋根から導いていない');
  assert.equal(ctx.CEILING_UNDER_ROOF_OFFSET_MM, 250);
  let checked = 0;
  for (let i = 0; i <= 8; i++) {
    const yMm = room.y + room.d * i / 8;
    const xMm = room.x + room.w / 2;
    const got = ctx.roomCeilingWorldYAtMm(room, p, xMm, yMm);
    const want = Math.max(expectedCeilingWorldY(ctx, roof, xMm, yMm),
      ctx.floorBaseY(2) + 2200 * ctx.U + ctx.floorSlabHeightMForFloor(2));
    assert.ok(Math.abs(got - want) < 1e-9,
      'y=' + yMm + ' で天井が屋根に従っていない got=' + got + ' want=' + want);
    checked++;
  }
  assert.equal(checked, 9);
});

test('12-1: 天井面は棟で折り返す（一次関数ではない = 単一の平面ではない）', () => {
  const data = house({ type: 'sloped', lowMm: 2200 });
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const p = ctx.roomCeilingProfile(room);
  const ys = [];
  for (let i = 0; i <= 12; i++) ys.push(ctx.roomCeilingWorldYAtMm(room, p, 2000, room.y + room.d * i / 12));
  const up = ys.some((v, i) => i > 0 && v - ys[i - 1] > 1e-6);
  const down = ys.some((v, i) => i > 0 && v - ys[i - 1] < -1e-6);
  assert.ok(up && down, '上がって下がる山になっていない: ' + JSON.stringify(ys));
});

test('12-1(最重要): 勾配を宣言していない部屋は、屋根の下でも今までどおり階高の平天井', () => {
  const data = house(undefined);           // ceiling 宣言なし
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  assert.equal(ctx.roomCeilingProfile(room), null, '宣言していない部屋が勾配の枝に入っている');
  assert.equal(ctx.roomCeilingSlopeM(room), null);
  assert.equal(ctx.roomCeilingHeightM(room), ctx.storyHeightM(2));
  assert.equal(ctx.roomRenderedCeilingShape(room).type, 'flat');
  // 屋根は確かに載っている。「屋根がある = 導く」にすると、この検査が落ちる。
  assert.notEqual(ctx.roofItemOverRoom(room), null, '前提が崩れている(屋根が載っていない)');
});

test('12-1(最重要): 既定プランの全部屋は宣言していないので、天井の出どころが変わらない', () => {
  const ctx = makeCtx(PLAN);
  PLAN.rooms.forEach((r) => {
    assert.equal(ctx.roomCeilingProfile(r), null, r.id + ' が勾配の枝に入った');
    assert.equal(ctx.roomCeilingHeightM(r), ctx.storyHeightM(r.floor), r.id + ' の天井高が動いた');
  });
  // 実測値(Task 2 以来の既知の数字)がそのまま出ること
  const f1 = PLAN.rooms.filter((r) => r.floor === 1);
  const f2 = PLAN.rooms.filter((r) => r.floor === 2);
  assert.deepEqual(new Set(f1.map((r) => ctx.roomRenderedCeilingMm(r))), new Set([2700]));
  assert.deepEqual(new Set(f2.map((r) => ctx.roomRenderedCeilingMm(r))), new Set([2520]));
});

test('12-1: 屋根がある部屋では屋根が勝ち、手書きの high/direction は効かない', () => {
  const data = house({ type: 'sloped', lowMm: 2200, highMm: 9000, direction: 90 });
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const shape = ctx.roomRenderedCeilingShape(room);
  assert.equal(shape.source, 'roof');
  assert.equal(shape.roofOffsetMm, 250);
  assert.ok(shape.highMm < 9000 - 1, '手書きの highMm 9000 がそのまま出ている: ' + shape.highMm);
  // 棟は南北(y)方向に走るので、高い側は東西ではない。direction=90(東)にはならない。
  assert.notEqual(Math.round(shape.direction), 90);
});

test('12-1: 屋根が載っていない部屋では手書きの上書きが効く', () => {
  const data = house({ type: 'sloped', lowMm: 2000, highMm: 2400, direction: 90 }, { noRoof: true });
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const p = ctx.roomCeilingProfile(room);
  assert.equal(p.source, 'manual');
  const shape = ctx.roomRenderedCeilingShape(room);
  assert.equal(shape.source, 'manual');
  assert.equal(shape.lowMm, 2000);
  assert.equal(shape.highMm, 2400);
  assert.equal(shape.direction, 90);
});

test('12-1: 天井面のメッシュは屋根の形をなぞって組まれる（分割されている）', () => {
  const data = house({ type: 'sloped', lowMm: 2200 });
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const p = ctx.roomCeilingProfile(room);
  const mesh = ctx.buildRoomCeilingMesh(room, ctx.floorBaseY(2) + ctx.roomCeilingHeightM(room),
    { m: 1 }, null, p);
  const pos = mesh.geometry.attributes.position;
  assert.ok(pos.count > 4, '天井面が4頂点のまま = 分割されていない(棟の折れを表現できない)');
  let mn = Infinity, mx = -Infinity, worst = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < mn) mn = y;
    if (y > mx) mx = y;
    const want = ctx.roomCeilingWorldYAtMm(room, p, pos.getX(i) / ctx.U, pos.getZ(i) / ctx.U) - 0.012;
    worst = Math.max(worst, Math.abs(y - want));
  }
  assert.ok(worst < 1e-9, '頂点が天井面に乗っていない: ' + worst);
  assert.ok(mx - mn > 0.5, '天井が傾いていない(高低差 ' + (mx - mn) + 'm)');
});

// ── 12-2 ────────────────────────────────────────────────────────────────
function topProfile(ctx, wall, n, isOuter) {
  const minH = isOuter ? ctx.wallFullHeightM(wall.floor) : undefined;
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push(ctx.wallTopHeightAtM(wall, i / n, ctx.wallDisplayHeightM(wall), minH));
  }
  return out;
}


// buildWall3D を実際に走らせ、建った全ピースの頂点から上辺(同じ along での最高点)を読む。
// wallTopHeightAtM を直接呼ぶと buildWall3D 側の配線(外壁の下限など)を素通りするので、
// 「外壁が切られない」ような配線の検査は必ずこちらを通す。
function builtTopProfile(ctx, data, wallIndex) {
  ctx.__built.length = 0;
  vm.runInContext('buildWall3D(DATA.walls[' + wallIndex + ']);', ctx);
  assert.ok(ctx.__built.length > 0, '壁が1つも建っていない');
  const wall = data.walls[wallIndex];
  const fy = ctx.floorBaseY(wall.floor);
  const tops = new Map();
  function walk(o) {
    if (o.children) { o.children.forEach(walk); return; }
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const along = Math.round((o.position.x - wall.x1 * ctx.U + p.getX(i)) * 200) / 200;
      const y = o.position.y + p.getY(i) - fy;
      if (!tops.has(along) || tops.get(along) < y) tops.set(along, y);
    }
  }
  ctx.__built.forEach(walk);
  return Array.from(tops.keys()).sort((a, b) => a - b).map((k) => tops.get(k));
}

test('12-2: 内部間仕切りの上辺は折れ線 -- 平らな区間から始まり、山で折り返す', () => {
  const data = house({ type: 'sloped', lowMm: 2450 });
  const ctx = makeCtx(data, { outer: false });
  const wall = data.walls[0];
  assert.ok(ctx.wallTouchesSlopedCeiling(wall), '勾配の部屋に接していると判定されていない');
  const ys = topProfile(ctx, wall, 24, false);
  const d = ys.slice(1).map((v, i) => v - ys[i]);
  const flat = d.filter((v) => Math.abs(v) < 1e-9).length;
  const rise = d.filter((v) => v > 1e-9).length;
  const fall = d.filter((v) => v < -1e-9).length;
  assert.ok(flat >= 2, '平らな区間が無い(勾配が壁の端から始まってしまっている): ' + JSON.stringify(ys));
  assert.ok(rise >= 2 && fall >= 2, '山になっていない rise=' + rise + ' fall=' + fall);
  // 台形（=単一の直線）では説明できないこと: 最小二乗直線からの残差が大きい
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  ys.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) * (i - mx); });
  const slope = sxy / sxx;
  const resid = Math.max.apply(null, ys.map((y, i) => Math.abs(y - (my + slope * (i - mx)))));
  assert.ok(resid > 0.15, '上辺が1本の直線で説明できてしまう(残差 ' + resid + 'm)');
});

test('12-2: 各点で接する2部屋の高い方を採る（低い方に合わせない）', () => {
  const data = house({ type: 'sloped', lowMm: 2000 });
  const ctx = makeCtx(data, { outer: false });
  const wall = data.walls[2];             // 西=勾配の部屋 / 東=平天井の部屋
  const flatRoomH = ctx.roomCeilingHeightM(data.rooms[2]);
  const ys = topProfile(ctx, wall, 24, false);
  assert.ok(ys.every((v) => v >= flatRoomH - 1e-9),
    '平天井側(' + flatRoomH + 'm)より低く切った点がある: ' + JSON.stringify(ys));
  assert.ok(ys.some((v) => v > flatRoomH + 0.2), '勾配側の高い部分を採れていない');
});

test('12-2: 外壁は下げない -- 同じ屋根の下でも外皮の高さを割らない', () => {
  const data = house({ type: 'sloped', lowMm: 2000 });
  const ctxIn = makeCtx(data, { outer: false });
  const ctxOut = makeCtx(data, { outer: true });
  const env = ctxOut.wallFullHeightM(2);
  const outerYs = topProfile(ctxOut, data.walls[1], 24, true);
  assert.ok(outerYs.every((v) => v >= env - 1e-9),
    '外壁が外皮の高さより下へ切られた(ファサードにスリットが貫通する): ' + JSON.stringify(outerYs));
  assert.ok(outerYs.some((v) => v > env + 0.2), '切妻の妻壁が棟まで上がっていない');
  // 同じ屋根の下で、内部間仕切りの方は外皮より下へ落ちること(=下限が効いている証拠)
  const innerYs = topProfile(ctxIn, data.walls[0], 24, false);
  assert.ok(innerYs.some((v) => v < env - 1e-9), '内部間仕切りが下がっていない(比較が成立しない)');
});

test('12-2: 建った壁メッシュの上辺頂点が、実際に折れ線になっている', () => {
  const data = house({ type: 'sloped', lowMm: 2450 });
  const ctx = makeCtx(data, { outer: false });
  ctx.__built.length = 0;
  vm.runInContext('buildWall3D(DATA.walls[0]);', ctx);
  assert.ok(ctx.__built.length > 0, '壁が1つも建っていない');
  // 建った全ピースの頂点から「同じ (along) 位置での最高点」を集める
  const tops = new Map();
  const fy = ctx.floorBaseY(2);
  function walk(o) {
    if (o.children) { o.children.forEach(walk); return; }
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.geometry.isBox) return;                 // 箱の枝は使われていないはず
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // ローカル x = 壁の始点からの距離。position で世界へ移す前の値で十分。
      const along = Math.round((o.position.x - data.walls[0].x1 * ctx.U + p.getX(i)) * 200) / 200;
      const y = o.position.y + p.getY(i) - fy;
      if (!tops.has(along) || tops.get(along) < y) tops.set(along, y);
    }
  }
  ctx.__built.forEach(walk);
  const keys = Array.from(tops.keys()).sort((a, b) => a - b);
  const ys = keys.map((k) => tops.get(k));
  assert.ok(ys.length > 8, '上辺が数点しか無い(区画ごとの2頂点のまま): ' + ys.length);
  const d = ys.slice(1).map((v, i) => v - ys[i]);
  assert.ok(d.some((v) => v > 1e-6) && d.some((v) => v < -1e-6),
    '建った壁の上辺が山になっていない: ' + JSON.stringify(ys.map((v) => Math.round(v * 1000))));
  const distinct = new Set(ys.map((v) => Math.round(v * 100))).size;
  assert.ok(distinct > 5, '上辺の高さが ' + distinct + ' 種類しかない(まっすぐ or 台形)');
});

test('12-2: 勾配を宣言した部屋に接していない壁は、折れ線の枝に入らない', () => {
  const data = house(undefined);
  const ctx = makeCtx(data, { outer: false });
  assert.equal(ctx.wallTouchesSlopedCeiling(data.walls[0]), false);
  ctx.__built.length = 0;
  vm.runInContext('buildWall3D(DATA.walls[0]);', ctx);
  let boxes = 0;
  function walk(o) {
    if (o.children) { o.children.forEach(walk); return; }
    if (o.isMesh && o.geometry && o.geometry.isBox) boxes++;
  }
  ctx.__built.forEach(walk);
  assert.ok(boxes > 0, '従来の Box の枝を通っていない(既存プランのジオメトリが変わる)');
});

test('12-2: 既定プランのどの壁も折れ線の枝に入らない', () => {
  const ctx = makeCtx(PLAN);
  PLAN.walls.forEach((w) => {
    assert.equal(ctx.wallTouchesSlopedCeiling(w), false, 'wall ' + w.id + ' が折れ線の枝に入った');
  });
});

test('12-2: 建った外壁のどの頂点も外皮の高さを割らない（buildWall3D 経由）', () => {
  const data = house({ type: 'sloped', lowMm: 2000 });
  const ctxOut = makeCtx(data, { outer: true });
  const env = ctxOut.wallFullHeightM(2);
  const ys = builtTopProfile(ctxOut, data, 1);           // 西の外壁
  const lowest = Math.min.apply(null, ys);
  assert.ok(lowest >= env - 1e-9,
    '外壁が ' + Math.round((env - lowest) * 1000) + 'mm 切られた(ファサードにスリットが貫通する)');
  assert.ok(Math.max.apply(null, ys) > env + 0.2, '切妻の妻壁が棟まで上がっていない');
});

test('12-2: 同じ屋根の下でも、内部間仕切りは外皮より下へ切られる（buildWall3D 経由）', () => {
  const data = house({ type: 'sloped', lowMm: 2000 });
  const ctxIn = makeCtx(data, { outer: false });
  const env = ctxIn.wallFullHeightM(2);
  const ys = builtTopProfile(ctxIn, data, 0);
  assert.ok(Math.min.apply(null, ys) < env - 1e-9,
    '内部間仕切りが下がっていない(外壁との差が出ない)');
});

test('12-1(最重要): 既定プランの部屋は、屋根から天井を導く経路そのものに入らない', () => {
  const ctx = makeCtx(PLAN);
  PLAN.rooms.forEach((r) => {
    assert.equal(ctx.roomRoofCeilingExtent(r), null, r.id + ' が屋根由来の天井を持った');
  });
});
