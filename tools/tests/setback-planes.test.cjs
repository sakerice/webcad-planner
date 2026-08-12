// Task 16-2 / 16-3 / 16-4: 斜線制限の面・寸法・はみ出しを **実行して** 測る。
//
// この計画では grep のアサーションが未修正のコードに対して何度も通っている。
// なのでここでの検査は grep ではない。index.html から関数を波括弧の対応で切り出し、
// node:vm で実際に走らせ、出来た面の高さ・寸法の値・赤く塗られた三角形を読む。
// 偽の THREE は「頂点が本当にどこに置かれたか」を読むためだけのもの。
//
// 期待値は index.html の式を写さず、条文の言葉から独立に解いている:
//   北側 = 基準高さ + 1.25 × 境界からの水平距離
//   道路 = 勾配 × 道路の反対側の境界からの水平距離
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));
const PLAN = JSON.parse(readFileSync(join(ROOT, 'assets', 'default_plan.json'), 'utf8'));

// ── index.html からの切り出し（roof-ceiling.test.cjs と同じやり方）──────────
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

// ── 頂点と可視状態を読むためだけの最小 THREE ───────────────────────────────
function Attr(array, itemSize) {
  this.array = array; this.itemSize = itemSize;
  this.count = array.length / itemSize;
}
Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };

function Geo() { this.attributes = {}; this.index = null; this.boundingBox = null; }
Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
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

function Obj3D() {
  this.children = []; this.userData = {}; this.visible = true;
  const self = this;
  this.position = { x: 0, y: 0, z: 0, set: function (x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
  this.scale = { x: 1, y: 1, z: 1, set: function (x, y, z) { self.scale.x = x; self.scale.y = y; self.scale.z = z; } };
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

const THREE = {
  Group: Group, Mesh: Mesh, LineSegments: LineSegments, Sprite: Sprite,
  BufferGeometry: Geo,
  Float32BufferAttribute: function (a, s) { return new Attr(Array.from(a), s); },
  MeshBasicMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  LineBasicMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  SpriteMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  CanvasTexture: function () { return { colorSpace: null }; },
  Vector3: Vector3,
  DoubleSide: 2, SRGBColorSpace: 'srgb'
};

// 何が描かれたかを記録する canvas。角丸四角の下敷きが付いていないことを
// 「呼ばれた操作」で確かめるために使う(Task 21-5)。
let LAST_LABEL_OPS = null;
function fakeCanvas() {
  const ops = [];
  const rec = (name) => function () { ops.push(name); };
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    lineJoin: '', miterLimit: 0,
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), rect: rec('rect'),
    roundRect: rec('roundRect'),
    fillText: rec('fillText'), strokeText: rec('strokeText'),
    beginPath: rec('beginPath'), fill: rec('fill'), stroke: rec('stroke')
  };
  LAST_LABEL_OPS = ops;
  return { width: 0, height: 0, getContext: function () { return ctx; } };
}

const SETBACK_VARS = ['U', 'SETBACK_PLANE_MARGIN_MM', 'SETBACK_DIM_CLEAR_MM',
  '_setbackBuildingBox', 'SETBACK_DIM_LABEL_GAP_NDC', 'SETBACK_DIM_LABEL_MAX_M', 'SETBACK_CUT_EPS_M', 'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX',
  'CEILING_UNDER_ROOF_OFFSET_MM', 'SETBACK_NORTH_COLOR',
  'SETBACK_ROAD_COLOR', 'SETBACK_OVER_COLOR', 'CONTEXT_EXTERIOR_TYPES'];
const SETBACK_FNS = [
  'escHtml', 'isFiniteCanvasValue', 'getObjBounds',
  'isContextExteriorItemType', 'isGroundLevelItemType',
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane',
  'setbackDistanceMm', 'setbackLimitHeightMmAt', 'setbackPointAt',
  'setbackPlanes', 'setbackPlaneQuadMm', 'setbackDimStations',
  'setbackPlaneWorldCoef', 'setbackTriSide', 'splitTriangleBySetbackPlane',
  'setbackTriF', 'setbackLerpVert', 'clipTriangleAboveSetbackPlane',
  'isSetbackSubjectMesh', 'setbackSubjectMeshes', 'setbackLiveCoefsForMesh',
  'collectSetbackOverhangTris',
  'setbackBuildingPlanBoundsMm', 'setbackDimSMm',
  'measureSetbackBuildingBox', 'layoutSetbackDimLabels',
  'addSetbackLine', 'makeSetbackLabelSprite', 'addSetbackPlaneMesh',
  'addSetbackDims', 'addSetbackOverhang', 'build3DSetback', 'applySetbackDimVisibility',
  'setbackCutGeometry', 'applySetbackCut',
  'setbackZoneOptionsHtml', 'siteSetbackRaw', 'siteSetbackEffective', 'setbackCustomMark',
  'siteSetbackPanelHtml', 'updateSelectedSetback'
];

function makeCtx(items, opts) {
  const o = opts || {};
  const sc3 = new Group();
  const written = [];
  const data = { items: items, walls: [], rooms: [] };
  const ST = { showDim: o.showDim !== false, selected: o.selected || null };
  const ctx = vm.createContext({
    console: console, Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN,
    Array: Array, Object: Object, JSON: JSON, String: String,
    SetbackLaw: Law, THREE: THREE, DATA: data, ST: ST, sc3: sc3,
    isInt: !!o.isInt,
    document: { createElement: function () { return fakeCanvas(); } },
    invalidate3D: function () {},
    updateSelectedProp: function (p, v) {
      written.push({ p: p, v: v });
      if (ST.selected) { if (v === null) delete ST.selected[p]; else ST.selected[p] = v; }
    },
    __sc3: sc3, __written: written, __ST: ST, __DATA: data
  });
  vm.runInContext(SETBACK_VARS.map(topLevelVar).concat(SETBACK_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
// vm の中で作られた配列・オブジェクトは別realm なので deepStrictEqual が通らない。
// 値だけを見たいので、比較の前にこちら側の素の値へ写す。
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
const DEFAULT_SITE = PLAN.items.filter((i) => i.type === 'site-rect')[0];
const DEFAULT_ROAD = PLAN.items.filter((i) => i.type === 'road')[0];
assert.ok(DEFAULT_SITE && DEFAULT_ROAD, '既定プランに敷地と道路がある前提');

// 既定プランの数値（テスト側で独立に持つ）
const SITE_MIN_Y = DEFAULT_SITE.y;                       // -570  北側境界
const SITE_MAX_Y = DEFAULT_SITE.y + DEFAULT_SITE.d;      // 4770  南端
const SITE_MIN_X = DEFAULT_SITE.x;                       // -590  西端
const SITE_MAX_X = DEFAULT_SITE.x + DEFAULT_SITE.w;      // 8380  東端
// 道路は rot=90 なので幅方向は平面 x。敷地は道路より西にある。
const ROAD_WIDTH = DEFAULT_ROAD.d;                       // 3277.5
const ROAD_CX = DEFAULT_ROAD.x + DEFAULT_ROAD.w / 2;     // 10000
const ROAD_NEAR_X = ROAD_CX - ROAD_WIDTH / 2;            // 8361.25 敷地側の路肩
const ROAD_FAR_X = ROAD_NEAR_X + ROAD_WIDTH;             // 11638.75 反対側の境界

function siteWith(setback) {
  const s = clone(DEFAULT_SITE);
  if (setback) s.setback = setback; else delete s.setback;
  return s;
}
function road() { return clone(DEFAULT_ROAD); }

// ── 1. 設定しなければ何も起きない ─────────────────────────────────────────
test('16(最重要): 設定の無い既定プランでは制限面が1枚も出ず、3Dに何も足されない', () => {
  const ctx = makeCtx(clone(PLAN.items));
  assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), []);
  assert.equal(vm.runInContext('activeSetbackSite()', ctx), null);
  vm.runInContext('build3DSetback()', ctx);
  assert.equal(ctx.__sc3.children.length, 0, 'シーンに1つも足されていない');
});

test('16: 用途地域を選んだだけ（どちらも有効にしていない）では何も出ない', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: false }), road()]);
  assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), []);
  vm.runInContext('build3DSetback()', ctx);
  assert.equal(ctx.__sc3.children.length, 0);
});

