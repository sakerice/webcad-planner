// Task 25-3: 角で2つの制限が交わるところ。
//
// 片方の面に架かった屋根が、もう片方の制限を超えたまま建っていた。谷(2つの
// 制限面が交わる線)の向こうは、もう一方の面の屋根の領分である。
//
// grep ではない。index.html から関数を波括弧の対応で切り出し、node:vm で走らせ、
// **実際にメッシュを建て、削り、板を架けてから頂点を読む**。
// 期待値は index.html の式を写さず、条文と幾何から独立に書いている:
//   北側 = 5000 + 1.25 × 北側境界からの水平距離
//   道路 = 1.25 × 道路の反対側の境界からの水平距離
//   その位置で効くのは **低いほうの制限** である。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

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

// ── 頂点を読むためだけの最小 THREE ───────────────────────────────────────
function Attr(array, itemSize) {
  this.array = array; this.itemSize = itemSize;
  this.count = array.length / itemSize;
}
Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };
function Geo() { this.attributes = {}; this.index = null; this.boundingBox = null; this.groups = []; this.disposed = false; }
Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
Geo.prototype.addGroup = function (s, c, m) { this.groups.push({ start: s, count: c, materialIndex: m }); };
Geo.prototype.dispose = function () { this.disposed = true; };
Geo.prototype.computeVertexNormals = function () {};
Geo.prototype.computeBoundingBox = function () {
  const p = this.attributes.position;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < p.count; i++) {
    min.x = Math.min(min.x, p.getX(i)); max.x = Math.max(max.x, p.getX(i));
    min.y = Math.min(min.y, p.getY(i)); max.y = Math.max(max.y, p.getY(i));
    min.z = Math.min(min.z, p.getZ(i)); max.z = Math.max(max.z, p.getZ(i));
  }
  this.boundingBox = { min, max };
};
function Vector3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
Vector3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Vector3.prototype.applyMatrix4 = function (m) {
  const e = m.elements, x = this.x, y = this.y, z = this.z;
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  return this;
};
function Obj3D() {
  this.children = []; this.userData = {}; this.visible = true;
  const self = this;
  this.position = { x: 0, y: 0, z: 0, set: function (x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
  this.rotation = { x: 0, y: 0, z: 0 };
  this.scale = { x: 1, y: 1, z: 1, set: function () {} };
  this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
}
Obj3D.prototype.add = function (o) { this.children.push(o); return o; };
Obj3D.prototype.traverse = function (cb) {
  cb(this);
  this.children.forEach(function (c) { if (c.traverse) c.traverse(cb); else cb(c); });
};
function Group() { Obj3D.call(this); this.isGroup = true; }
Group.prototype = Object.create(Obj3D.prototype);
function Mesh(geo, mat) { Obj3D.call(this); this.isMesh = true; this.geometry = geo; this.material = mat; }
Mesh.prototype = Object.create(Obj3D.prototype);
function LineSegments(geo, mat) { Obj3D.call(this); this.isLine = true; this.geometry = geo; this.material = mat; }
LineSegments.prototype = Object.create(Obj3D.prototype);
function Sprite(mat) { Obj3D.call(this); this.isSprite = true; this.material = mat; }
Sprite.prototype = Object.create(Obj3D.prototype);

const THREE = {
  Group: Group, Mesh: Mesh, LineSegments: LineSegments, Sprite: Sprite,
  BufferGeometry: Geo,
  Float32BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  MeshBasicMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  MeshStandardMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  LineBasicMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  SpriteMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  CanvasTexture: function () { return { colorSpace: null }; },
  RepeatWrapping: 1000, Vector3: Vector3, DoubleSide: 2, SRGBColorSpace: 'srgb'
};

const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', 'ROOM_OVERLAP_EPS_MM',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', '_ceilingClampWarned',
  'SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M', 'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX', 'SETBACK_CUT_SAMPLES', 'SETBACK_ROOF_MAX_RECTS',
  'SETBACK_SECTION_CELL_MM', 'SETBACK_SECTION_MAX_CELLS', 'SETBACK_VALLEY_LAP_MM',
  'SETBACK_NORTH_COLOR', 'SETBACK_ROAD_COLOR', 'SETBACK_OVER_COLOR',
  'CONTEXT_EXTERIOR_TYPES', '_setbackRoofCache', '_setbackRoofCacheKey',
  '_setbackRoomRoofsCache', '_setbackRoomRoofsCacheKey',
  'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M', 'WALL_TOP_SAMPLE_STEP_M'];

const FNS = [
  'computeSunPosition',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'setbackClipsCoverPlan', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal',
  'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomAtPointOnFloor', 'wallRoofTopLimitWorldY', 'wallLimitingRoofs', 'wallTopHeightAtM',
  'wallFaceJitterStep', 'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM',
  'getObjBounds', 'isFiniteCanvasValue',
  'isContextExteriorItemType', 'isGroundLevelItemType',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg',
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane',
  'setbackDistanceMm', 'setbackLimitHeightMmAt', 'setbackPointAt',
  'setbackPlanes', 'setbackPlaneQuadMm', 'setbackPlaneWorldCoef',
  'setbackTriSide', 'splitTriangleBySetbackPlane', 'setbackTriF', 'setbackLerpVert',
  'clipTriangleAboveSetbackPlane',
  'isSetbackSubjectMesh', 'setbackSubjectMeshes', 'setbackLiveCoefsForMesh',
  'collectSetbackOverhangTris', 'setbackOverhangAudit',
  'setbackBuildingPlanBoundsMm', 'setbackBuildingTopWorldYAt', 'setbackCutSpanMm',
  'setbackRoofTemplateItem', 'setbackPlaneKeyOf', 'setbackRoofItemForPlane', 'setbackRoofItems',
  'clipPlanPolyByRoofLocal', 'roofRoomOverlapPointsMm', 'setbackRoofsOverRoom',
  'setbackWorldToTS', 'setbackSectionTris', 'setbackTriSRangeInBand', 'setbackSectionFootprint',
  'setbackBindingClipPlan', 'setbackBindingClipsPlan', 'setbackOtherPlaneClips', 'setbackClipValue', 'setbackRectHasEdge',
  'setbackClipPolygon', 'setbackClipSegment',
  'setbackFootprintRects', 'setbackFootprintEdges',
  'setbackSlabAppearanceItem', 'setbackLowestLimitMmAt',
  'build3DSetbackRoofSlab', 'setbackSectionsForBuild', 'build3DSetbackRoofs',
  'setbackCutGeometry', 'applySetbackCut',
  'build3DRoofItem'
];

function makeCtx(data, opts) {
  const o = opts || {};
  const sc3 = new Group();
  const ctx = vm.createContext({
    console: { warn: function () {}, log: function () {} },
    Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN,
    Array: Array, Object: Object, JSON: JSON, String: String,
    SetbackLaw: Law, HeightModel: HeightModel, THREE: THREE,
    DATA: data, ST: { showDim: true, selected: null }, sc3: sc3,
    LIGHT_SETTINGS: { northDeg: 0, hour: 13, season: 'equinox', sunSim: false },
    isInt: false, isWalkView: function () { return false; },
    exteriorDetailEnabled: function () { return false; },
    build3DRoofGutters: function () {},
    resolveRoofAppearance: function () { return { color: '#222', texture: null }; },
    getTexture3D: function () { return null; },
    cloneRepeatReadyTexture: function () { return null; },
    setTextureRepeatNoDistort: function () {},
    applyTextureFlip: function () {},
    makeExteriorLightingMaterial: function (p) { return Object.assign({ isMat: true }, p); },
    invalidate3D: function () {},
    __sc3: sc3
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  // 方位はプランの持ち物(Task 19)。LIGHT_SETTINGS へ直接書かず、アプリと同じ入口を通す。
  if (o.northDeg !== undefined) vm.runInContext('setPlanNorthDeg(' + o.northDeg + ')', ctx);
  return ctx;
}
function run(ctx, src) { return vm.runInContext(src, ctx); }
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ══ 試験用の敷地と建物 ════════════════════════════════════════════════
// 敷地 x:-1000..7000 / y:0..7000。北側境界は y=0、道路は東側(幅員 8000、
// 反対側の境界は x=10000)。建物は x:0..6000 / y:1000..5000、天端 8550mm の箱。
//
// 条文と幾何から独立に解いた制限:
//   北側 limit(y) = 5000 + 1.25 y        （y=2840 で 8550 = 建物の天端）
//   道路 limit(x) = 1.25 (10000 - x)     （x=3160 で 8550）
//   谷    = 両者が等しい線 = x + y = 6000
const BOTH = { zone: 'low1', road: true, north: true };
const NORTH_ONLY = { zone: 'low1', road: false, north: true };
const TOP_M = 8.55;
function northLimitMm(yMm) { return 5000 + 1.25 * yMm; }
function roadLimitMm(xMm) { return 1.25 * (10000 - xMm); }
function lowerLimitMm(xMm, yMm) { return Math.min(northLimitMm(yMm), roadLimitMm(xMm)); }

function cornerPlan(setback, withRoad) {
  const site = { id: 'site', type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  if (setback) site.setback = JSON.parse(JSON.stringify(setback));
  const items = [site,
    { id: 'roof1', type: 'roof', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
      rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }];
  if (withRoad) items.push({ id: 'road1', type: 'road', x: 4500, y: 2000, w: 8000, d: 3000, rot: 90 });
  const rooms = [], walls = [];
  [1, 2, 3].forEach((f) => {
    rooms.push({ id: 'r' + f, n: f + '階', floor: f, x: 0, y: 1000, w: 6000, d: 4000 });
    walls.push({ id: 'wn' + f, floor: f, x1: 0, y1: 1000, x2: 6000, y2: 1000, thick: 120 });
    walls.push({ id: 'ws' + f, floor: f, x1: 6000, y1: 5000, x2: 0, y2: 5000, thick: 120 });
  });
  return { items, rooms, walls, floorMetadata: {} };
}

// 建物の実体。x:0..6000 / y:1000..5000 / 高さ 0..8550 の閉じた箱を三角形で建てる。
// 削るのも断面を測るのも **実物の三角形** なので、ここは近似ではなく本物を置く。
function addBuildingBox(ctx) {
  const x0 = 0, x1 = 6, z0 = 1, z1 = 5, y0 = 0, y1 = TOP_M;
  const P = [];
  const q = (a, b, c, d) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); };
  q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);     // 屋根面
  q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);     // 北の壁
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);     // 南の壁
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);     // 西の壁
  q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);     // 東の壁
  run(ctx, 'var __p=' + JSON.stringify(P) + ';'
    + 'var __g=new THREE.BufferGeometry();'
    + '__g.setAttribute("position",new THREE.Float32BufferAttribute(__p,3));'
    + 'var __m=new THREE.Mesh(__g,null); __m.userData={b:true}; sc3.add(__m);');
}
// 実際の build3D と同じ順番: 断面を測る → 削る → 板を架ける。
function buildLikeApp(ctx) {
  run(ctx, 'var __secs=setbackSectionsForBuild(); applySetbackCut(); build3DSetbackRoofs(__secs);');
}
// 同じ順番で建てるが、板を **自分の面1枚だけ** で張る(= 2枚目の制限で切らない)。
// 直す前の姿を実際に作ってみせるためのもので、赤いはみ出し表示がそれを
// 見られるかどうかをここで確かめる。
function buildIgnoringOtherPlanes(ctx) {
  run(ctx, 'var __secs=setbackSectionsForBuild(); applySetbackCut();'
    + '__secs.forEach(function(s){ build3DSetbackRoofSlab(s.plane,s.fp,[s.plane]); });');
}
function slabVerts(ctx) {
  return run(ctx, '(function(){var out=[];sc3.traverse(function(o){'
    + 'if(o.isMesh&&o.userData&&o.userData.setbackRoof){var p=o.geometry.attributes.position;'
    + 'for(var i=0;i<p.count;i++) out.push([p.getX(i),p.getY(i),p.getZ(i)]);}});return out;})()');
}
function itemOfKind(ctx, kind) {
  const its = plain(run(ctx, 'setbackRoofItems()'));
  return its.filter((it) => it.setbackKind === kind)[0];
}
function covers(ctx, kind, x, y) {
  return run(ctx, '(function(){var its=setbackRoofItems().filter(function(i){return i.setbackKind==="'
    + kind + '";}); return its.length?roofCoversPlanPoint(its[0],' + x + ',' + y + '):null;})()');
}

