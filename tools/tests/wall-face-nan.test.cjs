// Task 20-1: 壁の仕上げ面のジオメトリに NaN が入る（既存の不具合）。
//
// 症状(Task 18 §7 が記録したもの): 3階建ての矩形プランを斜線制限で切ると、
// 3階の壁4枚の exteriorFace / interiorFace の**計8枚**のジオメトリに NaN が入り、
// three.js が computeBoundingBox / computeBoundingSphere で8件のエラーを出す。
// 壁コアは無傷。「壁4枚に対して壊れるのが8枚(＝仕上げ面だけ)」という壊れ方が
// 原因を1か所に絞る: **コアが通らず仕上げ面だけが通る計算**は、面のオフセット
// (wallExteriorFaceOffsetM / wallInteriorFaceOffsetM)しか無い。
//
// そのオフセットに入っていた式:  ((w && w.id || 0) % 7) * WALL_FACE_JITTER_M
// id は「その壁を1つに定める記号」であって数だとは限らない。ensureObjectIds() は
// 欠けている id を埋めるだけで、取り込んだファイルや共同編集の相手が持ち込んだ
// 文字列の id はそのまま残る。数として読めない id に % を掛けると NaN になる。
// 上辺が折れ線になる経路(slopedFaceMesh)ではオフセットが**頂点の z 座標そのもの**
// なので、position 属性が丸ごと NaN になる。箱の枝ではメッシュの position が NaN
// になり、面が座標の無い場所へ飛ぶ。
//
// grep ではない。index.html から関数を切り出して node:vm で buildWall3D を実際に
// 走らせ、建った全ピースの position 属性とメッシュ位置を読む。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start), depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
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

// ── 頂点を読むためだけの最小 THREE ─────────────────────────────────────
function Attr(a, s) { this.array = a; this.itemSize = s; this.count = a.length / s; }
Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };
Attr.prototype.setXY = function (i, x, y) {
  this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y;
};
function Geo() { this.attributes = {}; this.groups = []; this.index = null; }
Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
Geo.prototype.setIndex = function (a) { this.index = a; return this; };
Geo.prototype.addGroup = function (s, c, m) { this.groups.push({ start: s, count: c, materialIndex: m }); };
Geo.prototype.computeVertexNormals = function () {};
function PlaneGeometry(w, h) {
  Geo.call(this);
  this.setAttribute('position', new Attr([-w / 2, h / 2, 0, w / 2, h / 2, 0,
    -w / 2, -h / 2, 0, w / 2, -h / 2, 0], 3));
  this.setAttribute('uv', new Attr([0, 1, 1, 1, 0, 0, 1, 0], 2));
}
PlaneGeometry.prototype = Object.create(Geo.prototype);
function BoxGeometry(w, h, d) {
  Geo.call(this);
  const p = [];
  [-w / 2, w / 2].forEach((x) => [-h / 2, h / 2].forEach((y) => [-d / 2, d / 2].forEach((z) => p.push(x, y, z))));
  this.setAttribute('position', new Attr(p, 3));
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
  this.children = []; this.userData = {};
  const self = this;
  this.add = function (o) { self.children.push(o); return o; };
}
const THREE = {
  Mesh: Mesh, Group: Group, PlaneGeometry: PlaneGeometry, BoxGeometry: BoxGeometry,
  BufferGeometry: Geo,
  Float32BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  MeshStandardMaterial: function (p) { return Object.assign({ isMat: true }, p); }
};

const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M', 'WALL_TOP_SAMPLE_STEP_M'];
const FNS = [
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal',
  'roofItemOverRoom', 'roofUndersideWorldYAt', 'roofCeilingWorldYAt',
  'roofLocalPoint', 'roofSurfaceHeightAt', 'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan', 'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomAtPointOnFloor', 'wallTouchesSlopedCeiling', 'wallRoofTopLimitWorldY',
  'wallLimitingRoofs', 'wallTopHeightAtM', 'wallTopCutEnv', 'wallTopProfileSimplify', 'wallTopProfileM', 'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'wallHeightMm', 'wallDisplayHeightM',
  'getWallBandRange', 'hasWallTopShape', 'wallTopSide', 'applyWallFaceUv',
  'wallFaceJitterStep', 'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM',
  'buildWall3D'
];