test('16: 壊れた setback（不明な用途地域・別の型）でも何も出ない', () => {
  [{ zone: '低層', north: true }, 'low1', 7, { north: true }, null].forEach((bad) => {
    const ctx = makeCtx([siteWith(bad), road()]);
    assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), [], JSON.stringify(bad));
  });
});

// ── 2. 北側斜線 ───────────────────────────────────────────────────────────
test('16(最重要): 北側斜線の面は「北側境界から 5000 + 1.25 × 水平距離」に立つ', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  const planes = vm.runInContext('setbackPlanes()', ctx);
  assert.equal(planes.length, 1);
  assert.equal(planes[0].kind, 'north');

  ctx.__pl = planes[0];
  const at = (x, y) => vm.runInContext('setbackLimitHeightMmAt(__pl,' + x + ',' + y + ')', ctx);
  // 期待値は条文から独立に: 5000 + 1.25 × (y - 北側境界)
  const want = (y) => 5000 + 1.25 * (y - SITE_MIN_Y);
  assert.equal(at(0, SITE_MIN_Y), 5000);           // 境界の真上 = 基準高さ
  assert.equal(at(0, SITE_MIN_Y), want(SITE_MIN_Y));
  assert.equal(at(0, SITE_MIN_Y + 3000), want(SITE_MIN_Y + 3000));  // 8750
  assert.equal(at(0, SITE_MAX_Y), want(SITE_MAX_Y));                // 11675
  // 東西に動いても高さは変わらない（面は真北方向にだけ傾く）
  assert.equal(at(-9999, SITE_MIN_Y + 3000), at(9999, SITE_MIN_Y + 3000));
  // 境界より北（敷地の外）では基準高さより低い
  assert.ok(at(0, SITE_MIN_Y - 1000) < 5000);
});

test('16: 中高層住専では北側の基準高さが 10000 になる（勾配は同じ 1.25）', () => {
  const ctx = makeCtx([siteWith({ zone: 'mid1', road: false, north: true }), road()]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const at = (y) => vm.runInContext('setbackLimitHeightMmAt(__pl,0,' + y + ')', ctx);
  assert.equal(at(SITE_MIN_Y), 10000);
  assert.equal(at(SITE_MIN_Y + 4000), 10000 + 1.25 * 4000);
});

test('16(最重要): 北側斜線の無い用途地域では、north:true が書いてあっても面が出ない', () => {
  ['res-other', 'non-res'].forEach((z) => {
    const ctx = makeCtx([siteWith({ zone: z, road: false, north: true }), road()]);
    assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), [], z);
    assert.equal(vm.runInContext('siteSetbackConfig(DATA.items[0])', ctx), null, z);
  });
});

