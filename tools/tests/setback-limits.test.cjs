// Task 18: 斜線制限に残っていた3つの穴を、**実行して**塞げたことを確かめる。
//
//   18-1 角地で道路斜線が1本しか見られていない（実際より緩く出る = 黙って間違う）
//   18-2 北が平面図の上に固定されている（日照の方位を見ていない）
//   18-3 片流れ屋根がL字の凹みに張り出す
//
// grep ではない。index.html から関数を波括弧の対応で切り出し、node:vm で走らせ、
// 出来た面・屋根アイテム・屋根メッシュの頂点を読む。
// 期待値は index.html の式を写さず、独立に書いている:
//   北側 = 基準高さ + 1.25 × 北側境界からの水平距離
//   道路 = 勾配 × 道路の反対側の境界からの水平距離
//   真北 = 正午の太陽が向いている向きの反対（computeSunPosition から独立に解く）
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
  'SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M', 'SETBACK_CUT_SAMPLES', 'SETBACK_ROOF_MAX_RECTS',
  'SETBACK_NORTH_COLOR', 'SETBACK_ROAD_COLOR', 'SETBACK_OVER_COLOR',
  'CONTEXT_EXTERIOR_TYPES', '_setbackRoofCache', '_setbackRoofCacheKey',
  'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M'];

const FNS = [
  'computeSunPosition',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal',
  'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomAtPointOnFloor', 'wallRoofTopLimitWorldY', 'wallLimitingRoofs', 'wallTopHeightAtM',
  'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM',
  'getObjBounds', 'isFiniteCanvasValue',
  'isContextExteriorItemType', 'isGroundLevelItemType',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg',
  'setbackLawApi', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
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
  'setbackRoofTemplateItem', 'setbackRoofItemForPlane', 'setbackRoofItems',
  'setbackRoofsOverRoom', 'build3DSetbackRoofs',
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

// ══ 独立の参照実装 ════════════════════════════════════════════════════
// 「今までの屋根」= 当たった格子点の外接矩形を目の粗さぶん広げたもの。
// index.html の新しい実装とは別に、ここで x,y 格子から素朴に解く。
// これが 18-3 の「凹みの無い間取りでは屋根が変わらない」の基準である。
function oldRectSpan(ctx, planeExpr) {
  const bb = plain(run(ctx, 'setbackBuildingPlanBoundsMm()'));
  const pl = run(ctx, planeExpr);
  ctx.__refPl = pl;
  const N = run(ctx, 'SETBACK_CUT_SAMPLES');
  const U = run(ctx, 'U');
  const eps = run(ctx, 'SETBACK_CUT_EPS_M');
  const dx = (bb.maxX - bb.minX) / N, dy = (bb.maxY - bb.minY) / N;
  let tLo = Infinity, tHi = -Infinity, sLo = Infinity, sHi = -Infinity, hit = false;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = bb.minX + dx * i, y = bb.minY + dy * j;
    const top = run(ctx, 'setbackBuildingTopWorldYAt(' + x + ',' + y + ')');
    if (top === null) continue;
    const lim = run(ctx, 'setbackLimitHeightMmAt(__refPl,' + x + ',' + y + ')') * U;
    if (top <= lim + eps) continue;
    hit = true;
    const t = run(ctx, 'setbackDistanceMm(__refPl,' + x + ',' + y + ')');
    const s = pl.px * x + pl.py * y;
    tLo = Math.min(tLo, t); tHi = Math.max(tHi, t);
    sLo = Math.min(sLo, s); sHi = Math.max(sHi, s);
  }
  if (!hit) return null;
  const m = Math.max(Math.abs(dx), Math.abs(dy), 1);
  return { tLo: tLo - m, tHi: tHi + m, sLo: sLo - m, sHi: sHi + m, cellMm: m };
}

// ══ 試験用プラン ══════════════════════════════════════════════════════
// 3階建て・階高2700・基礎450 → 3階の天端は 8550mm（既存の高さモデルの値）。
const LOW1_N = { zone: 'low1', road: false, north: true };
const LOW1_R = { zone: 'low1', road: true, north: false };

