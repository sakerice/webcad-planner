// Task 21-1: 斜線制限の切り口に架かる屋根が「斜めの板＋厚み＋周囲を塞ぐ面」だけで
// できていること、そして **穴が開かないこと** を、実行して確かめる。
//
// grep ではない。index.html から関数を波括弧の対応で切り出し、node:vm で走らせ、
// 出来たジオメトリの頂点を読む。期待値は index.html の式を写さず、
//   屋根面の高さ = 基準高さ + 勾配 × 境界からの水平距離
//   板の下面    = 屋根面 − 板厚 × sqrt(1+勾配^2)   （面に垂直な厚み）
// と、条文と幾何から独立に書いている。
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
  this.array = Array.from(array); this.itemSize = itemSize;
  this.count = this.array.length / itemSize;
}
Attr.prototype.getX = function (i) { return this.array[i * this.itemSize]; };
Attr.prototype.getY = function (i) { return this.array[i * this.itemSize + 1]; };
Attr.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2]; };
Attr.prototype.getW = function (i) { return this.array[i * this.itemSize + 3]; };

function Geo() { this.attributes = {}; this.index = null; this.boundingBox = null; this.groups = []; this.uuid = 'g' + (Geo._n = (Geo._n || 0) + 1); }
Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; return this; };
Geo.prototype.addGroup = function (s, c, m) { this.groups.push({ start: s, count: c, materialIndex: m }); };
Geo.prototype.dispose = function () {};
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

const THREE = {
  Group: Group, Mesh: Mesh,
  BufferGeometry: Geo,
  Float32BufferAttribute: function (a, s) { return new Attr(a, s); },
  BufferAttribute: function (a, s) { return new Attr(a, s); },
  MeshStandardMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  MeshBasicMaterial: function (p) { return Object.assign({ isMat: true }, p); },
  Vector3: Vector3, DoubleSide: 2, RepeatWrapping: 1000,
};

const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H',
  'SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M', 'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX', 'SETBACK_CUT_SAMPLES', 'SETBACK_ROOF_MAX_RECTS',
  'SETBACK_SECTION_CELL_MM', 'SETBACK_SECTION_MAX_CELLS', 'SETBACK_VALLEY_LAP_MM',
  'CONTEXT_EXTERIOR_TYPES', '_setbackRoofCache', '_setbackRoofCacheKey'];

const FNS = [
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'getObjBounds', 'isFiniteCanvasValue',
  'isContextExteriorItemType', 'isGroundLevelItemType',
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane',
  'setbackDistanceMm', 'setbackLimitHeightMmAt', 'setbackPointAt',
  'setbackPlanes', 'setbackPlaneWorldCoef',
  'setbackTriSide', 'splitTriangleBySetbackPlane', 'setbackTriF', 'setbackLerpVert',
  'isSetbackSubjectMesh', 'setbackSubjectMeshes', 'setbackLiveCoefsForMesh',
  'setbackRoofTemplateItem',
  // Task 21-1 の本体
  'setbackWorldToTS', 'setbackSectionTris', 'setbackTriSRangeInBand', 'setbackSectionFootprint',
  'setbackOtherPlaneClips', 'setbackClipValue', 'setbackRectHasEdge',
  'setbackClipPolygon', 'setbackClipSegment',
  'setbackFootprintRects', 'setbackFootprintEdges',
  'setbackSlabAppearanceItem', 'setbackLowestLimitMmAt',
  'build3DSetbackRoofSlab', 'setbackSectionsForBuild', 'build3DSetbackRoofs',
  // 既存の屋根アイテム描画（斜線の板がここを通っていないことの確認に使う）
  'build3DRoofItem', 'roofEaveEdges',
];