// ── 3. 道路斜線 ───────────────────────────────────────────────────────────
test('16(最重要): 道路斜線の面は「道路の反対側の境界から 1.25 × 水平距離」に立つ', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: false }), road()]);
  const planes = vm.runInContext('setbackPlanes()', ctx);
  assert.equal(planes.length, 1);
  assert.equal(planes[0].kind, 'road');
  ctx.__pl = planes[0];
  const at = (x) => vm.runInContext('setbackLimitHeightMmAt(__pl,' + x + ',2000)', ctx);
  // 期待値は条文から独立に: 1.25 × (反対側の境界 - x)
  const want = (x) => 1.25 * (ROAD_FAR_X - x);
  assert.equal(at(ROAD_FAR_X), 0);                       // 反対側の境界では 0
  assert.equal(at(SITE_MAX_X), want(SITE_MAX_X));        // 敷地の東端 4073.4375
  assert.equal(at(SITE_MIN_X), want(SITE_MIN_X));        // 敷地の西端 15285.9375
  // 手前の路肩ではちょうど幅員 × 勾配
  assert.equal(at(ROAD_NEAR_X), 1.25 * ROAD_WIDTH);
  // 道路の向き（南北）に動いても高さは変わらない
  assert.equal(at(SITE_MAX_X), vm.runInContext('setbackLimitHeightMmAt(__pl,' + SITE_MAX_X + ',9999)', ctx));
});

test('16: 非住居系では道路斜線の勾配が 1.5 になる', () => {
  const ctx = makeCtx([siteWith({ zone: 'non-res', road: true, north: false }), road()]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const h = vm.runInContext('setbackLimitHeightMmAt(__pl,' + SITE_MAX_X + ',2000)', ctx);
  assert.equal(h, 1.5 * (ROAD_FAR_X - SITE_MAX_X));
});

test('16: 幅員は road アイテムの奥行 D から取れる（入力を足していない）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: false }), road()]);
  assert.equal(vm.runInContext('setbackRoadWidthMm(setbackRoadItem(DATA.items[0]))', ctx), ROAD_WIDTH);
  // 幅員を広げると反対側の境界が遠ざかり、同じ点での制限高さが上がる
  const wide = road(); wide.d = 6000;
  const ctx2 = makeCtx([siteWith({ zone: 'low1', road: true, north: false }), wide]);
  const pl2 = vm.runInContext('setbackPlanes()', ctx2)[0];
  ctx2.__pl = pl2;
  const nearX = (wide.x + wide.w / 2) - wide.d / 2;
  const farX = nearX + wide.d;
  assert.equal(vm.runInContext('setbackLimitHeightMmAt(__pl,' + SITE_MAX_X + ',2000)', ctx2),
    1.25 * (farX - SITE_MAX_X));
});

test('16: 道路が無ければ道路斜線の面は出ない（成立しない設定の面を作らない）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: false })]);
  assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), []);
  // 北側だけは道路が無くても成立する
  const ctx2 = makeCtx([siteWith({ zone: 'low1', road: true, north: true })]);
  const kinds = plain(vm.runInContext('setbackPlanes()', ctx2)).map((p) => p.kind);
  assert.deepEqual(kinds, ['north']);
});

test('16: 敷地の反対側に道路があっても、反対側の境界は必ず敷地から遠い側になる', () => {
  // 道路を敷地の西側へ移す（幅方向の符号が反転する）
  const west = road();
  west.x = -20000; // 中心 x = -20000 + 10000 = -10000
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: false }), west]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const cx = west.x + west.w / 2;
  const nearX = cx + west.d / 2;      // 敷地側の路肩（東側）
  const farX = nearX - west.d;        // 反対側の境界（西側）
  assert.equal(vm.runInContext('setbackLimitHeightMmAt(__pl,' + SITE_MIN_X + ',2000)', ctx),
    1.25 * (SITE_MIN_X - farX));
  // 反対側の境界の上では 0
  assert.ok(Math.abs(vm.runInContext('setbackLimitHeightMmAt(__pl,' + farX + ',2000)', ctx)) < 1e-9);
});

// ── 4. 2面同時 ────────────────────────────────────────────────────────────
test('16: 道路＋北側の両方を有効にすると面が2枚出る', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: true }), road()]);
  const planes = vm.runInContext('setbackPlanes()', ctx);
  assert.deepEqual(plain(planes).map((p) => p.kind), ['north', 'road']);
  vm.runInContext('build3DSetback()', ctx);
  const grp = ctx.__sc3.children[0];
  const meshes = [];
  grp.traverse(function (o) { if (o.isMesh) meshes.push(o); });
  // 面2枚（はみ出しは建物メッシュが無いので0）
  assert.equal(meshes.length, 2);
});

// ── 5. 面の広がりは有限 ───────────────────────────────────────────────────
test('16: 制限面は敷地＋余裕までで、無限には伸びない', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const quad = vm.runInContext('setbackPlaneQuadMm(__pl)', ctx);
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  const margin = 2000;
  assert.equal(Math.min.apply(null, ys), SITE_MIN_Y, '北端は境界そのもの');
  assert.equal(Math.max.apply(null, ys), SITE_MAX_Y + margin);
  assert.equal(Math.min.apply(null, xs), SITE_MIN_X - margin);
  assert.equal(Math.max.apply(null, xs), SITE_MAX_X + margin);
});