// 凹みの無い（矩形の）間取り。北側斜線が y<2840 の側だけを削る。
function rectPlan(setback) {
  const site = { type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  if (setback) site.setback = setback;
  return {
    items: [site,
      { type: 'roof', id: 'r1', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
        rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }],
    rooms: [
      { id: 'a', floor: 3, x: 0, y: 1000, w: 6000, d: 3000 },
      { id: 'b', floor: 3, x: 0, y: 4000, w: 6000, d: 1000 }
    ],
    walls: []
  };
}
// L字。建物の天端は 8100mm なので、北側斜線(5000+1.25y)が届くのは y<2480 の帯。
// その帯の中で、x>2000・y>1800 に建物が無い = 凹みが斜線の当たる範囲に入る。
function lPlan(setback) {
  const site = { type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  if (setback) site.setback = setback;
  return {
    items: [site,
      { type: 'roof', id: 'r1', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 800,
        rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 },
      { type: 'roof', id: 'r2', roofType: 'flat', x: 0, y: 1800, w: 2000, d: 2200,
        rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }],
    rooms: [
      { id: 'a', floor: 3, x: 0, y: 1000, w: 6000, d: 800 },
      { id: 'b', floor: 3, x: 0, y: 1800, w: 2000, d: 2200 }
    ],
    walls: []
  };
}
// 角地。敷地 0..10000 の東と南に道路（幅員 4000）が接する。
// 反対側の境界は東が x=14000、南が y=14000 → どちらも制限 = 1.25×距離。
function cornerPlan(opts) {
  const o = opts || {};
  const site = { type: 'site-rect', x: 0, y: 0, w: 10000, d: 10000, rot: 0 };
  site.setback = o.setback || LOW1_R;
  const items = [site,
    { type: 'roof', id: 'r1', roofType: 'flat', x: 1000, y: 1000, w: 8000, d: 8000,
      rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 },
    { type: 'road', id: 'east', x: 2000, y: 3000, w: 20000, d: 4000, rot: 90 }];
  if (!o.eastOnly) items.push({ type: 'road', id: 'south', x: -5000, y: 10000, w: 20000, d: 4000, rot: 0 });
  if (o.extra) o.extra.forEach(function (it) { items.push(it); });
  return {
    items: items,
    rooms: [{ id: 'a', floor: 3, x: 1000, y: 1000, w: 8000, d: 8000 }],
    walls: []
  };
}
// 制限面より上に出ている量（削る前）。建物の頂部を格子で読み、どの点でも
// **いちばん低い制限**と比べる。ここが 18-1 の「実際より緩く出る」の目盛りである。
function pokeThrough(ctx) {
  const bb = plain(run(ctx, 'setbackBuildingPlanBoundsMm()'));
  const U = run(ctx, 'U');
  const planes = run(ctx, 'setbackPlanes()');
  const N = 40;
  const dx = (bb.maxX - bb.minX) / N, dy = (bb.maxY - bb.minY) / N;
  let pts = 0, over = 0, maxEx = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = bb.minX + dx * i, y = bb.minY + dy * j;
    const top = run(ctx, 'setbackBuildingTopWorldYAt(' + x + ',' + y + ')');
    if (top === null) continue;
    pts++;
    let best = null;
    for (let k = 0; k < planes.length; k++) {
      ctx.__pk = planes[k];
      const lim = run(ctx, 'setbackLimitHeightMmAt(__pk,' + x + ',' + y + ')');
      if (best === null || lim < best) best = lim;
    }
    if (best === null) continue;
    const ex = top / U - best;
    if (ex > 0.5) { over++; if (ex > maxEx) maxEx = ex; }
  }
  return { samples: pts, over: over, maxExcessMm: maxEx };
}

// ══ 0. 設定しなければ何も起きない（18 でも変わらない） ═══════════════
test('18(最重要): 斜線を設定していないプランでは、方位を回しても面が1枚も出ない', () => {
  const ctx = makeCtx(cornerPlan({ setback: null }));
  run(ctx, 'DATA.items[0].setback=undefined; delete DATA.items[0].setback;');
  [0, 45, 90, 180, 270].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    assert.deepEqual(plain(run(ctx, 'setbackPlanes()')), [], 'northDeg=' + deg);
    assert.deepEqual(plain(run(ctx, 'setbackRoofItems()')), []);
  });
  assert.deepEqual(plain(run(ctx, 'activeSetbackSites()')), []);
});