// ══ 1. 谷の向こうはもう一方の面の領分 ═════════════════════════════════

test('25-3(最重要): 角の2つの制限が本当に交わっている(試験が空振りしていない)', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  const pls = plain(run(ctx, 'setbackPlanes()'));
  assert.deepEqual(pls.map((p) => p.kind).sort(), ['north', 'road'], '面が2枚できている');
  // 谷 x+y=6000 は建物(x:0..6000 / y:1000..5000)を横切る。
  assert.ok(northLimitMm(2000) < roadLimitMm(1000), '西寄りでは北側が低い');
  assert.ok(roadLimitMm(5000) < northLimitMm(2000), '東寄りでは道路が低い');
  // 両方の制限が実際に建物を削っている。
  assert.ok(northLimitMm(1000) < TOP_M * 1000, '北側斜線が天端より低い所がある');
  assert.ok(roadLimitMm(6000) < TOP_M * 1000, '道路斜線が天端より低い所がある');
});

test('25-3(最重要): 北側斜線の屋根は、道路斜線のほうが低い所には架からない', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  const north = itemOfKind(ctx, 'north');
  const road = itemOfKind(ctx, 'road');
  assert.ok(north && road, '屋根アイテムが2枚できている');
  // 屋根アイテムの矩形そのものは谷の向こうまで伸びている(= 覆いの判定で切っている)。
  assert.ok(north.x + north.w > 5000, '北の屋根の矩形が谷の向こうまで届いている: ' + (north.x + north.w));
  // 谷の向こう(x+y>6000)は道路の領分。北の屋根は架からず、道路の屋根が架かる。
  [[5000, 2000], [5500, 1500], [4500, 2500]].forEach(([x, y]) => {
    assert.ok(x + y > 6000, '谷の向こうの点を選んでいる: ' + x + ',' + y);
    assert.equal(covers(ctx, 'north', x, y), false, '(' + x + ',' + y + ') に北の屋根が架かっている');
    assert.equal(covers(ctx, 'road', x, y), true, '(' + x + ',' + y + ') に道路の屋根が架かっていない');
  });
  // 谷のこちら側(x+y<6000)は北側の領分。
  [[1000, 2000], [2000, 1500], [500, 2500]].forEach(([x, y]) => {
    assert.ok(x + y < 6000, '谷のこちら側の点を選んでいる: ' + x + ',' + y);
    assert.equal(covers(ctx, 'north', x, y), true, '(' + x + ',' + y + ') に北の屋根が架かっていない');
  });
});