// ── 6. 寸法 ───────────────────────────────────────────────────────────────
test('16: 北側斜線の寸法は 基準高さ(距離0)・中ほど・南端 の3か所に出る', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const st = vm.runInContext('setbackDimStations(__pl)', ctx);
  const depth = SITE_MAX_Y - SITE_MIN_Y;
  assert.deepEqual(plain(st).map((s) => s.t), [0, depth / 2, depth]);
  assert.equal(st[0].base, true, '距離0の寸法は「基準高さ」として出す');
});

test('16: 道路斜線の寸法は敷地の手前端と奥端に出る（距離は反対側の境界から）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: false }), road()]);
  const pl = vm.runInContext('setbackPlanes()', ctx)[0];
  ctx.__pl = pl;
  const st = vm.runInContext('setbackDimStations(__pl)', ctx);
  assert.equal(st.length, 2);
  assert.equal(st[0].t, ROAD_FAR_X - SITE_MAX_X);
  assert.equal(st[1].t, ROAD_FAR_X - SITE_MIN_X);
});

test('16(最重要): 3Dの寸法は既存の寸法トグル(ST.showDim)にそのまま従う', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()], { showDim: true });
  vm.runInContext('build3DSetback()', ctx);
  const dims = [];
  ctx.__sc3.traverse(function (o) { if (o.userData && o.userData.setbackDim) dims.push(o); });
  assert.ok(dims.length > 0, '寸法のグループが出来ている');
  assert.ok(dims.every((d) => d.visible === true));
  // 寸法ボタンを切る = ST.showDim を落として applySetbackDimVisibility を呼ぶ
  ctx.ST.showDim = false;
  vm.runInContext('applySetbackDimVisibility()', ctx);
  assert.ok(dims.every((d) => d.visible === false), '寸法が消える');
  ctx.ST.showDim = true;
  vm.runInContext('applySetbackDimVisibility()', ctx);
  assert.ok(dims.every((d) => d.visible === true), '寸法が戻る');
});

// Task 21-2: 制限面の板と縁も同じトグルに従う。AI レンダやスクリーンショットで
// 邪魔になるからで、**削りはこの表示とは無関係に効く**。
test('21-2(最重要): 制限面の板も「↔ 寸法」で消える', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()], { showDim: true });
  vm.runInContext('build3DSetback()', ctx);
  // 板そのものの visible ではなく、**画面に出るか**（先祖まで辿った可視）を見る。
  function shownMeshes() {
    const out = [];
    (function walk(o, vis) {
      const v = vis && o.visible !== false;
      if (o.isMesh) out.push({ mesh: o, shown: v });
      (o.children || []).forEach((c) => walk(c, v));
    }(ctx.__sc3, true));
    return out;
  }
  assert.ok(shownMeshes().length > 0, '制限面の板が出来ている');
  assert.ok(shownMeshes().every((m) => m.shown), '寸法ONで面が出ている');
  ctx.ST.showDim = false;
  vm.runInContext('applySetbackDimVisibility()', ctx);
  assert.ok(shownMeshes().every((m) => !m.shown), '寸法OFFでも面が残っている');
  ctx.ST.showDim = true;
  vm.runInContext('applySetbackDimVisibility()', ctx);
  assert.ok(shownMeshes().every((m) => m.shown), '寸法ONに戻しても面が戻らない');
});

test('21-2(最重要): 寸法OFFでも削りは効く（消えるのは表示だけ）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()], { showDim: false });
  // 制限面より遥かに上へ出ている板を建て、削ってから頂点を読む。
  vm.runInContext('var m=new THREE.Mesh(new THREE.BufferGeometry(),null);' +
    'm.geometry.setAttribute("position",new THREE.Float32BufferAttribute(' +
    '[0,30,1, 6,30,1, 6,30,5, 0,30,1, 6,30,5, 0,30,5],3));' +
    'm.userData={b:true}; sc3.add(m);', ctx);
  vm.runInContext('build3DSetback()', ctx);
  const res = vm.runInContext('applySetbackCut()', ctx);
  assert.ok(res && res.cut > 0, '寸法OFFなのに1つも削っていない: ' + JSON.stringify(res));
  const over = vm.runInContext(
    'var co=setbackPlanes().map(setbackPlaneWorldCoef);' +
    'var g=sc3.children[0].geometry, p=g.attributes.position, n=0, i, k, c;' +
    'for(i=0;i<p.count;i++) for(k=0;k<co.length;k++){ c=co[k];' +
    'if(p.getY(i)-(c.a*p.getX(i)+c.b*p.getZ(i)+c.c)>SETBACK_CUT_EPS_M) n++; } n;', ctx);
  assert.equal(over, 0, '寸法OFFのとき削り残しが出た');
});

test('16: 寸法トグルが切れた状態で作り直しても、寸法は消えたまま', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()], { showDim: false });
  vm.runInContext('build3DSetback()', ctx);
  const dims = [];
  ctx.__sc3.traverse(function (o) { if (o.userData && o.userData.setbackDim) dims.push(o); });
  assert.ok(dims.length > 0);
  assert.ok(dims.every((d) => d.visible === false));
});