// ══ 18-1 角地: 道路を全部見る ═════════════════════════════════════════
test('18-1(最重要): 2本の道路に接する敷地では、道路の制限面が2枚とも出る', () => {
  const ctx = makeCtx(cornerPlan());
  const planes = run(ctx, 'setbackPlanes()');
  assert.equal(planes.length, 2, '角地なので面は2枚: ' + JSON.stringify(plain(planes)));
  const dirs = plain(planes).map((p) => p.nx.toFixed(3) + ',' + p.ny.toFixed(3)).sort();
  assert.deepEqual(dirs, ['-1.000,0.000', '0.000,-1.000'],
    '東の道路（法線 -x）と南の道路（法線 -y）の2枚である');
  // それぞれの面が「反対側の境界から 1.25 × 距離」であることを条文から独立に確かめる。
  // 東の道路: 反対側の境界は x=14000。南の道路: y=14000。
  plain(planes).forEach((p, i) => {
    ctx.__p = planes[i];
    if (Math.abs(p.nx + 1) < 1e-9) {
      [9000, 5000, 1000].forEach((x) => {
        const got = run(ctx, 'setbackLimitHeightMmAt(__p,' + x + ',5000)');
        assert.ok(Math.abs(got - 1.25 * (14000 - x)) < 1e-6, 'x=' + x + ' → ' + got);
      });
    } else {
      [9000, 5000, 1000].forEach((y) => {
        const got = run(ctx, 'setbackLimitHeightMmAt(__p,5000,' + y + ')');
        assert.ok(Math.abs(got - 1.25 * (14000 - y)) < 1e-6, 'y=' + y + ' → ' + got);
      });
    }
  });
});

test('18-1(最重要): 道路を1本しか見ないと、はみ出しが実際より少なく出る', () => {
  const one = pokeThrough(makeCtx(cornerPlan({ eastOnly: true })));
  const two = pokeThrough(makeCtx(cornerPlan()));
  assert.equal(one.samples, two.samples, '測っている点の数は同じ');
  assert.ok(two.over > one.over,
    '2本見たほうが厳しい: 1本 ' + one.over + ' 点 / 2本 ' + two.over + ' 点');
  assert.ok(two.maxExcessMm >= one.maxExcessMm - 1e-9,
    '最大の飛び出しも減らない: 1本 ' + one.maxExcessMm + ' / 2本 ' + two.maxExcessMm);
});

test('18-1(最重要): どの点でも効くのは低い方の制限（片方でも超えたら超過）', () => {
  const ctx = makeCtx(cornerPlan());
  const planes = run(ctx, 'setbackPlanes()');
  // 南東の隅に近いほど両方が効く。各点で min を取り、面ごとの値より必ず小さいこと。
  [[9000, 3000], [3000, 9000], [9000, 9000], [5000, 5000]].forEach((p) => {
    const vals = [];
    for (let k = 0; k < planes.length; k++) {
      ctx.__p = planes[k];
      vals.push(run(ctx, 'setbackLimitHeightMmAt(__p,' + p[0] + ',' + p[1] + ')'));
    }
    const lo = Math.min.apply(Math, vals);
    // 独立に解く: 東の道路 1.25*(14000-x)、南の道路 1.25*(14000-y)
    const want = Math.min(1.25 * (14000 - p[0]), 1.25 * (14000 - p[1]));
    assert.ok(Math.abs(lo - want) < 1e-6, p + ' の最小 ' + lo + ' != ' + want);
  });
});