test('25-3(最重要): 屋根アイテムの屋根面は、どこでも低いほうの制限を超えない', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  let worst = 0, worstAt = null, checked = 0;
  ['north', 'road'].forEach((kind) => {
    const it = itemOfKind(ctx, kind);
    assert.ok(it, kind + ' の屋根が無い');
    for (let x = 100; x <= 5900; x += 100) {
      for (let y = 1100; y <= 4900; y += 100) {
        if (!covers(ctx, kind, x, y)) continue;
        checked++;
        const h = run(ctx, '(function(){var it=setbackRoofItems().filter(function(i){'
          + 'return i.setbackKind==="' + kind + '";})[0];'
          + 'return roofCeilingWorldYAt(it,' + x + ',' + y + ')/U;})()');
        const over = h - lowerLimitMm(x, y);
        if (over > worst) { worst = over; worstAt = [kind, x, y, Math.round(h), Math.round(lowerLimitMm(x, y))]; }
      }
    }
  });
  assert.ok(checked > 200, '見た点が少なすぎる: ' + checked);
  assert.ok(worst <= 2, '低いほうの制限を ' + Math.round(worst) + 'mm 超えている: ' + JSON.stringify(worstAt));
});

test('25-3(最重要): 制限が1枚だけのプランでは、屋根アイテムは1プロパティも増えない', () => {
  const ctx = makeCtx(cornerPlan(NORTH_ONLY, false));
  const its = plain(run(ctx, 'setbackRoofItems()'));
  assert.equal(its.length, 1, '屋根が1枚');
  assert.equal('setbackClips' in its[0], false, '谷が1つも無いのに setbackClips が付いている');
  assert.equal('setbackPlaneKey' in its[0], false, '谷が1つも無いのに setbackPlaneKey が付いている');
  // 覆いの判定も今までどおり矩形そのもの。
  assert.equal(run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],3000,1500)'), true);
});