// ── 6b. 数値の手入力（Task 21-3）─────────────────────────────────────
// 用途地域から既定が入るのは良いが、**基準高さも勾配も自治体によって違う**。
// 手で入れた数がそのまま制限面に効くこと、壊れた数は効かないこと、
// 用途地域を選び直したら既定へ戻ること、を実行して確かめる。
test('21-3(最重要): 北側斜線の基準高さを手で入れると、制限面がその高さから立ち上がる', () => {
  const it = siteWith({ zone: 'low1', road: false, north: true, northBaseMm: 7500 });
  const ctx = makeCtx([it, road()], { selected: it });
  const pl = vm.runInContext('setbackPlanes()[0]', ctx);
  assert.equal(pl.kind, 'north');
  assert.equal(pl.baseMm, 7500, '手入力の基準高さが効いていない');
  // 条文から独立に: 境界から 4000mm の位置の制限 = 7500 + 1.25*4000
  const h = vm.runInContext('setbackLimitHeightMmAt(setbackPlanes()[0],0,' + (SITE_MIN_Y + 4000) + ')', ctx);
  assert.ok(Math.abs(h - (7500 + 1.25 * 4000)) < 1e-6, '制限高さ ' + h);
});

test('21-3(最重要): 勾配を手で入れると、制限面の傾きがその勾配になる', () => {
  const it = siteWith({ zone: 'low1', road: false, north: true, northSlope: 0.6 });
  const ctx = makeCtx([it, road()], { selected: it });
  const pl = vm.runInContext('setbackPlanes()[0]', ctx);
  assert.equal(pl.slope, 0.6);
  const a = vm.runInContext('setbackLimitHeightMmAt(setbackPlanes()[0],0,' + (SITE_MIN_Y + 1000) + ')', ctx);
  const b = vm.runInContext('setbackLimitHeightMmAt(setbackPlanes()[0],0,' + (SITE_MIN_Y + 3000) + ')', ctx);
  assert.ok(Math.abs((b - a) / 2000 - 0.6) < 1e-9, '傾き ' + ((b - a) / 2000));
});

test('21-3: 道路斜線の勾配も手で入れられる', () => {
  const it = siteWith({ zone: 'low1', road: true, north: false, roadSlope: 1.5 });
  const ctx = makeCtx([it, road()], { selected: it });
  const pls = vm.runInContext('setbackPlanes()', ctx);
  assert.ok(pls.length > 0);
  pls.forEach((p) => { assert.equal(p.slope, 1.5); });
});

test('21-3(最重要): 手入力が無ければ、面は条文どおりの既定のまま（保存済みプランが動かない）', () => {
  const it = siteWith({ zone: 'low1', road: true, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  const pls = vm.runInContext('setbackPlanes()', ctx);
  const north = pls.filter((p) => p.kind === 'north')[0];
  const rd = pls.filter((p) => p.kind === 'road')[0];
  assert.equal(north.baseMm, 5000);
  assert.equal(north.slope, 1.25);
  assert.equal(rd.slope, 1.25);
});

test('21-3(最重要): 範囲の外・数でない手入力は効かず、既定へ落ちる', () => {
  [{ northBaseMm: -1 }, { northBaseMm: 999999 }, { northBaseMm: 'abc' }, { northBaseMm: NaN }]
    .forEach((extra) => {
      const it = siteWith(Object.assign({ zone: 'low1', road: false, north: true }, extra));
      const ctx = makeCtx([it, road()], { selected: it });
      assert.equal(vm.runInContext('setbackPlanes()[0].baseMm', ctx), 5000,
        JSON.stringify(extra) + ' が効いてしまった');
    });
  [{ northSlope: 0 }, { northSlope: 99 }, { northSlope: null }].forEach((extra) => {
    const it = siteWith(Object.assign({ zone: 'low1', road: false, north: true }, extra));
    const ctx = makeCtx([it, road()], { selected: it });
    assert.equal(vm.runInContext('setbackPlanes()[0].slope', ctx), 1.25,
      JSON.stringify(extra) + ' が効いてしまった');
  });
});

test('21-3(最重要): 用途地域を選び直すと手入力は消え、その地域の既定へ戻る', () => {
  const it = siteWith({ zone: 'low1', road: true, north: true,
    northBaseMm: 7500, northSlope: 0.6, roadSlope: 0.8 });
  const ctx = makeCtx([it, road()], { selected: it });
  assert.equal(vm.runInContext('setbackPlanes().filter(function(p){return p.kind==="north";})[0].baseMm', ctx), 7500);
  vm.runInContext('updateSelectedSetback("zone","mid1")', ctx);
  const s = vm.runInContext('JSON.stringify(DATA.items[0].setback)', ctx);
  const o = JSON.parse(s);
  assert.equal(o.zone, 'mid1');
  assert.equal(o.northBaseMm, undefined, '手入力が残っている: ' + s);
  assert.equal(o.northSlope, undefined, '手入力が残っている: ' + s);
  assert.equal(o.roadSlope, undefined, '手入力が残っている: ' + s);
  const north = vm.runInContext('setbackPlanes().filter(function(p){return p.kind==="north";})[0]', ctx);
  assert.equal(north.baseMm, 10000, '中高層住専の既定 10000mm へ戻っていない');
  assert.equal(north.slope, 1.25);
});

test('21-3: 手入力しない限り setback に余計な鍵を書かない（保存内容を増やさない）', () => {
  const it = siteWith({ zone: 'low1', road: false, north: false });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('updateSelectedSetback("north",true)', ctx);
  const o = JSON.parse(vm.runInContext('JSON.stringify(DATA.items[0].setback)', ctx));
  assert.deepEqual(Object.keys(o).sort(), ['north', 'road', 'zone']);
  vm.runInContext('updateSelectedSetback("northBaseMm","6200")', ctx);
  const o2 = JSON.parse(vm.runInContext('JSON.stringify(DATA.items[0].setback)', ctx));
  assert.deepEqual(Object.keys(o2).sort(), ['north', 'northBaseMm', 'road', 'zone']);
  assert.equal(o2.northBaseMm, 6200);
});

test('21-3: パネルは「手入力か既定か」をその場で言う', () => {
  const a = siteWith({ zone: 'low1', road: false, north: true });
  const ctxA = makeCtx([a, road()], { selected: a });
  const hA = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctxA);
  assert.ok(hA.indexOf('（用途地域の既定）') >= 0, hA.slice(0, 400));
  const b = siteWith({ zone: 'low1', road: false, north: true, northBaseMm: 6200 });
  const ctxB = makeCtx([b, road()], { selected: b });
  const hB = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctxB);
  assert.ok(hB.indexOf('（手入力）') >= 0, hB.slice(0, 400));
  assert.ok(/value="6200"/.test(hB), '欄に手入力の値が出ていない');
});