test('18-1(最重要): 角地でも削り残しはゼロ（面より上の頂点が1つも残らない）', () => {
  const ctx = makeCtx(cornerPlan({ setback: { zone: 'low1', road: true, north: true } }));
  assert.equal(run(ctx, 'setbackPlanes().length'), 3, '北側1枚＋道路2枚');
  // 制限面より上へ大きく飛び出した壁を1枚置き、削られることを確かめる。
  run(ctx, 'var m=new THREE.Mesh(new THREE.BufferGeometry(),null);' +
    'm.geometry.setAttribute("position",new THREE.Float32BufferAttribute(' +
    '[1,0,1, 9,0,1, 9,20,9, 1,0,1, 9,20,9, 1,20,9],3));' +
    'm.userData={b:true}; m.name="testwall"; sc3.add(m);');
  run(ctx, 'applySetbackCut()');
  const coefs = run(ctx, 'setbackPlanes().map(setbackPlaneWorldCoef)');
  ctx.__coefs = coefs;
  const bad = run(ctx,
    'var g=sc3.children[0].geometry, p=g.attributes.position, n=0, i, k, c;' +
    'for(i=0;i<p.count;i++){ for(k=0;k<__coefs.length;k++){ c=__coefs[k];' +
    'if(p.getY(i)-(c.a*p.getX(i)+c.b*p.getZ(i)+c.c)>SETBACK_CUT_EPS_M) n++; } } n;');
  assert.equal(bad, 0, '制限面より上に残った頂点');
});

test('18-1(最重要): 同じ向きの道路が2本あるときは、低い方の面だけが残る', () => {
  // east（幅員4000・反対側の境界 x=14000）と同じ側に、幅員2000（反対側の境界
  // x=12000）の道路をもう1本置く。狭いほうが **低い** 面になるので、そちらが効く。
  const ctx = makeCtx(cornerPlan({ eastOnly: true, extra: [
    { type: 'road', id: 'east2', x: 1000, y: 4000, w: 20000, d: 2000, rot: 90 }] }));
  assert.equal(run(ctx, 'setbackRoadItems(DATA.items[0]).length'), 2, '道路アイテムは2本とも前面道路');
  const planes = plain(run(ctx, 'setbackPlanes()'));
  assert.equal(planes.length, 1, '同じ向きなので面は1枚にまとまる');
  ctx.__p = run(ctx, 'setbackPlanes()')[0];
  // 独立に解く: 幅員2000の道路の反対側の境界は x=12000 → 制限 = 1.25 × (12000 − x)
  [9000, 5000].forEach((x) => {
    const got = run(ctx, 'setbackLimitHeightMmAt(__p,' + x + ',5000)');
    assert.ok(Math.abs(got - 1.25 * (12000 - x)) < 1e-6,
      'x=' + x + ' の制限 ' + got + ' が、狭い方の道路から測った ' + (1.25 * (12000 - x)) + ' と違う');
  });
});

test('18-1: 道路の長さ方向で敷地と重ならない道路は前面道路にしない', () => {
  // 敷地のはるか北を東西に走る道路。長さ方向(x)では重なるので前面道路になるが、
  // 敷地の真横を南北に走る「短い」道路が敷地の範囲外にあるときは外れる。
  const ctx = makeCtx(cornerPlan({ eastOnly: true, extra: [
    { type: 'road', id: 'far', x: 30000, y: 40000, w: 3000, d: 4000, rot: 90 }] }));
  const ids = run(ctx, 'setbackRoadItems(DATA.items[0]).map(function(r){return r.id;})');
  assert.deepEqual(plain(ids), ['east'], '離れた短い道路は前面道路ではない');
});

test('18-1: 前面道路が1本も無ければ、いちばん近い1本へ落ちる（既存プランで消えない）', () => {
  const ctx = makeCtx(cornerPlan({ eastOnly: true }));
  run(ctx, 'DATA.items[2].w=3000; DATA.items[2].x=2000; DATA.items[2].y=40000;');
  const ids = run(ctx, 'setbackRoadItems(DATA.items[0]).map(function(r){return r.id;})');
  assert.deepEqual(plain(ids), ['east'], '重なる道路が無くても道路斜線は消えない');
  assert.equal(run(ctx, 'setbackPlanes().length'), 1);
});