// ══ 2. 建った物のどの頂点も、どの制限面より上に無い ═══════════════════

test('25-3(最重要): 削って板を架けたあと、制限面より上の頂点が0個(屋根板を含む)', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  addBuildingBox(ctx);
  const before = plain(run(ctx, 'setbackOverhangAudit()'));
  assert.ok(before.overVerts > 0, '削る前に超えている頂点がある(比較が空振りしていない)');
  buildLikeApp(ctx);
  const after = plain(run(ctx, 'setbackOverhangAudit()'));
  assert.ok(after.subjects > before.subjects, '屋根板がシーンに建っている: ' + JSON.stringify(after));
  assert.equal(after.overVerts, 0, '制限面より上に頂点が残っている: ' + JSON.stringify(after));
  assert.equal(after.tris, 0, '制限面より上の三角形が残っている: ' + JSON.stringify(after));
  // 板そのものも、条文から独立に解いた「低いほうの制限」を超えない。
  const vs = slabVerts(ctx);
  assert.ok(vs.length > 0, '板が1枚も建っていない');
  vs.forEach((v) => {
    const lim = lowerLimitMm(v[0] * 1000, v[2] * 1000) / 1000;
    assert.ok(v[1] <= lim + 1e-6, '板の頂点 ' + v[1] + ' が制限 ' + lim + ' を超えている');
  });
});

// ══ 3. 赤いはみ出し表示は、屋根板のはみ出しも見る ═════════════════════
// これを見落としていたことが、この不具合を隠していた。**見えることを実行して確かめる**。

test('25-3(最重要): 屋根板は、はみ出しを数える対象そのものである', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  addBuildingBox(ctx);
  buildLikeApp(ctx);
  const n = run(ctx, '(function(){var a=0,b=0;sc3.traverse(function(o){'
    + 'if(o.isMesh&&o.userData&&o.userData.setbackRoof){a++; if(isSetbackSubjectMesh(o)) b++;}'
    + '});return [a,b];})()');
  assert.ok(n[0] > 0, '板が建っていない');
  assert.equal(n[1], n[0], '板の ' + (n[0] - n[1]) + ' 枚がはみ出しの計測から外れている');
});