// ── 6c. 寸法の表記と置き場所（Task 21-5）────────────────────────────
test('21-5(最重要): 3Dの寸法に角丸四角の下敷きを付けない', () => {
  const it = siteWith({ zone: 'low1', road: false, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('makeSetbackLabelSprite("制限高さ 8000mm",0x3f7fd0,2.0)', ctx);
  const ops = LAST_LABEL_OPS;
  assert.ok(ops && ops.length, '何も描いていない');
  ['roundRect', 'fillRect', 'strokeRect', 'rect'].forEach((bad) => {
    assert.equal(ops.indexOf(bad), -1, bad + ' で下敷きを描いている: ' + ops.join(','));
  });
  assert.ok(ops.indexOf('fillText') >= 0, '文字を描いていない');
  assert.ok(ops.indexOf('strokeText') >= 0, '縁取りが無いと地の上で読めない');
});

test('21-5(最重要): 3Dの寸法は建物の平面の外形より外へ出る', () => {
  // 敷地いっぱいではない建物を置き、寸法の s 座標が建物の外形の外にあることを見る。
  const it = siteWith({ zone: 'low1', road: false, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('DATA.rooms=[{id:"a",floor:1,x:0,y:0,w:4000,d:3000}];', ctx);
  const b = vm.runInContext('JSON.stringify(setbackBuildingPlanBoundsMm())', ctx);
  assert.ok(b, '建物の平面範囲が読める');
  const bb = JSON.parse(b);
  const s = vm.runInContext('setbackDimSMm(setbackPlanes()[0])', ctx);
  // 北側斜線では s = -x（makeSetbackPlane の px,py）。建物は x 0..4000 なので
  // s は -4000..0 の帯に入る。寸法はその外側でなければならない。
  const lo = Math.min(-bb.maxX, -bb.minX), hi = Math.max(-bb.maxX, -bb.minX);
  assert.ok(s > hi || s < lo, '寸法の位置 ' + s + ' が建物の外形 ' + lo + '..' + hi + ' に被っている');
  assert.ok(Math.min(Math.abs(s - hi), Math.abs(s - lo)) >= 900,
    '外形から離れていない: ' + s);
});

test('21-5: 建物が無ければ寸法は敷地の中ほどへ落ちる（出さないのではなく置き場所だけの話）', () => {
  const it = siteWith({ zone: 'low1', road: false, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('DATA.rooms=[]; DATA.items=DATA.items.filter(function(o){return o.type!=="roof";});', ctx);
  const pl = vm.runInContext('setbackPlanes()[0]', ctx);
  const s = vm.runInContext('setbackDimSMm(setbackPlanes()[0])', ctx);
  assert.ok(Math.abs(s - (pl.siteSMin + pl.siteSMax) / 2) < 1e-6, s);
});

// ── 7. 三角形の切断（はみ出しの土台）────────────────────────────────────
function triArea(t) {
  const ax = t[3] - t[0], ay = t[4] - t[1], az = t[5] - t[2];
  const bx = t[6] - t[0], by = t[7] - t[1], bz = t[8] - t[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}
test('16(最重要): 制限面より下だけの三角形は1枚も赤くならない', () => {
  const ctx = makeCtx([]);
  ctx.__co = { a: 0, b: 0, c: 5 };
  ctx.__tri = [0, 0, 0, 10, 1, 0, 0, 4.9, 0];
  assert.deepEqual(plain(vm.runInContext('clipTriangleAboveSetbackPlane(__tri,__co)', ctx)), []);
});
test('16: 全部が制限面より上の三角形はそのまま残る', () => {
  const ctx = makeCtx([]);
  ctx.__co = { a: 0, b: 0, c: 5 };
  ctx.__tri = [0, 6, 0, 10, 7, 0, 0, 9, 0];
  const out = vm.runInContext('clipTriangleAboveSetbackPlane(__tri,__co)', ctx);
  assert.equal(out.length, 1);
  assert.equal(triArea(out[0]).toFixed(6), triArea(ctx.__tri).toFixed(6));
});
test('16(最重要): 面をまたぐ三角形は、上側だけが厳密に切り出される', () => {
  const ctx = makeCtx([]);
  // 水平な限度 y=5。直角三角形 (0,0)-(10,0)-(0,10)（z=0 平面）。
  // y>5 の部分は相似比 1/2 の三角形 = 面積 1/4。
  ctx.__co = { a: 0, b: 0, c: 5 };
  ctx.__tri = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const out = vm.runInContext('clipTriangleAboveSetbackPlane(__tri,__co)', ctx);
  const area = out.reduce((s, t) => s + triArea(t), 0);
  assert.equal(area.toFixed(6), (triArea(ctx.__tri) / 4).toFixed(6));
  // 切り口はちょうど限度の上にある。どの頂点も限度より下に無い。
  out.forEach((t) => {
    for (let i = 0; i < 9; i += 3) assert.ok(t[i + 1] >= 5 - 1e-9, '切り出した頂点が限度より下');
  });
});
test('16: 傾いた制限面でも切り口は面の上に乗る（水平面だけの話ではない）', () => {
  const ctx = makeCtx([]);
  ctx.__co = { a: 0.5, b: 0.25, c: 1 };   // limitY = 0.5x + 0.25z + 1
  ctx.__tri = [0, 0, 0, 10, 2, 4, 2, 9, 1];
  const out = vm.runInContext('clipTriangleAboveSetbackPlane(__tri,__co)', ctx);
  assert.ok(out.length > 0);
  out.forEach((t) => {
    for (let i = 0; i < 9; i += 3) {
      const lim = 0.5 * t[i] + 0.25 * t[i + 2] + 1;
      assert.ok(t[i + 1] >= lim - 1e-9, '切り出した頂点が面より下にある');
    }
  });
});

// ── 8. はみ出しの表示 ─────────────────────────────────────────────────────
function boxMesh(minX, minY, minZ, maxX, maxY, maxZ, userData) {
  // 三角形2枚だけの薄い板（頂点を読むのが目的なので箱である必要はない）
  const g = new Geo();
  g.setAttribute('position', new Attr([
    minX, minY, minZ, maxX, minY, maxZ, maxX, maxY, maxZ,
    minX, minY, minZ, maxX, maxY, maxZ, minX, maxY, minZ
  ], 3));
  const m = new Mesh(g, {});
  m.userData = userData;
  return m;
}
test('16(最重要): 制限面より上に出ている部分だけが赤くなる（下だけの建物は赤くならない）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  // 北側境界(y=-570)のすぐ南 z=0m 付近で高さ 3m の壁 -> 限度は 5000+1.25*570=5712mm
  const low = boxMesh(0, 0, 0, 3, 3, 0, { b: true, selectKind: 'wall', selectRef: { id: 1 } });
  ctx.__sc3.add(low);
  vm.runInContext('build3DSetback()', ctx);
  let over = null;
  ctx.__sc3.traverse(function (o) { if (o.userData && o.userData.setbackOverhang) over = o; });
  assert.equal(over, null, '限度より低い建物は赤くならない');
});
test('16(最重要): 制限面を突き抜けた建物は赤くなり、その頂点はすべて面より上にある', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  // 高さ 12m の板。北側境界近く(z=-0.5m)では限度が約 5.0875m なので大きくはみ出す。
  const tall = boxMesh(0, 0, -0.5, 4, 12, -0.5, { b: true, selectKind: 'wall', selectRef: { id: 1 } });
  ctx.__sc3.add(tall);
  vm.runInContext('build3DSetback()', ctx);
  let over = null;
  ctx.__sc3.traverse(function (o) { if (o.userData && o.userData.setbackOverhang) over = o; });
  assert.ok(over, '赤いメッシュが出来ている');
  const p = over.geometry.attributes.position;
  assert.ok(p.count >= 3);
  ctx.__pl = vm.runInContext('setbackPlanes()', ctx)[0];
  const co = vm.runInContext('setbackPlaneWorldCoef(__pl)', ctx);
  for (let i = 0; i < p.count; i++) {
    const lim = co.a * p.getX(i) + co.b * p.getZ(i) + co.c;
    assert.ok(p.getY(i) >= lim - 1e-6,
      '赤い面の頂点が制限面より下にある（= 制限内のものを「はみ出し」と言っている）');
  }
});
test('16(最重要): 周辺物（道路・隣家）と外構（敷地・車・樹木）ははみ出しの対象にしない', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: false, north: true }), road()]);
  ['road', 'neighbor-house', 'neighbor-building', 'utility-pole', 'site-rect', 'tree', 'car', 'fence']
    .forEach(function (t, i) {
      ctx.__sc3.add(boxMesh(0, 0, -0.5, 4, 20, -0.5,
        { b: true, selectKind: 'item', selectRef: { id: 100 + i, type: t } }));
    });
  vm.runInContext('build3DSetback()', ctx);
  let over = null;
  ctx.__sc3.traverse(function (o) { if (o.userData && o.userData.setbackOverhang) over = o; });
  assert.equal(over, null, '周辺物・外構が赤くなっている');
});
test('16: 屋根や壁は対象、制限面そのもの・選択マーカーは対象外', () => {
  const ctx = makeCtx([]);
  const yes = [
    { b: true, selectKind: 'wall', selectRef: { id: 1 } },
    { b: true, selectKind: 'room', selectRef: { id: 'rm1' } },
    { b: true, selectKind: 'item', selectRef: { id: 2, type: 'roof' } },
    { b: true, selectKind: 'item', selectRef: { id: 3, type: 'balcony' } }
  ];
  const no = [
    { b: true, setbackHelper: true },
    { b: true, selectionHelper: true },
    { b: true, hitProxy: true },
    {}   // b が無い（build3D の掃除対象ですらない）
  ];
  yes.forEach(function (u) {
    assert.equal(vm.runInContext('isSetbackSubjectMesh', ctx)(boxMesh(0, 0, 0, 1, 1, 1, u)), true, JSON.stringify(u));
  });
  no.forEach(function (u) {
    assert.equal(vm.runInContext('isSetbackSubjectMesh', ctx)(boxMesh(0, 0, 0, 1, 1, 1, u)), false, JSON.stringify(u));
  });
});