test('18-1(最重要): 敷地が複数あれば、設定を持つ敷地すべてから面が出る', () => {
  const plan = cornerPlan({ eastOnly: true });
  plan.items.push({ type: 'site-rect', x: 20000, y: 0, w: 6000, d: 6000, rot: 0,
    setback: { zone: 'low1', road: false, north: true } });
  const ctx = makeCtx(plan);
  assert.equal(run(ctx, 'activeSetbackSites().length'), 2, '設定を持つ敷地は2枚');
  const kinds = plain(run(ctx, 'setbackPlanes()')).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['north', 'road'], '1枚目の道路斜線と2枚目の北側斜線が両方出る');
  // 2枚目の敷地の北側境界は y=0（その敷地の最小 y）である
  const north = plain(run(ctx, 'setbackPlanes()')).filter((p) => p.kind === 'north')[0];
  assert.equal(north.d0, 0);
});

// ══ 18-2 北は日照の方位から取る ═══════════════════════════════════════
test('18-2(最重要): northDeg=0 では今までと同じ位置に出る（平面図の上が北）', () => {
  const ctx = makeCtx(rectPlan(LOW1_N), { northDeg: 0 });
  const pl = plain(run(ctx, 'setbackPlanes()'))[0];
  assert.equal(pl.kind, 'north');
  assert.equal(pl.nx, 0);
  assert.equal(pl.ny, 1);
  assert.equal(pl.d0, 0, '北側境界は敷地の最小 y（この敷地では 0）');
  ctx.__p = run(ctx, 'setbackPlanes()')[0];
  [0, 1000, 3000, 7000].forEach((y) => {
    const got = run(ctx, 'setbackLimitHeightMmAt(__p,3000,' + y + ')');
    assert.equal(got, 5000 + 1.25 * y, 'y=' + y);
  });
});

test('18-2(最重要): northDeg=180 で北側斜線は反対側（南）へ移る — 符号の反転を捕まえる', () => {
  const ctx = makeCtx(rectPlan(LOW1_N), { northDeg: 180 });
  const pl = plain(run(ctx, 'setbackPlanes()'))[0];
  assert.ok(Math.abs(pl.nx) < 1e-9, '法線に東西の成分は無い: ' + pl.nx);
  assert.ok(Math.abs(pl.ny + 1) < 1e-9, '法線は真南 = 平面図の -y を向く: ' + pl.ny);
  ctx.__p = run(ctx, 'setbackPlanes()')[0];
  // 敷地は y=0..7000。北が真下（+y）なら、基準高さ 5000 になるのは y=7000 の辺。
  assert.ok(Math.abs(run(ctx, 'setbackLimitHeightMmAt(__p,3000,7000)') - 5000) < 1e-6, '南端が基準高さ');
  assert.ok(Math.abs(run(ctx, 'setbackLimitHeightMmAt(__p,3000,0)') - (5000 + 1.25 * 7000)) < 1e-6,
    '北端はいちばん緩い');
  // northDeg=0 のときと比べて、低い側と高い側が入れ替わっていること。
  const ctx0 = makeCtx(rectPlan(LOW1_N), { northDeg: 0 });
  ctx0.__p = run(ctx0, 'setbackPlanes()')[0];
  assert.equal(run(ctx0, 'setbackLimitHeightMmAt(__p,3000,0)'), 5000);
  assert.ok(run(ctx, 'setbackLimitHeightMmAt(__p,3000,0)') >
            run(ctx0, 'setbackLimitHeightMmAt(__p,3000,0)'),
    '同じ点の制限が 0° と 180° で逆になっている');
});

test('18-2(最重要): 制限面の「北」は日照シミュレーションの北と一致する（太陽から独立に検算）', () => {
  // 正午（時角0）の太陽は真南にある。computeSunPosition が返す水平方向がそれで、
  // 制限面の法線は「境界から敷地へ」= 真南向きでなければならない。
  // ここを反転させると、北側斜線が南側に立つ（絵ではもっともらしく見える）。
  [0, 30, 90, 180, 270, 355].forEach((deg) => {
    const ctx = makeCtx(rectPlan(LOW1_N), { northDeg: deg });
    const sun = plain(run(ctx, 'computeSunPosition(12,"equinox",' + deg + ')'));
    const len = Math.hypot(sun.x, sun.z);
    const southX = sun.x / len, southY = sun.z / len;   // 3Dの z = 平面図の y
    const pl = plain(run(ctx, 'setbackPlanes()'))[0];
    assert.ok(Math.abs(pl.nx - southX) < 1e-9 && Math.abs(pl.ny - southY) < 1e-9,
      deg + '°: 面の法線 (' + pl.nx + ',' + pl.ny + ') が真南 (' + southX + ',' + southY + ') と違う');
  });
});