test('25-3(最重要): 板が2枚目の制限で切られていなければ、赤いはみ出しがそれを捉える', () => {
  const ok = makeCtx(cornerPlan(BOTH, true));
  addBuildingBox(ok);
  buildLikeApp(ok);
  assert.equal(plain(run(ok, 'setbackOverhangAudit()')).overVerts, 0, '直っている側は0個');
  // まったく同じ順番で建て、板だけを「自分の面1枚」で張る = 直す前の姿。
  const ctx = makeCtx(cornerPlan(BOTH, true));
  addBuildingBox(ctx);
  buildIgnoringOtherPlanes(ctx);
  const bad = plain(run(ctx, 'setbackOverhangAudit()'));
  assert.ok(bad.overVerts > 0,
    'はみ出し表示が屋根板のはみ出しを1つも見ていない: ' + JSON.stringify(bad));
  assert.ok(bad.tris > 0, '赤く塗る三角形が1枚も作られていない: ' + JSON.stringify(bad));
  assert.ok(bad.maxOverMm > 100,
    '超えている量が測れていない: ' + bad.maxOverMm + 'mm');
  // 実際に超えている板の頂点があること(条文から独立に解いた制限で見る)。
  let over = 0, worst = 0;
  slabVerts(ctx).forEach((v) => {
    const d = v[1] - lowerLimitMm(v[0] * 1000, v[2] * 1000) / 1000;
    if (d > 1e-6) { over++; if (d > worst) worst = d; }
  });
  assert.ok(over > 0, '板の頂点が1つも超えていない(再現できていない)');
  assert.ok(worst * 1000 > 100, '超えている量: ' + Math.round(worst * 1000) + 'mm');
});

// ══ 4. 谷は「板が二重にならない」ことでもある ═════════════════════════
// 谷で切らないと、2枚の板が同じ所を二重に張る。上面は同じ高さ(低いほうの制限)に
// 来るので、赤いはみ出しには出ないが、画面ではちらつく縞になる。
// **建った三角形そのものを読んで**、二重になっていないことを確かめる。

// 建った板の上面(＝低いほうの制限に載っている面)の三角形を、平面(x,y mm)で返す。
// どの板(グループ)のものかを添える -- 「二重」はグループの枚数で数えるからである
// (1枚の板の中でも上面は複数の三角形に分かれていて、辺の上では2枚に数えられる)。
function slabTopTrisPlan(ctx) {
  return run(ctx, '(function(){var out=[],gi=-1;sc3.children.forEach(function(g){'
    + 'if(!(g.userData&&g.userData.setbackRoof)) return; gi++;'
    + 'var pls=setbackPlanes();'
    + '(g.children||[]).forEach(function(o){'
    + '  if(!(o.isMesh&&o.geometry&&o.geometry.attributes.position)) return;'
    + '  var p=o.geometry.attributes.position;'
    + '  for(var i=0;i+2<p.count;i+=3){var v=[],ok=true;'
    + '    for(var k=0;k<3;k++){var x=p.getX(i+k)*1000,y=p.getY(i+k),z=p.getZ(i+k)*1000;'
    + '      var lim=Infinity;'
    + '      for(var q=0;q<pls.length;q++) lim=Math.min(lim,setbackLimitHeightMmAt(pls[q],x,z));'
    + '      if(Math.abs(y*1000-lim)>1) ok=false;'
    + '      v.push([x,z]);}'
    + '    if(ok) out.push({g:gi,t:v});}'
    + '});});return out;})()');
}
function triContains(t, x, y) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(t[0], t[1], [x, y]), d2 = d(t[1], t[2], [x, y]), d3 = d(t[2], t[0], [x, y]);
  const neg = (d1 < -1e-9) || (d2 < -1e-9) || (d3 < -1e-9);
  const pos = (d1 > 1e-9) || (d2 > 1e-9) || (d3 > 1e-9);
  return !(neg && pos);
}
// その点を覆っている **板の枚数**。
function slabsOver(tris, x, y) {
  const gs = {};
  tris.forEach((r) => { if (triContains(r.t, x, y)) gs[r.g] = 1; });
  return Object.keys(gs).length;
}