// ── 9. 内観3Dには出さない ─────────────────────────────────────────────────
test('16: 内観3Dには制限面を出さない（外構の話なので内観の見え方を変えない）', () => {
  const ctx = makeCtx([siteWith({ zone: 'low1', road: true, north: true }), road()], { isInt: true });
  vm.runInContext('build3DSetback()', ctx);
  assert.equal(ctx.__sc3.children.length, 0);
});

// ── 10. 設定UI ────────────────────────────────────────────────────────────
test('16(最重要): 北側斜線の無い用途地域では、北側斜線のスイッチを画面に出さない', () => {
  const items = [siteWith({ zone: 'low1', road: false, north: false }), road()];
  const ctx = makeCtx(items, { selected: items[0] });
  const withNorth = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx);
  assert.ok(withNorth.indexOf('北側斜線を表示') >= 0, '低層住専では出る');

  ['res-other', 'non-res'].forEach(function (z) {
    const it2 = siteWith({ zone: z, road: false, north: false });
    const ctx2 = makeCtx([it2, road()], { selected: it2 });
    const h = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx2);
    assert.equal(h.indexOf('北側斜線を表示'), -1, z + ' に北側斜線の欄が出ている');
    assert.ok(h.indexOf('道路斜線を表示') >= 0, z + ' でも道路斜線は出る');
  });
});
test('16: 中高層住専では基準高さ 10000mm が欄に入る', () => {
  const it = siteWith({ zone: 'mid2', road: false, north: false });
  const ctx = makeCtx([it, road()], { selected: it });
  const h = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx);
  assert.ok(h.indexOf('北側斜線の基準高さ') >= 0, h);
  assert.ok(/value="10000"/.test(h), '欄に 10000 が入っていない: ' + h);
  assert.ok(h.indexOf('中高層住専 10000mm') >= 0, '条文の既定が書かれていない');
});
test('16: 道路が無ければ道路斜線のスイッチも出さない', () => {
  const it = siteWith({ zone: 'low1', road: false, north: false });
  const ctx = makeCtx([it], { selected: it });
  const h = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx);
  assert.equal(h.indexOf('道路斜線を表示'), -1);
  assert.ok(h.indexOf('前面道路が置かれていない') >= 0);
});
test('16: 用途地域が未設定のうちは、斜線の欄そのものが出ない', () => {
  const it = siteWith(null);
  const ctx = makeCtx([it, road()], { selected: it });
  const h = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx);
  assert.equal(h.indexOf('道路斜線を表示'), -1);
  assert.equal(h.indexOf('北側斜線を表示'), -1);
  assert.ok(h.indexOf('用途地域') >= 0);
  assert.ok(h.indexOf('幅員') === -1);
});
test('16: 幅員は読み取り専用で、道路アイテムの数値がそのまま出る', () => {
  const it = siteWith({ zone: 'low1', road: true, north: false });
  const ctx = makeCtx([it, road()], { selected: it });
  const h = vm.runInContext('siteSetbackPanelHtml(DATA.items[0])', ctx);
  assert.ok(h.indexOf('readonly') >= 0);
  assert.ok(h.indexOf(String(Math.round(ROAD_WIDTH)) + 'mm') >= 0, h);
});
test('16(最重要): 用途地域を「未設定」に戻すと setback ごと消える（使われない値を残さない）', () => {
  const it = siteWith({ zone: 'low1', road: true, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('updateSelectedSetback("zone","")', ctx);
  assert.equal(ctx.__written[ctx.__written.length - 1].v, null);
  assert.equal(it.setback, undefined);
});
test('16: 北側斜線の無い用途地域へ切り替えると、north の指定は書き残されない', () => {
  const it = siteWith({ zone: 'low1', road: true, north: true });
  const ctx = makeCtx([it, road()], { selected: it });
  vm.runInContext('updateSelectedSetback("zone","non-res")', ctx);
  assert.deepEqual(plain(it.setback), { zone: 'non-res', road: true, north: false });
  // 戻しても north は false のまま（勝手に復活しない）
  vm.runInContext('updateSelectedSetback("zone","low1")', ctx);
  assert.deepEqual(plain(it.setback), { zone: 'low1', road: true, north: false });
});
test('16: チェックを入れると設定が書かれ、面が出るようになる', () => {
  const it = siteWith(null);
  const items = [it, road()];
  const ctx = makeCtx(items, { selected: it });
  assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)), []);
  vm.runInContext('updateSelectedSetback("zone","low1")', ctx);
  vm.runInContext('updateSelectedSetback("north",true)', ctx);
  assert.deepEqual(plain(it.setback), { zone: 'low1', road: false, north: true });
  assert.deepEqual(plain(vm.runInContext('setbackPlanes()', ctx)).map((p) => p.kind), ['north']);
});