test('18-2(最重要): northDeg=90 では東の辺が北側境界になる', () => {
  // 太陽モデル: 正午の方位 azWorld=π+θ、向き=(sin,−cos)(azWorld) → 真南=(−sinθ,cosθ)。
  // θ=90° で真南は (−1,0)=平面図の西 → 真北は東。敷地 x=-1000..7000 の東端は 7000。
  const ctx = makeCtx(rectPlan(LOW1_N), { northDeg: 90 });
  const pl = plain(run(ctx, 'setbackPlanes()'))[0];
  assert.ok(Math.abs(pl.nx + 1) < 1e-9, '法線は西向き');
  ctx.__p = run(ctx, 'setbackPlanes()')[0];
  assert.ok(Math.abs(run(ctx, 'setbackLimitHeightMmAt(__p,7000,3000)') - 5000) < 1e-6,
    '東端 x=7000 が基準高さ');
  assert.ok(Math.abs(run(ctx, 'setbackLimitHeightMmAt(__p,-1000,3000)') - (5000 + 1.25 * 8000)) < 1e-6,
    '西端はいちばん緩い');
});

test('18-2(最重要): 方位を回すと片流れ屋根も追随する（キャッシュが古いまま残らない）', () => {
  const ctx = makeCtx(rectPlan(LOW1_N), { northDeg: 0 });
  const a = plain(run(ctx, 'setbackRoofItems()'))[0];
  assert.ok(a, '0° で屋根ができている');
  run(ctx, 'setPlanNorthDeg(90)');
  const b = plain(run(ctx, 'setbackRoofItems()'))[0];
  assert.ok(b, '90° でも屋根ができている');
  assert.notEqual(a.rot, b.rot, '屋根の向きが回っている: ' + a.rot + ' → ' + b.rot);
  run(ctx, 'setPlanNorthDeg(0)');
  const c = plain(run(ctx, 'setbackRoofItems()'))[0];
  assert.equal(c.rot, a.rot, '0° に戻すと元の向きに戻る');
  assert.ok(Math.abs(c.w - a.w) < 1e-6 && Math.abs(c.d - a.d) < 1e-6, '寸法も戻る');
});

test('18-2: 道路斜線は方位を回しても動かない（道路の向きで決まる）', () => {
  const ctx = makeCtx(cornerPlan({ eastOnly: true }), { northDeg: 0 });
  const a = plain(run(ctx, 'setbackPlanes()'))[0];
  run(ctx, 'setPlanNorthDeg(137)');
  const b = plain(run(ctx, 'setbackPlanes()'))[0];
  assert.deepEqual([b.nx, b.ny, b.d0], [a.nx, a.ny, a.d0]);
});

// ══ 18-3 屋根は削った範囲の輪郭に沿う ═════════════════════════════════
test('18-3(最重要): 凹みの無い間取りでは、屋根は今までとまったく同じ矩形1枚である', () => {
  const ctx = makeCtx(rectPlan(LOW1_N));
  const span = plain(run(ctx, 'setbackCutSpanMm(setbackPlanes()[0])'));
  assert.equal(span.rects.length, 1, '矩形1枚: ' + JSON.stringify(span.rects));
  // 独立に解いた「今までの外接矩形」と、値まで一致すること。
  const ref = oldRectSpan(ctx, 'setbackPlanes()[0]');
  ['tLo', 'tHi', 'sLo', 'sHi', 'cellMm'].forEach((k) => {
    assert.ok(Math.abs(span[k] - ref[k]) < 1e-6, k + ': ' + span[k] + ' != ' + ref[k]);
  });
  assert.ok(Math.abs(span.rects[0].tLo - ref.tLo) < 1e-6);
  assert.ok(Math.abs(span.rects[0].sHi - ref.sHi) < 1e-6);
  const roof = plain(run(ctx, 'setbackRoofItems()'))[0];
  assert.equal(roof.setbackOutline, undefined, '輪郭のプロパティは付かない（今までの屋根アイテムそのまま）');
  assert.ok(Math.abs(roof.w - (ref.sHi - ref.sLo)) < 1e-6, '幅が今までと同じ');
  assert.ok(Math.abs(roof.d - (ref.tHi - ref.tLo)) < 1e-6, '奥行が今までと同じ');
});