test('25-3(最重要): 谷の外では、板が二重に張られていない(縞にならない)', () => {
  const ctx = makeCtx(cornerPlan(BOTH, true));
  addBuildingBox(ctx);
  buildLikeApp(ctx);
  const tris = slabTopTrisPlan(ctx);
  assert.ok(tris.length > 0, '板の上面が1枚も無い');
  assert.ok(Object.keys(tris.reduce((m, r) => { m[r.g] = 1; return m; }, {})).length === 2,
    '板が2枚建っている');
  let n = 0, covered = 0, doubled = 0, worstAt = null;
  for (let x = 100; x <= 5900; x += 100) {
    for (let y = 1100; y <= 4900; y += 100) {
      if (lowerLimitMm(x, y) >= TOP_M * 1000) continue;      // そこは削られていない
      // 谷のごく近く(制限の差が 50mm 以内)は 1mm ぶん重ねてあるので数えない。
      if (Math.abs(northLimitMm(y) - roadLimitMm(x)) < 50) continue;
      n++;
      const k = slabsOver(tris, x, y);
      if (k >= 1) covered++;
      if (k > 1) { doubled++; if (!worstAt) worstAt = [x, y, k]; }
    }
  }
  assert.ok(n > 100, '見た点が少なすぎる: ' + n);
  assert.ok(covered / n > 0.9, '削られた所が板で覆われていない: ' + covered + '/' + n);
  assert.equal(doubled, 0, '谷から離れた所で板が二重: ' + JSON.stringify(worstAt));
});

// ══ 28 板の「外接矩形」と「輪郭」を取り違えない ═══════════════════════════
//
// 背景(Task 27): 斜線の切り口に架かる板(setbackRoofItems)のアイテムは、
// **切り口の外接矩形を制限面の座標系で採ったもの** である。方位が振れると切り口は
// (t,s) 平面で斜めの帯になるので、その外接矩形は建物の外まで張り出す。立面図は
// その矩形をそのまま立体として描いていて、建物のどこにも対応しない長方形を出して
// いた(Task 27 で取りやめ)。
//
// 天井の側は同じ板を読んでいる。読んでいる場所は2つある:
//   ・setbackRoofsOverRoom … その部屋に架かる板を選ぶ
//   ・roofTopLimitAtPlanPoint … 点ごとに、覆っている板の下面で頭を押さえる
// どちらも覆いの判定を roofCoversPlanPoint に任せていて、その中では
// **凹みのある切り口は setbackOutline(重ならない矩形の集まり)で見る**。
// だから天井には外接矩形の張り出しが届かない。ここでそれを実測で押さえる。

// 方位 θ を振ったときの北側斜線。条文と幾何から独立に解く:
//   真北 = (sin θ, −cos θ)。北側境界線は敷地を北から支える辺で、面はそこから
//   真南 s = (−sin θ, cos θ) の向きへ 1.25 の勾配で立ち上がる(基準 5000mm)。
function northLimitAtDegMm(deg, xMm, yMm) {
  const a = deg * Math.PI / 180;
  const sx = -Math.sin(a), sy = Math.cos(a);
  let d0 = Infinity;
  [[-1000, 0], [7000, 0], [7000, 7000], [-1000, 7000]].forEach((c) => {
    d0 = Math.min(d0, sx * c[0] + sy * c[1]);
  });
  return 5000 + 1.25 * (sx * xMm + sy * yMm - d0);
}
function lowerLimitAtDegMm(deg, xMm, yMm) {
  return Math.min(northLimitAtDegMm(deg, xMm, yMm), roadLimitMm(xMm));
}
// 凸多角形を半平面 f(p) <= 0 で切る(サザーランド・ホジマン)。
function clipConvex(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
// 点から凸多角形までの距離(中は 0)。
function distToConvex(poly, p) {
  if (poly.length < 3) return Infinity;
  let neg = false, pos = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c < -1e-9) neg = true;
    if (c > 1e-9) pos = true;
  }
  if (!(neg && pos)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + dx * t, qy = a[1] + dy * t;
    best = Math.min(best, Math.hypot(p[0] - qx, p[1] - qy));
  }
  return best;
}
// 実際に削られる平面領域 = 建物の footprint のうち、低いほうの制限が天端より
// 低い所。min(北,道路) < 8550 は2つの半平面の **和** なので、凸な2枚に分けて持つ。
//   北側: 5000 + 1.25(s·p − d0) < 8550  ⇔  s·p < d0 + 2840
//   道路: 1.25(10000 − x) < 8550        ⇔  x > 3160
function cutPiecesAtDeg(deg) {
  const box = [[0, 1000], [6000, 1000], [6000, 5000], [0, 5000]];
  return [
    clipConvex(box, (p) => northLimitAtDegMm(deg, p[0], p[1]) - TOP_M * 1000),
    clipConvex(box, (p) => roadLimitMm(p[0]) - TOP_M * 1000)
  ];
}
function distToCut(deg, p) {
  const ps = cutPiecesAtDeg(deg);
  return Math.min(distToConvex(ps[0], p), distToConvex(ps[1], p));
}
// その方位で、板が「覆っている」と答えた点(平面 mm)を格子で集める。
//   kind='outline' … 製品どおり roofCoversPlanPoint(輪郭で見る)
//   kind='bbox'    … 板のアイテムの外接矩形だけで見る(立面図が見ていた形)
function coveredPointsMm(ctx, kind) {
  return plain(run(ctx, '(function(){var items=setbackRoofItems(), out=[];'
    + 'function bbox(it,x,y){var lp=roofLocalPoint(it,x,y);'
    + ' return Math.abs(lp.x)<=it.w*U/2+1e-6 && Math.abs(lp.z)<=it.d*U/2+1e-6;}'
    + 'for(var x=-2000;x<=9000;x+=100) for(var y=-2000;y<=8000;y+=100){'
    + ' for(var i=0;i<items.length;i++){'
    + '  if(' + (kind === 'bbox' ? 'bbox(items[i],x,y)' : 'roofCoversPlanPoint(items[i],x,y)') + '){'
    + '   out.push([x,y]); break; } } }'
    + 'return out;})()'));
}

