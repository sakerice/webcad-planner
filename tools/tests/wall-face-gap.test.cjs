// Task 12-3: 壁コア(Box)と仕上げ板(Plane)のあいだの隙間。
//
// 出どころは git で確認済み(index.html の WALL_EXT_FACE_GAP_M のコメントに残した):
// 外装面は当初「厚さ12mmの板」で、6mm はその**半分の厚み**だった。板を厚みゼロの
// PlaneGeometry に置き換えたとき位置だけが残り、そこで初めて浮きになった。
// だから 6mm/12mm という大きさには理由が無い。理由があるのは
//   (1) ゼロにしないこと -- コアと同一平面にすると自身がZファイトする
//   (2) 壁ごとにずらすこと -- 重なった別の壁同士の外装面が同一平面でZファイトする
// の2つだけ。この検査はその2つを守ったまま隙間が詰まっていることを見る。
//
// grep ではなく、buildWall3D を実際に走らせて**建った板とコアの世界座標の距離**を測る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

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

function ctxFor(walls) {
  const built = [];
  function Attr(a, s) { this.array = a; this.itemSize = s; this.count = a.length / s; }
  Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
  Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
  Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };
  Attr.prototype.setXY = function (i, x, y) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; };
  function Geo() { this.attributes = {}; }
  Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
  Geo.prototype.setIndex = function () { return this; };
  Geo.prototype.addGroup = function () {};
  Geo.prototype.computeVertexNormals = function () {};
  function Plane(w, h) { Geo.call(this); this.kind = 'plane'; this.w = w; this.h = h;
    this.setAttribute('uv', new Attr([0, 0, 1, 0, 0, 1, 1, 1], 2)); }
  Plane.prototype = Object.create(Geo.prototype);
  function Box(w, h, d) { Geo.call(this); this.kind = 'box'; this.depth = d; }
  Box.prototype = Object.create(Geo.prototype);
  function Mesh(g, m) {
    this.isMesh = true; this.geometry = g; this.material = m; this.userData = {};
    const self = this;
    this.position = { x: 0, y: 0, z: 0, set: function (x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
    this.rotation = { x: 0, y: 0, z: 0 };
  }
  const THREE = {
    Mesh: Mesh, PlaneGeometry: Plane, BoxGeometry: Box, BufferGeometry: Geo,
    Float32BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
    MeshStandardMaterial: function (p) { return p; },
    Group: function () { const self = this; this.children = []; this.userData = {};
      this.add = function (o) { self.children.push(o); return o; }; }
  };
  const data = { floors: {}, rooms: [], items: [], walls: walls };
  const ctx = vm.createContext({
    console: console, DATA: data, THREE: THREE, Math: Math, Number: Number,
    isFinite: isFinite, isNaN: isNaN, Array: Array, Object: Object,
    HeightModel: require(join(ROOT, 'assets', 'js', 'height-model.js')),
    sc3: { add: function (o) { built.push(o); return o; } }, __built: built,
    mark3DSelectable: function () {}, markInteriorCutawayCandidate: function () {},
    makeWallCoreMaterial: function () { return {}; },
    makeExteriorWallMaterial: function () { return {}; },
    makeInteriorWallMaterial: function () { return {}; },
    makeWallGlassMaterial: function () { return {}; },
    resolveExteriorWallAppearance: function () { return {}; },
    applyTextureFlip: function () {}, setTextureRepeatNoDistort: function () {},
    wallTextureTileHeight: function () { return 1; },
    getWallExteriorSpans: function (w) { return [{ a: 0, b: 1e9, sign: 1 }]; },
    getWallInteriorFaces: function (w) {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
      return [{ a: 0, b: Math.sqrt(dx * dx + dy * dy) / 1000, sign: -1,
                atStart: false, atEnd: false, fillStartM: 0, fillEndM: 0 }];
    },
    getOpeningWallInfo: function () { return null; },
    isOpeningItemType: function () { return false; },
    isWindowLikeType: function () { return false; },
    isArchOpeningType: function () { return false; },
    doorHeightMm: function () { return 2000; },
    windowHeightMm: function () { return 1200; }, windowSillMm: function () { return 900; },
    roomAtPointOnFloor: function () { return null; },
    buildWinFrames: function () {}
  });
  vm.runInContext([
    topLevelVar('U'), topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'),
    topLevelVar('_ceilingClampWarned'), topLevelVar('CEILING_UNDER_ROOF_OFFSET_MM'), topLevelVar('ROOM_OVERLAP_EPS_MM'),
    topLevelVar('_roofCeilingExtentCache'),
    topLevelVar('WALL_EXT_FACE_GAP_M'), topLevelVar('WALL_INT_FACE_GAP_M'),
    topLevelVar('WALL_FACE_JITTER_M')
  ].concat([
    'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
    'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
    'wallFullHeightM', 'isPositiveNumber', 'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
    'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint',
    'roofItemOverRoom', 'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
    'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
    'ceilingSlopeUnit', 'ceilingSlopeSpan', 'roomExplicitCeilingMm', 'roomCeilingHeightM',
    'roomCeilingSlopeM', 'wallTouchesSlopedCeiling', 'roofTopLimitAtPlanPoint', 'wallRoofTopLimitWorldY', 'wallLimitingRoofs', 'wallTopHeightAtM',
    'wallAdjacentRoomsCeiling', 'wallCeilingHeightM', 'wallHeightMm', 'wallDisplayHeightM',
    'getWallBandRange', 'hasWallTopShape', 'wallTopSide', 'applyWallFaceUv',
    'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM', 'buildWall3D'
  ].map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// 壁は南北(x 一定)に走らせる。ローカルの法線は世界の x そのものになるので、
// 建ったメッシュの position.x から「コア面からの距離」がそのまま読める。
function wallAt(id) {
  return { id: id, floor: 1, x1: 0, y1: 0, x2: 0, y2: 4000, thick: 120 };
}

function gapsOf(ctx, wall) {
  ctx.__built.length = 0;
  vm.runInContext('buildWall3D(DATA.walls[0]);', ctx);
  const core = wall.thick * ctx.U / 2;
  const out = { ext: null, int: null, coreDepth: null };
  function walk(o) {
    if (o.children) { o.children.forEach(walk); return; }
    if (!o.isMesh) return;
    if (o.geometry.kind === 'box') { out.coreDepth = o.geometry.depth; return; }
    const d = Math.abs(o.position.x) - core;
    if (o.userData.exteriorFace) out.ext = d;
    if (o.userData.interiorFace) out.int = d;
  }
  ctx.__built.forEach(walk);
  return out;
}

test('12-3: 仕上げ板はコア面と同一平面にはならない（自身のZファイトを起こさない）', () => {
  for (let id = 0; id < 7; id++) {
    const w = wallAt(id);
    const ctx = ctxFor([w]);
    const g = gapsOf(ctx, w);
    assert.equal(g.coreDepth, w.thick * ctx.U, 'コアの厚みが壁厚と違う');
    assert.ok(g.ext > 1e-6, 'id=' + id + ' 外装板がコアと同一平面 (gap=' + g.ext + ')');
    assert.ok(g.int > 1e-6, 'id=' + id + ' 内装板がコアと同一平面 (gap=' + g.int + ')');
  }
});

test('12-3: 隙間は詰まっている（外装 6mm / 内装 12mm から 1mm 台へ）', () => {
  const w = wallAt(0);                       // ジッタ 0 の壁で素の値を測る
  const ctx = ctxFor([w]);
  const g = gapsOf(ctx, w);
  assert.ok(Math.abs(g.ext * 1000 - 1) < 1e-6, '外装の隙間が ' + (g.ext * 1000) + 'mm');
  assert.ok(Math.abs(g.int * 1000 - 1) < 1e-6, '内装の隙間が ' + (g.int * 1000) + 'mm');
  // ジッタを足しても目に見える段差にならないこと
  for (let id = 0; id < 7; id++) {
    const w2 = wallAt(id);
    const gg = gapsOf(ctxFor([w2]), w2);
    assert.ok(gg.ext * 1000 <= 3.5, 'id=' + id + ' 外装 ' + (gg.ext * 1000) + 'mm');
    assert.ok(gg.int * 1000 <= 3.5, 'id=' + id + ' 内装 ' + (gg.int * 1000) + 'mm');
  }
});

test('12-3: 壁ごとのジッタは残っている（重なった壁同士のZファイト対策を壊さない）', () => {
  const seen = new Set();
  for (let id = 0; id < 7; id++) {
    const w = wallAt(id);
    seen.add(Math.round(gapsOf(ctxFor([w]), w).ext * 1e6));
  }
  assert.equal(seen.size, 7, '壁ごとに面の位置がずれていない(白い破線が戻る): ' + seen.size);
});