test('18-3(最重要): L字の間取りでは、屋根が凹み（建物の無いところ）を覆わない', () => {
  const ctx = makeCtx(lPlan(LOW1_N));
  const span = plain(run(ctx, 'setbackCutSpanMm(setbackPlanes()[0])'));
  assert.ok(span.rects.length > 1, '輪郭が矩形1枚では足りない: ' + JSON.stringify(span.rects));
  const roof = run(ctx, 'setbackRoofItems()[0]');
  assert.ok(run(ctx, '!!setbackRoofItems()[0].setbackOutline'), '輪郭を持っている');
  // 腕の上（建物がある）は覆う。凹み（x>2500・y>2700、建物なし）は覆わない。
  [[1000, 1200], [5000, 1200], [1000, 2200]].forEach((p) => {
    assert.equal(run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],' + p[0] + ',' + p[1] + ')'),
      true, '建物のある ' + p + ' は屋根の下');
  });
  [[4000, 2200], [5500, 2200], [3000, 2400]].forEach((p) => {
    assert.equal(run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],' + p[0] + ',' + p[1] + ')'),
      false, '建物の無い ' + p + ' に屋根が張り出している');
  });
  // 外接矩形そのものは変わっていない（範囲を狭めたのではなく、輪郭を刻んだ）。
  const ref = oldRectSpan(ctx, 'setbackPlanes()[0]');
  ['tLo', 'tHi', 'sLo', 'sHi'].forEach((k) => {
    assert.ok(Math.abs(span[k] - ref[k]) < 1e-6, k + ': ' + span[k] + ' != ' + ref[k]);
  });
});

test('18-3(最重要): L字でも、屋根面の高さは制限面そのものである', () => {
  const ctx = makeCtx(lPlan(LOW1_N));
  const U = run(ctx, 'U');
  [[1000, 1200], [5000, 1200], [1000, 1700], [1000, 2400]].forEach((p) => {
    assert.equal(run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],' + p[0] + ',' + p[1] + ')'), true);
    const got = run(ctx, 'roofUndersideWorldYAt(setbackRoofItems()[0],' + p[0] + ',' + p[1] + ')') / U;
    assert.ok(Math.abs(got - (5000 + 1.25 * p[1])) < 1e-6,
      p + ': 屋根面 ' + got + ' が制限 ' + (5000 + 1.25 * p[1]) + ' と違う');
  });
});

test('18-3(最重要): L字でも削り残しはゼロ', () => {
  const ctx = makeCtx(lPlan(LOW1_N));
  run(ctx, 'var m=new THREE.Mesh(new THREE.BufferGeometry(),null);' +
    'm.geometry.setAttribute("position",new THREE.Float32BufferAttribute(' +
    '[0,0,1, 6,0,1, 6,15,5, 0,0,1, 6,15,5, 0,15,5],3));' +
    'm.userData={b:true}; sc3.add(m);');
  run(ctx, 'applySetbackCut()');
  ctx.__coefs = run(ctx, 'setbackPlanes().map(setbackPlaneWorldCoef)');
  const bad = run(ctx,
    'var g=sc3.children[0].geometry, p=g.attributes.position, n=0, i, k, c;' +
    'for(i=0;i<p.count;i++){ for(k=0;k<__coefs.length;k++){ c=__coefs[k];' +
    'if(p.getY(i)-(c.a*p.getX(i)+c.b*p.getZ(i)+c.c)>SETBACK_CUT_EPS_M) n++; } } n;');
  assert.equal(bad, 0);
});