function makeCtx(data) {
  const sc3 = new Group();
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String,
    SetbackLaw: Law, HeightModel: HeightModel, THREE,
    DATA: data, ST: { showDim: true, selected: null }, sc3,
    isInt: false,
    document: { createElement: () => ({ getContext: () => ({}) }) },
    LIGHT_SETTINGS: { env: 1 },
    resolveRoofAppearance: () => ({ color: '#222', texture: null }),
    getTexture3D: () => null,
    cloneRepeatReadyTexture: () => null,
    setTextureRepeatNoDistort: () => {},
    applyTextureFlip: () => {},
    makeExteriorLightingMaterial: (p) => Object.assign({ isMat: true }, p),
    ensureRoofAppearance: () => ({ whole: null, floors: {} }),
    getSlabTag: null,
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function run(ctx, src) { return vm.runInContext(src, ctx); }

// ── 試験用のプランと、実際に「建っている」メッシュ ──────────────────────
// 敷地は y=0 が北側境界。低層住専(基準5000・勾配1.25)。
const SITE = { type: 'site-rect', x: -1000, y: 0, w: 12000, d: 12000, rot: 0 };
function plan(setback) {
  const site = Object.assign({}, SITE);
  if (setback) site.setback = setback;
  return {
    items: [site,
      { type: 'roof', id: 'r1', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
        rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 100, roofEdgeColor: '#111' }],
    rooms: [{ id: 'a', floor: 1, x: 0, y: 1000, w: 6000, d: 4000 }],
    walls: [],
  };
}
const LOW1 = { zone: 'low1', road: false, north: true };
// 条文から独立に解いた北側斜線。境界は敷地の北端 y=0。
function northLimitMm(yMm) { return 5000 + 1.25 * yMm; }

// 世界座標(m)の三角形を1枚だけ持つメッシュをシーンへ置く。
function addTriMesh(ctx, tris) {
  run(ctx, 'var __pos=' + JSON.stringify(tris) + ';' +
    'var __g=new THREE.BufferGeometry();' +
    '__g.setAttribute("position",new THREE.Float32BufferAttribute(__pos,3));' +
    'var __m=new THREE.Mesh(__g,null); __m.userData={b:true}; sc3.add(__m);');
}
function planes(ctx) { return run(ctx, 'setbackPlanes()'); }

// 板の頂点を全部(ワールド m)返す。
function slabVerts(ctx) {
  return run(ctx, '(function(){var out=[];sc3.traverse(function(o){' +
    'if(o.isMesh&&o.userData&&o.userData.setbackRoof){var p=o.geometry.attributes.position;' +
    'for(var i=0;i<p.count;i++) out.push([p.getX(i),p.getY(i),p.getZ(i)]);}});return out;})()');
}
function slabTriCount(ctx) {
  return run(ctx, '(function(){var n=0;sc3.traverse(function(o){' +
    'if(o.isMesh&&o.userData&&o.userData.setbackRoof) n+=o.geometry.attributes.position.count/3;});return n;})()');
}
function buildSlabs(ctx) {
  run(ctx, 'build3DSetbackRoofs(setbackSectionsForBuild())');
}

// ══ 1. 設定が無ければ1枚も建たない ═════════════════════════════════════
test('21-1(最重要): 斜線を設定していないプランでは、板が1枚も建たない', () => {
  const ctx = makeCtx(plan(null));
  // 制限面より遥かに高い所に建物がある状態にしておく。
  addTriMesh(ctx, [0, 20, 2, 6, 20, 2, 0, 20, 4]);
  assert.equal(planes(ctx).length, 0);
  assert.equal(run(ctx, 'setbackSectionsForBuild().length'), 0);
  buildSlabs(ctx);
  assert.equal(slabTriCount(ctx), 0, '設定が無いのに板が建った');
});

// ══ 2. 断面は「実際に建っているメッシュ」から測る ═══════════════════════
// これが Task 21 で直した穴の正体である。以前は DATA 上の部屋・屋根アイテムから
// 組み立てた高さの近似を格子で拾っていたので、近似が見ていない実物（軒・樋・
// 棟の伸び）の上は「制限を超えていない」ことにされ、削られたまま塞がれなかった。
test('21-1(最重要): 部屋も屋根アイテムも無い場所でも、面より上の実物があれば断面に入る', () => {
  const ctx = makeCtx(plan(LOW1));
  // 平面 x=9000..9400, y=200..600。DATA 上の部屋(x 0..6000, y 1000..5000)の外。
  // ここでの制限は 5000+1.25*400 = 5500mm。9000mm の高さに板を置く。
  addTriMesh(ctx, [
    9.0, 9.0, 0.2, 9.4, 9.0, 0.2, 9.4, 9.0, 0.6,
    9.0, 9.0, 0.2, 9.4, 9.0, 0.6, 9.0, 9.0, 0.6,
  ]);
  const pl = planes(ctx)[0];
  assert.ok(pl, '北側斜線の面が1枚出る');
  const fp = run(ctx, 'setbackSectionFootprint(setbackPlanes()[0],setbackPlanes())');
  assert.ok(fp, '断面が測れる');
  // 三角形が乗っている範囲は必ず塗られていること。
  const covered = run(ctx, '(function(){var pl=setbackPlanes()[0],fp=setbackSectionFootprint(pl,setbackPlanes());' +
    'var miss=0,n=0;' +
    'for(var x=9010;x<=9390;x+=20) for(var y=210;y<=590;y+=20){' +
    'var t=setbackDistanceMm(pl,x,y), s=pl.px*x+pl.py*y;' +
    'var i=Math.floor((t-fp.t0)/fp.cell), j=Math.floor((s-fp.s0)/fp.cell); n++;' +
    'if(!(i>=0&&i<fp.nt&&j>=0&&j<fp.ns&&fp.cov[i*fp.ns+j])) miss++;}' +
    'return {n:n,miss:miss};})()');
  assert.equal(covered.miss, 0, '実物の真下が塗られていない: ' + JSON.stringify(covered));
  buildSlabs(ctx);
  assert.ok(slabTriCount(ctx) > 0, '板が建っていない');
});

test('21-1: 面より下しかない建物には板が建たない（削るものが無いのに屋根を出さない）', () => {
  const ctx = makeCtx(plan(LOW1));
  // y=4000 での制限は 10000mm。高さ 3m の床は超えない。
  addTriMesh(ctx, [0, 3, 4.0, 6, 3, 4.0, 6, 3, 4.4]);
  assert.equal(run(ctx, 'setbackSectionsForBuild().length'), 0);
  buildSlabs(ctx);
  assert.equal(slabTriCount(ctx), 0);
});

// ══ 3. 板は「斜めの板＋厚み」であって角柱ではない ═════════════════════
// 直角三角柱がぶら下がっていた頃は、見付けが屋根ローカルの y=-厚み という
// **水平な面**まで落ちていたので、頂点は上面からも「上面-板厚」からも外れていた。
function slabPlanes(ctx) {
  // 期待値は条文と幾何から独立に立てる。
  const slope = 1.25, thick = 0.1;                 // 屋根アイテムの roofThickness=100mm
  const drop = thick * Math.sqrt(1 + slope * slope);
  return { slope, thick, drop };
}
test('21-1(最重要): 板の頂点は「制限面の上」か「そこから板厚ぶん垂直に下」かのどちらかにしかない', () => {
  const ctx = makeCtx(plan(LOW1));
  addTriMesh(ctx, [
    1.0, 9.0, 1.2, 5.0, 9.0, 1.2, 5.0, 9.0, 3.0,
    1.0, 9.0, 1.2, 5.0, 9.0, 3.0, 1.0, 9.0, 3.0,
  ]);
  buildSlabs(ctx);
  const vs = slabVerts(ctx);
  assert.ok(vs.length > 0, '板が建っていない');
  const { drop } = slabPlanes(ctx);
  let onTop = 0, onBottom = 0;
  vs.forEach((v) => {
    const limit = northLimitMm(v[2] * 1000) / 1000;   // v[2] は世界 z(m) = 平面 y
    const dTop = Math.abs(v[1] - limit);
    const dBot = Math.abs(v[1] - (limit - drop));
    assert.ok(Math.min(dTop, dBot) < 1e-6,
      '上面でも下面でもない頂点がある: y=' + v[1] + ' 制限=' + limit + ' 下面=' + (limit - drop));
    if (dTop < 1e-6) onTop++; else onBottom++;
  });
  assert.ok(onTop > 0 && onBottom > 0, '上面と下面が両方あること: ' + onTop + '/' + onBottom);
});

test('21-1(最重要): 板の頂点は1つも制限面より上に出ない', () => {
  const ctx = makeCtx(plan(LOW1));
  addTriMesh(ctx, [
    1.0, 9.0, 1.2, 5.0, 9.0, 1.2, 5.0, 9.0, 3.0,
    1.0, 9.0, 1.2, 5.0, 9.0, 3.0, 1.0, 9.0, 3.0,
  ]);
  buildSlabs(ctx);
  slabVerts(ctx).forEach((v) => {
    const limit = northLimitMm(v[2] * 1000) / 1000;
    assert.ok(v[1] <= limit + 1e-6, '制限 ' + limit + ' より上に頂点 ' + v[1]);
  });
});

test('21-1: 板の厚みは面に垂直（勾配1.25なら垂直方向には板厚の sqrt(1+1.25^2) 倍）', () => {
  const ctx = makeCtx(plan(LOW1));
  addTriMesh(ctx, [
    1.0, 9.0, 1.2, 5.0, 9.0, 1.2, 5.0, 9.0, 3.0,
    1.0, 9.0, 1.2, 5.0, 9.0, 3.0, 1.0, 9.0, 3.0,
  ]);
  buildSlabs(ctx);
  const vs = slabVerts(ctx);
  const { drop } = slabPlanes(ctx);
  let lowest = Infinity;
  vs.forEach((v) => { lowest = Math.min(lowest, northLimitMm(v[2] * 1000) / 1000 - v[1]); });
  let deepest = -Infinity;
  vs.forEach((v) => { deepest = Math.max(deepest, northLimitMm(v[2] * 1000) / 1000 - v[1]); });
  assert.ok(Math.abs(lowest) < 1e-6, '上面が制限面に乗っていない');
  assert.ok(Math.abs(deepest - drop) < 1e-6,
    '下面の下がりが ' + deepest + ' で、板厚×sqrt(1+勾配^2)=' + drop + ' でない');
});

// ══ 4. 板は閉じている ═══════════════════════════════════════════════
test('21-1(最重要): 塗った範囲の輪郭には必ず見付けが立つ（開けっ放しの縁を作らない）', () => {
  const ctx = makeCtx(plan(LOW1));
  // L 字に凹ませる: 2枚の板を段違いに置く。
  addTriMesh(ctx, [
    1.0, 9.0, 1.2, 5.0, 9.0, 1.2, 5.0, 9.0, 2.4,
    1.0, 9.0, 1.2, 5.0, 9.0, 2.4, 1.0, 9.0, 2.4,
  ]);
  addTriMesh(ctx, [
    1.0, 9.0, 2.4, 2.6, 9.0, 2.4, 2.6, 9.0, 3.2,
    1.0, 9.0, 2.4, 2.6, 9.0, 3.2, 1.0, 9.0, 3.2,
  ]);
  const res = run(ctx, '(function(){var pl=setbackPlanes()[0];' +
    'var fp=setbackSectionFootprint(pl,setbackPlanes());' +
    'var edges=setbackFootprintEdges(fp);' +
    // 輪郭の総延長(mm)を数え、境界セル数×セル幅と一致することを見る。
    'var len=0; edges.forEach(function(e){len+=Math.abs(e.tHi-e.tLo)+Math.abs(e.sHi-e.sLo);});' +
    'var need=0, i, j;' +
    'function c(a,b){return (a>=0&&a<fp.nt&&b>=0&&b<fp.ns)?fp.cov[a*fp.ns+b]:0;}' +
    'for(i=0;i<=fp.nt;i++) for(j=0;j<fp.ns;j++) if(c(i-1,j)!==c(i,j)) need+=fp.cell;' +
    'for(j=0;j<=fp.ns;j++) for(i=0;i<fp.nt;i++) if(c(i,j-1)!==c(i,j)) need+=fp.cell;' +
    'return {len:len,need:need,edges:edges.length};})()');
  assert.ok(res.edges > 0, '輪郭が1本も出ていない');
  assert.ok(Math.abs(res.len - res.need) < 1e-6,
    '輪郭の総延長 ' + res.len + ' が境界セル境界の総延長 ' + res.need + ' と違う');
});

test('21-1: 上面と下面は同じ枚数だけ張られる（片面だけの板を作らない）', () => {
  const ctx = makeCtx(plan(LOW1));
  addTriMesh(ctx, [
    1.0, 9.0, 1.2, 5.0, 9.0, 1.2, 5.0, 9.0, 3.0,
    1.0, 9.0, 1.2, 5.0, 9.0, 3.0, 1.0, 9.0, 3.0,
  ]);
  const res = run(ctx, '(function(){var pl=setbackPlanes()[0];' +
    'var fp=setbackSectionFootprint(pl,setbackPlanes());' +
    'var rects=setbackFootprintRects(fp), area=0, cells=0, i, j;' +
    'rects.forEach(function(r){area+=(r.tHi-r.tLo)*(r.sHi-r.sLo);});' +
    'for(i=0;i<fp.nt;i++) for(j=0;j<fp.ns;j++) if(fp.cov[i*fp.ns+j]) cells++;' +
    'return {area:area, cellArea:cells*fp.cell*fp.cell, rects:rects.length};})()');
  assert.ok(res.rects > 0);
  assert.ok(Math.abs(res.area - res.cellArea) < 1e-6,
    '矩形の総面積 ' + res.area + ' が塗ったセルの総面積 ' + res.cellArea + ' と違う（重なりか抜けがある）');
});

// ══ 5. 面が2枚あるとき、谷で穴も二重張りも作らない ═══════════════════
// 「セルの中心で相手に譲る」実装では、面ごとに格子の切り方が違うぶん、
// 谷をまたぐセル同士が両方とも譲って両方落ちた（既定プランで11か所空いた）。
// 「セル単位で両方残す」実装では、同じ高さの面が二重に張られて縞に見えた。
function twoPlanePlan() {
  const p = plan({ zone: 'low1', road: true, north: true });
  // 西側に前面道路。道路アイテムの奥行 D が幅員。
  p.items.push({ type: 'road', id: 'rd', x: -4000, y: -1000, w: 20000, d: 4000, rot: 90 });
  return p;
}
test('21-1(最重要): 面が2枚のとき、谷の上のどの点も必ずどちらかの板に覆われる', () => {
  const ctx = makeCtx(twoPlanePlan());
  addTriMesh(ctx, [
    0.5, 12.0, 0.5, 7.0, 12.0, 0.5, 7.0, 12.0, 5.0,
    0.5, 12.0, 0.5, 7.0, 12.0, 5.0, 0.5, 12.0, 5.0,
  ]);
  const pls = planes(ctx);
  assert.equal(pls.length, 2, '北側＋道路で2枚: ' + JSON.stringify(pls.map((p) => p.kind)));
  const res = run(ctx, '(function(){' +
    'var secs=setbackSectionsForBuild(); var miss=[], both=0, n=0;' +
    'for(var x=600;x<=6900;x+=25) for(var y=600;y<=4900;y+=25){' +
    '  var lim=Infinity, k;' +
    '  for(k=0;k<secs.length;k++) lim=Math.min(lim,setbackLimitHeightMmAt(secs[k].plane,x,y));' +
    '  if(12000<=lim) continue;' +   // その点の建物(高さ12m)が制限を超えていなければ対象外
    '  n++;' +
    '  var hit=0;' +
    '  for(k=0;k<secs.length;k++){' +
    '    var pl=secs[k].plane, fp=secs[k].fp;' +
    '    var t=setbackDistanceMm(pl,x,y), s=pl.px*x+pl.py*y;' +
    '    var i=Math.floor((t-fp.t0)/fp.cell), j=Math.floor((s-fp.s0)/fp.cell);' +
    '    if(!(i>=0&&i<fp.nt&&j>=0&&j<fp.ns&&fp.cov[i*fp.ns+j])) continue;' +
    '    var cl=setbackOtherPlaneClips(pl,setbackPlanes()), q, inside=true;' +
    '    for(q=0;q<cl.length;q++) if(setbackClipValue(cl[q],t,s)<0) inside=false;' +
    '    if(inside) hit++;' +
    '  }' +
    '  if(hit===0) miss.push([x,y]);' +
    '  if(hit>1) both++;' +
    '}' +
    'return {n:n,miss:miss.length,sample:miss.slice(0,5),both:both};})()');
  assert.ok(res.n > 500, '谷をまたぐ点が十分に取れていない: ' + res.n);
  assert.equal(res.miss, 0, 'どちらの板にも覆われない点がある: ' + JSON.stringify(res.sample));
});

test('21-1: 面が2枚でも、板が二重に張られるのは谷のごく細い帯だけ（縞にならない）', () => {
  const ctx = makeCtx(twoPlanePlan());
  addTriMesh(ctx, [
    0.5, 12.0, 0.5, 7.0, 12.0, 0.5, 7.0, 12.0, 5.0,
    0.5, 12.0, 0.5, 7.0, 12.0, 5.0, 0.5, 12.0, 5.0,
  ]);
  const res = run(ctx, '(function(){' +
    'var secs=setbackSectionsForBuild(), n=0, both=0, worst=0;' +
    'for(var x=600;x<=6900;x+=25) for(var y=600;y<=4900;y+=25){' +
    '  var lim=Infinity, k;' +
    '  for(k=0;k<secs.length;k++) lim=Math.min(lim,setbackLimitHeightMmAt(secs[k].plane,x,y));' +
    '  if(12000<=lim) continue;' +
    '  n++; var hit=0, gap=Infinity;' +
    '  for(k=0;k<secs.length;k++){' +
    '    var pl=secs[k].plane, fp=secs[k].fp;' +
    '    var t=setbackDistanceMm(pl,x,y), s=pl.px*x+pl.py*y;' +
    '    var i=Math.floor((t-fp.t0)/fp.cell), j=Math.floor((s-fp.s0)/fp.cell);' +
    '    if(!(i>=0&&i<fp.nt&&j>=0&&j<fp.ns&&fp.cov[i*fp.ns+j])) continue;' +
    '    var cl=setbackOtherPlaneClips(pl,setbackPlanes()), q, inside=true, m=Infinity;' +
    '    for(q=0;q<cl.length;q++){ var v=setbackClipValue(cl[q],t,s); if(v<0) inside=false; if(v<m) m=v; }' +
    '    if(inside){ hit++; if(m<gap) gap=m; }' +
    '  }' +
    '  if(hit>1){ both++; if(gap>worst) worst=gap; }' +
    '}' +
    'return {n:n,both:both,worstLapMm:worst};})()');
  // 重なりは「谷から SETBACK_VALLEY_LAP_MM(=1mm) 以内」に限られること。
  assert.ok(res.worstLapMm <= 1.0000001,
    '谷から ' + res.worstLapMm + 'mm も離れた所で板が二重になっている');
  assert.ok(res.both / res.n < 0.02,
    '二重に張られた点が ' + res.both + '/' + res.n + ' もある（縞に見える）');
});

// ══ 6. 既存の屋根アイテムの形状生成を流用していない ═══════════════════
test('21-1(最重要): build3DRoofItem は setbackOutline を見ない（角柱の作りを二度と流用しない）', () => {
  const ctx = makeCtx(plan(null));
  function build(extra) {
    run(ctx, 'var __g=new THREE.Group();' +
      'build3DRoofItem(__g,' + JSON.stringify(Object.assign(
        { type: 'roof', roofType: 'mono', w: 4000, d: 3000, rot: 0, floor: 1,
          elev: 0, pitch: 45, roofThickness: 100 }, extra)) + ',4,3);' +
      'var __out=[]; __g.children.forEach(function(m){var p=m.geometry.attributes.position;' +
      'for(var i=0;i<p.count;i++) __out.push([p.getX(i),p.getY(i),p.getZ(i)]);});');
    return run(ctx, 'JSON.stringify(__out)');
  }
  const plainRoof = build({});
  const withOutline = build({
    setbackOutline: { rects: [{ x0: -1, x1: 1, z0: -1, z1: 1 }], edges: [] },
  });
  assert.equal(withOutline, plainRoof,
    'setbackOutline を持たせると形が変わる = 斜線の板が既存の屋根の作りを通っている');
});

test('21-1: 板は屋根アイテムの色・板厚・鼻隠しの色だけを借りる（形は借りない）', () => {
  const ctx = makeCtx(plan(LOW1));
  const ap = run(ctx, 'JSON.stringify(setbackSlabAppearanceItem())');
  const o = JSON.parse(ap);
  assert.equal(o.roofThickness, 100, '見本の屋根の板厚を借りる');
  assert.equal(o.roofEdgeColor, '#111', '見本の屋根の鼻隠しの色を借りる');
  assert.equal(o.roofType, undefined, '屋根の「型」は借りない');
  assert.equal(o.pitch, undefined, '屋根の「勾配」は借りない');
  assert.equal(o.w, undefined, '屋根の「大きさ」は借りない');
});