test('28(最重要): 天井が見る板の覆いは、実際の切り口から1目ぶんしか外へ出ない', () => {
  // 「1目」= 切り取り範囲を測る格子の目(建物の平面範囲 ÷ 64 ≒ 100mm)。板の輪郭は
  // 縁が切り口から食み出さないよう、当たった格子点を1目ぶん膨らませた和で作られる。
  // その膨らみは残る。**メートル単位で張り出さない** ことがここの主張である。
  let worstOutline = 0, worstBbox = 0, at = null;
  [0, 15, 30, 45, 60, 75, 90].forEach((deg) => {
    const ctx = makeCtx(cornerPlan(BOTH, true), { northDeg: deg });
    assert.equal(run(ctx, 'setbackRoofItems().length'), 2, deg + '度: 板が2枚できていない');
    coveredPointsMm(ctx, 'outline').forEach((p) => {
      const d = distToCut(deg, p);
      if (d > worstOutline) { worstOutline = d; at = [deg, p[0], p[1]]; }
    });
    coveredPointsMm(ctx, 'bbox').forEach((p) => {
      const d = distToCut(deg, p);
      if (d > worstBbox) worstBbox = d;
    });
  });
  // 空振り防止: 外接矩形で見ればメートル単位で張り出している。つまりこの試験は
  // 「そもそも張り出しが起きない形の建物」を見ているのではない。
  assert.ok(worstBbox > 500,
    '外接矩形でも張り出していない = この試験が何も突いていない: ' + Math.round(worstBbox) + 'mm');
  assert.ok(worstOutline <= 300,
    '板の覆いが切り口から ' + Math.round(worstOutline) + 'mm 外へ出ている(1目ぶんを超える) @'
    + JSON.stringify(at));
});

test('28(最重要): 部屋の真ん中を横切る斜線の帯でも、天井がその切り口についてくる', () => {
  // 方位15度・北側＋道路。北側の板は谷(道路側の領分)で削られて帯になり、
  // **部屋の中心にも四隅にも掛からない**。中心と四隅の5点だけで「この部屋に
  // 架かっているか」を決めていた頃は、この板が丸ごと落ちて、帯の下の天井が
  // 切り口より 1.1m 高いまま残っていた。
  const DEG = 15;
  const ctx = makeCtx(cornerPlan(BOTH, true), { northDeg: DEG });
  const room = 'DATA.rooms.filter(function(r){return r.floor===3;})[0]';
  const north = 'setbackRoofItems().filter(function(it){return it.setbackKind==="north";})[0]';
  assert.ok(run(ctx, north + '?1:0'), '北側の板ができている');
  // 空振り防止: この試験が突いている条件そのもの(5点のどれにも掛からない)。
  assert.deepEqual(
    plain(run(ctx, '(function(){var r=' + room + ';return [[r.x+r.w/2,r.y+r.d/2],[r.x,r.y],'
      + '[r.x+r.w,r.y],[r.x,r.y+r.d],[r.x+r.w,r.y+r.d]].map(function(p){'
      + 'return roofCoversPlanPoint(' + north + ',p[0],p[1])?1:0;});})()')),
    [0, 0, 0, 0, 0], '中心か四隅に掛かってしまっている(この試験が効かない)');
  assert.ok(run(ctx, '(function(){var r=' + room + ', n=0;'
    + 'for(var x=100;x<=5900;x+=100) for(var y=1050;y<=4950;y+=100)'
    + ' if(roofCoversPlanPoint(' + north + ',x,y)) n++; return n;})()') > 20,
    '北側の板が部屋の中を横切っていない(この試験が効かない)');

  assert.equal(run(ctx, 'setbackRoofsOverRoom(' + room + ').filter(function(it){'
    + 'return it.setbackKind==="north";}).length'), 1,
    '部屋の中を横切っている北側の板が、その部屋に架かる屋根として選ばれていない');

  const flat = run(ctx, '(floorBaseY(3)+roomCeilingHeightM(' + room + '))/U');
  const floorTop = run(ctx, 'floorTopY(3)/U');
  const got = plain(run(ctx, '(function(){var r=' + room + ', p=roomCeilingProfile(r), out=[];'
    + 'for(var x=100;x<=5900;x+=100) for(var y=1050;y<=4950;y+=100)'
    + ' out.push([x,y,roomCeilingWorldYAtMm(r,p,x,y)/U]);'
    + 'return out;})()'));
  let n = 0, nNorth = 0, worst = 0, worstAt = null, deepest = 0;
  got.forEach((g) => {
    const lower = lowerLimitAtDegMm(DEG, g[0], g[1]);
    // 縁の1目ぶんを避けて、**確実に削られている所**だけを見る。
    if (lower - 250 > flat - 300) return;
    // 制限面が床より下へ来る所は、部屋そのものが削り取られている。天井の値に
    // 意味が無いので数えない。
    if (lower - 250 <= floorTop) return;
    n++;
    if (northLimitAtDegMm(DEG, g[0], g[1]) < roadLimitMm(g[0])) nNorth++;
    const want = Math.min(flat, lower - 250);
    if (flat - want > deepest) deepest = flat - want;
    const e = Math.abs(g[2] - want);
    if (e > worst) { worst = e; worstAt = [g[0], g[1], Math.round(g[2]), Math.round(want)]; }
  });
  assert.ok(n > 50, '見た点が少なすぎる: ' + n);
  assert.ok(nNorth > 10, '北側斜線が効いている点が少なすぎる: ' + nNorth);
  assert.ok(deepest > 800,
    '天井が下がるはずの量が小さすぎて、落ちても気づけない: ' + Math.round(deepest) + 'mm');
  assert.ok(worst < 2,
    '天井が切り口についてきていない: ' + Math.round(worst) + 'mm ずれ @' + JSON.stringify(worstAt));
});