test('18-3(最重要): 3D に建つ屋根の面も、凹みの上には1枚も無い', () => {
  const ctx = makeCtx(lPlan(LOW1_N));
  run(ctx, 'build3DSetbackRoofs(null)');
  // 屋根グループの三角形を屋根ローカル(x,z)で読み、平面上の点がその三角形の
  // 中に入るかを数える。頂点の近さではなく **面が覆っているか** を見る。
  const tris = plain(run(ctx,
    'var out=[]; sc3.traverse(function(o){ if(!o.isMesh||!o.geometry||!o.geometry.attributes.position) return;' +
    'var p=o.geometry.attributes.position, i;' +
    'for(i=0;i+2<p.count;i+=3) out.push([[p.getX(i),p.getZ(i)],[p.getX(i+1),p.getZ(i+1)],[p.getX(i+2),p.getZ(i+2)]]); }); out;'));
  assert.ok(tris.length >= 2, '屋根メッシュが建っている: ' + tris.length);
  function inTri(p, t) {
    const s = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
    const d1 = s(p, t[0], t[1]), d2 = s(p, t[1], t[2]), d3 = s(p, t[2], t[0]);
    const neg = (d1 < -1e-9) || (d2 < -1e-9) || (d3 < -1e-9);
    const pos = (d1 > 1e-9) || (d2 > 1e-9) || (d3 > 1e-9);
    return !(neg && pos);
  }
  function coverCount(xMm, yMm) {
    const lp = plain(run(ctx, 'roofLocalPoint(setbackRoofItems()[0],' + xMm + ',' + yMm + ')'));
    let n = 0;
    tris.forEach((t) => { if (inTri([lp.x, lp.z], t)) n++; });
    return n;
  }
  assert.ok(coverCount(1000, 1200) > 0, '建物のある腕の上には屋根面がある');
  assert.ok(coverCount(5000, 1200) > 0, '建物のある腕の上には屋根面がある');
  assert.equal(coverCount(4500, 2220), 0, '凹みの真上に屋根の面が張り出している');
  assert.equal(coverCount(5500, 2300), 0, '凹みの真上に屋根の面が張り出している');
});

test('18-3: 凹みの無い屋根の3Dメッシュは、今までと同じ4隅の1枚である', () => {
  const ctx = makeCtx(rectPlan(LOW1_N));
  run(ctx, 'build3DSetbackRoofs(null)');
  const top = run(ctx,
    'var n=0; sc3.traverse(function(o){ if(o.isMesh&&o.geometry&&o.geometry.attributes.position) n++; }); n;');
  // 片流れ矩形: 屋根面 2三角形(=2メッシュ) + 見付け4辺 × 2三角形 = 10 メッシュ
  assert.equal(top, 10, '矩形の片流れ屋根が作るメッシュの数が今までと違う: ' + top);
});

test('18-3: 輪郭の縁は、覆いのある側と無い側の境目にだけ立つ', () => {
  const ctx = makeCtx(lPlan(LOW1_N));
  const span = plain(run(ctx, 'setbackCutSpanMm(setbackPlanes()[0])'));
  assert.ok(span.edges.length >= 6, '縁の本数: ' + span.edges.length);
  // 縁の中点の両側を見て、片側だけが覆われていること。
  const roof = run(ctx, 'setbackRoofItems()[0]');
  const covered = (t, s) => {
    ctx.__q = run(ctx, 'setbackPointAt(setbackPlanes()[0],' + t + ',' + s + ')');
    return run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],__q.x,__q.y)');
  };
  let checked = 0;
  span.edges.forEach((e) => {
    const t = (e.tLo + e.tHi) / 2, s = (e.sLo + e.sHi) / 2;
    const d = 1;
    const a = (e.tLo === e.tHi) ? covered(t - d, s) : covered(t, s - d);
    const b = (e.tLo === e.tHi) ? covered(t + d, s) : covered(t, s + d);
    assert.notEqual(a, b, '縁 ' + JSON.stringify(e) + ' の両側がどちらも ' + a);
    checked++;
  });
  assert.ok(checked > 0);
  assert.ok(roof);
});