function makeCtx(data) {
  const built = [];
  const ctx = vm.createContext({
    console: { warn: function () {}, log: function () {} },
    HeightModel: HeightModel, DATA: data, THREE: THREE,
    Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN, String: String,
    Array: Array, Object: Object, JSON: JSON,
    isInt: false, PV_INTERIOR_DAYLIGHT: false,
    sc3: { add: function (o) { built.push(o); return o; } },
    __built: built,
    mark3DSelectable: function () {},
    markInteriorCutawayCandidate: function () {},
    makeWallCoreMaterial: function () { return { core: true }; },
    makeExteriorWallMaterial: function () { return { ext: true }; },
    makeInteriorWallMaterial: function () { return { int: true }; },
    makeWallGlassMaterial: function () { return { glass: true }; },
    resolveExteriorWallAppearance: function () { return {}; },
    applyTextureFlip: function () {},
    setTextureRepeatNoDistort: function () {},
    wallTextureTileHeight: function () { return 1; },
    // 外皮に面する壁(＝外装面と内装面の両方が建つ)にする。
    getWallExteriorSpans: function () { return [{ a: 0, b: 1e9, sign: 1 }]; },
    getWallInteriorFaces: function (w) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      const len = Math.sqrt(dx * dx + dy * dy) / 1000;
      return [{ a: 0, b: len, sign: -1, atStart: false, atEnd: false, fillStartM: 0, fillEndM: 0 }];
    },
    getOpeningWallInfo: function () { return null; },
    isOpeningItemType: function () { return false; },
    isWindowLikeType: function () { return false; },
    isArchOpeningType: function () { return false; },
    doorHeightMm: function () { return 2000; },
    windowHeightMm: function () { return 1200; },
    windowSillMm: function () { return 900; }
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// 上辺が折れ線になる家。2階の部屋に勾配天井を宣言し、その上に切妻屋根を載せる
// ＝ buildWall3D が addSlopedTopWallPiece / slopedFaceMesh を通る枝。
// 斜線制限で切られた3階もまったく同じ枝を通る(斜線は片流れ屋根を1枚建てて
// roomCeilingProfile を 'roof' にするだけで、壁側の経路は共有している)。
function slopedHouse(wallId) {
  return {
    floors: {},
    rooms: [{ id: 'attic', n: '勾配の部屋', floor: 2, x: 0, y: 0, w: 4000, d: 6000,
      ceiling: { type: 'sloped', lowMm: 2200 } }],
    walls: [{ id: wallId, floor: 2, x1: -100, y1: -200, x2: -100, y2: 6200, thick: 120 }],
    items: [{ id: 9, type: 'roof', floor: 3, x: -500, y: 1000, w: 10500, d: 7000,
      rot: 0, elev: 0, roofType: 'gable', pitch: 35 }]
  };
}
// 上辺がまっすぐな家(屋根も勾配天井も無い)＝ 箱の枝。
function flatHouse(wallId) {
  return {
    floors: {},
    rooms: [{ id: 'plain', n: '平天井の部屋', floor: 2, x: 0, y: 0, w: 4000, d: 6000 }],
    walls: [{ id: wallId, floor: 2, x1: -100, y1: -200, x2: -100, y2: 6200, thick: 120 }],
    items: []
  };
}

// 建った全ピースを平らに集める。
function builtMeshes(ctx) {
  const out = [];
  function walk(o) {
    if (o.children) { o.children.forEach(walk); return; }
    if (o.isMesh) out.push(o);
  }
  ctx.__built.forEach(walk);
  return out;
}
// 「非数がどこにあるか」を人が読める形で返す。空配列 = 健全。
function nonFinite(meshes) {
  const bad = [];
  meshes.forEach((m, mi) => {
    const kind = m.userData.exteriorFace ? 'exteriorFace'
      : m.userData.interiorFace ? 'interiorFace' : 'core';
    ['x', 'y', 'z'].forEach((k) => {
      if (!Number.isFinite(m.position[k])) bad.push('mesh#' + mi + '(' + kind + ').position.' + k);
    });
    const g = m.geometry, p = g && g.attributes && g.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.array.length; i++) {
      if (!Number.isFinite(p.array[i])) {
        bad.push('mesh#' + mi + '(' + kind + ').position[' + i + ']');
        break;
      }
    }
  });
  return bad;
}
function build(data) {
  const ctx = makeCtx(data);
  ctx.__built.length = 0;
  vm.runInContext('buildWall3D(DATA.walls[0]);', ctx);
  const meshes = builtMeshes(ctx);
  assert.ok(meshes.length > 0, '壁が1つも建っていない');
  return { ctx: ctx, meshes: meshes };
}

// ══ 20-1 本体 ═════════════════════════════════════════════════════════
test('20-1(最重要): 数でない id を持つ壁でも、仕上げ面のジオメトリに非数が1つも入らない', () => {
  // 取り込んだファイルや共同編集の相手が持ち込みうる id。ensureObjectIds() は
  // undefined/null しか埋めないので、これらはそのまま壁に残る。
  ['wall-3', 'W82', 'a', 'ext_1778673921743', '', 'ﾃｽﾄ'].forEach((id) => {
    const { meshes } = build(slopedHouse(id));
    const faces = meshes.filter((m) => m.userData.exteriorFace || m.userData.interiorFace);
    assert.ok(faces.length >= 2,
      'id=' + JSON.stringify(id) + ' で仕上げ面が建っていない（検査が空振りしている）');
    assert.deepEqual(nonFinite(meshes), [],
      'id=' + JSON.stringify(id) + ' の壁に非数が入った');
  });
});

test('20-1(最重要): 数でない id でも、まっすぐな上辺の壁の仕上げ面が座標を失わない', () => {
  // 箱の枝ではオフセットは**メッシュの位置**に入る。ジオメトリは無傷のまま
  // 面だけが座標の無い場所へ飛ぶので、頂点だけ見ていると見逃す。
  const { meshes } = build(flatHouse('wall-3'));
  const faces = meshes.filter((m) => m.userData.exteriorFace || m.userData.interiorFace);
  assert.ok(faces.length >= 2, '箱の枝で仕上げ面が建っていない（検査が空振りしている）');
  assert.deepEqual(nonFinite(meshes), []);
});

test('20-1(最重要): 数の id では、ジッタは今までの ((id%7)*段) から1ビットも動かない', () => {
  const ctx = makeCtx(slopedHouse(1));
  const step = ctx.WALL_FACE_JITTER_M;
  // 期待値は index.html の式を写さず、不具合の前にあった式をここで独立に書く。
  const before = (id) => ((id || 0) % 7) * step;
  [0, 1, 6, 7, 8, 82, 114, 1778673921743, 2, 3, 4, 5].forEach((id) => {
    assert.equal(ctx.wallFaceJitterM({ id: id }), before(id), 'id=' + id);
  });
  // 数として読める文字列の id も、数のときとまったく同じ値でなければならない。
  ['82', '7', '0'].forEach((s) => {
    assert.equal(ctx.wallFaceJitterM({ id: s }), before(Number(s)), 'id=' + JSON.stringify(s));
  });
  // id を持たない壁・壁そのものが無い場合も従来どおり 0。
  assert.equal(ctx.wallFaceJitterM({}), 0);
  assert.equal(ctx.wallFaceJitterM(null), 0);
});

test('20-1: 数でない id のジッタは、0..6 段の中で決まり、同じ id なら必ず同じ値', () => {
  const ctx = makeCtx(slopedHouse(1));
  const ids = ['wall-3', 'W82', 'a', 'b', 'ext_1778673921743', 'ﾃｽﾄ', {}, [], undefined];
  ids.forEach((id) => {
    const v = ctx.wallFaceJitterStep(id);
    assert.ok(Number.isFinite(v), 'id=' + String(id) + ' の段が非数');
    assert.ok(v >= 0 && v < 7 && v === Math.floor(v), 'id=' + String(id) + ' の段が 0..6 の整数でない: ' + v);
    assert.equal(ctx.wallFaceJitterStep(id), v, 'id=' + String(id) + ' の段が呼ぶたびに変わる');
  });
  // ジッタの役目は「重なった別の壁同士の面を同一平面にしない」ことなので、
  // 別の id が別の段を取れること自体を確かめる（全部 0 に潰す実装を許さない）。
  const steps = ids.map((id) => ctx.wallFaceJitterStep(id));
  assert.ok(new Set(steps).size > 1, '数でない id が全部同じ段に潰れている: ' + JSON.stringify(steps));
});

test('20-1: 面のオフセットは、どんな id でも「厚み/2 + 隙間」以上で有限', () => {
  const ctx = makeCtx(slopedHouse(1));
  const w = { id: 'wall-3', thick: 120 };
  const half = w.thick * ctx.U / 2;
  [ctx.wallExteriorFaceOffsetM(w), ctx.wallInteriorFaceOffsetM(w)].forEach((v) => {
    assert.ok(Number.isFinite(v), 'オフセットが非数: ' + v);
    // ゼロにしない（コアと同一平面にするとZファイトする）という Task 12-3 の条件。
    assert.ok(v > half, 'オフセットがコア面まで戻っている: ' + v + ' <= ' + half);
  });
});