test('28(最重要): 板が外接矩形へ落ちても、天井は元の平天井より下がらない', () => {
  // 輪郭が細切れになりすぎたときの保険(SETBACK_ROOF_MAX_RECTS)は、輪郭を捨てて
  // **外接矩形1枚**へ落とす。そのときだけ、天井も立面図と同じ張り出した形を見る。
  // それでも天井が狂わないのは、板の下面が制限面そのもので、天井が
  //   min(その点の制限 − 250mm, 元の平天井)
  // に抑えられているからである。張り出した先は「制限が建物より高い」所なので、
  // 元の平天井のほうが低く、そちらが勝つ。**この頭打ちが無くなると張り出しが
  // そのまま天井に出る。**
  const DEG = 15;
  const ctx = makeCtx(cornerPlan(BOTH, true), { northDeg: DEG });
  run(ctx, 'SETBACK_ROOF_MAX_RECTS=1; _setbackRoofCacheKey=null; _setbackRoomRoofsCacheKey=null;');
  assert.equal(run(ctx, 'setbackRoofItems().filter(function(it){return !!it.setbackOutline;}).length'), 0,
    '保険が発動していない(輪郭が残っている) = この試験が何も突いていない');
  // 空振り防止: 外接矩形なので、板は実際の切り口からメートル単位で張り出している。
  let far = 0;
  coveredPointsMm(ctx, 'outline').forEach((p) => {
    const d = distToCut(DEG, p);
    if (d > far) far = d;
  });
  assert.ok(far > 500, '張り出しが再現できていない: ' + Math.round(far) + 'mm');

  const room = 'DATA.rooms.filter(function(r){return r.floor===3;})[0]';
  const flat = run(ctx, '(floorBaseY(3)+roomCeilingHeightM(' + room + '))/U');
  const floorTop = run(ctx, 'floorTopY(3)/U');
  const got = plain(run(ctx, '(function(){var r=' + room + ', p=roomCeilingProfile(r), out=[];'
    + 'for(var x=100;x<=5900;x+=100) for(var y=1050;y<=4950;y+=100)'
    + ' out.push([x,y,roomCeilingWorldYAtMm(r,p,x,y)/U]);'
    + 'return out;})()'));
  let worst = 0, worstAt = null;
  got.forEach((g) => {
    const lower = lowerLimitAtDegMm(DEG, g[0], g[1]);
    if (lower - 250 <= floorTop) return;          // そこは部屋ごと削り取られている
    const want = Math.min(flat, lower - 250);
    const off = Math.abs(g[2] - want);            // 切り口が示す高さからのずれ(上下とも)
    if (off > worst) { worst = off; worstAt = [g[0], g[1], Math.round(g[2]), Math.round(want)]; }
  });
  assert.ok(worst <= 300,
    '張り出した所で天井が ' + Math.round(worst) + 'mm ずれている @' + JSON.stringify(worstAt));
});
