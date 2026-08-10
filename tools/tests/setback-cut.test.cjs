// Task 17: 斜線制限で建物を **実際に削り**、切り口に片流れ屋根を架け、その下の
// 天井と壁の頭がそれについてくることを、**実行して**確かめる。
//
// grep ではない。index.html から関数を波括弧の対応で切り出し、node:vm で走らせ、
// 出来たジオメトリの頂点・天井面の高さ・壁の上端を読む。
// 期待値は index.html の式を写さず、条文から独立に書いている:
//   北側 = 基準高さ + 1.25 × 北側境界からの水平距離
//   天井 = 屋根下面 − 250mm
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
Attr.prototype.getW = function (i) { return this.array[i * this.itemSize + 3]; };

function Geo() { this.attributes = {}; this.index = null; this.boundingBox = null; this.groups = []; this.uuid = 'g' + (Geo._n = (Geo._n || 0) + 1); this.disposed = false; }
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
  Vector3: Vector3, DoubleSide: 2, SRGBColorSpace: 'srgb'
};

const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', 'ROOM_OVERLAP_EPS_MM',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', '_ceilingClampWarned',
  'SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M', 'SETBACK_CUT_SAMPLES',
  'SETBACK_NORTH_COLOR', 'SETBACK_ROAD_COLOR', 'SETBACK_OVER_COLOR',
  'CONTEXT_EXTERIOR_TYPES', '_setbackRoofCache', '_setbackRoofCacheKey',
  'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M'];

const FNS = [
  // 高さモデル（既存）
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM',
  'roomAtPointOnFloor', 'wallRoofTopLimitWorldY', 'wallLimitingRoofs', 'wallTopHeightAtM',
  'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM',
  // 斜線（Task 16）
  'getObjBounds', 'isFiniteCanvasValue',
  'isContextExteriorItemType', 'isGroundLevelItemType',
  'setbackLawApi', 'siteSetbackConfig', 'activeSetbackSite', 'setbackBoundsMm',
  'setbackRoadItem', 'setbackRoadWidthMm', 'makeSetbackPlane',
  'setbackDistanceMm', 'setbackLimitHeightMmAt', 'setbackPointAt',
  'setbackPlanes', 'setbackPlaneQuadMm', 'setbackPlaneWorldCoef',
  'setbackTriSide', 'splitTriangleBySetbackPlane', 'setbackTriF', 'setbackLerpVert',
  'clipTriangleAboveSetbackPlane',
  'isSetbackSubjectMesh', 'setbackSubjectMeshes', 'setbackLiveCoefsForMesh',
  'collectSetbackOverhangTris', 'setbackOverhangAudit',
  // 斜線で削る（Task 17）
  'setbackBuildingPlanBoundsMm', 'setbackBuildingTopWorldYAt', 'setbackCutSpanMm',
  'setbackRoofTemplateItem', 'setbackRoofItemForPlane', 'setbackRoofItems',
  'setbackRoofsOverRoom', 'build3DSetbackRoofs',
  'setbackCutGeometry', 'applySetbackCut'
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
    isInt: !!o.isInt, isWalkView: function () { return false; },
    exteriorDetailEnabled: function () { return false; },
    build3DRoofItem: function (grp) { grp.add(new Mesh(new Geo(), null)); },
    build3DRoofGutters: function () {},
    resolveRoofAppearance: function () { return { color: '#222', texture: null }; },
    invalidate3D: function () {},
    __sc3: sc3
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function run(ctx, src) { return vm.runInContext(src, ctx); }
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ── 小さな試験用プラン ────────────────────────────────────────────────
// 敷地は y=0 が北側境界。建物は y=1000..5000、x=0..6000、3階建て(階高2700・基礎450)。
// 3階の天端は 8550mm で、北側斜線(5000 + 1.25d)が 8550 になるのは y=2840。
// つまり y<2840 の側だけが制限からはみ出す = そこだけ削られる、という形にしてある。
function basePlan(setback) {
  const site = { type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  if (setback) site.setback = setback;
  return {
    items: [site,
      { type: 'roof', id: 'r1', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
        rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }],
    rooms: [
      { id: 'north', n: '北の部屋', floor: 3, x: 0, y: 1000, w: 6000, d: 3000 },
      { id: 'south', n: '南の部屋', floor: 3, x: 0, y: 4000, w: 6000, d: 1000 },
      { id: 'g2', n: '2階', floor: 2, x: 0, y: 1000, w: 6000, d: 4000 },
      { id: 'g1', n: '1階', floor: 1, x: 0, y: 1000, w: 6000, d: 4000 }
    ],
    walls: [
      { id: 'wn', floor: 3, x1: 0, y1: 1000, x2: 6000, y2: 1000, thick: 120 },
      { id: 'ws', floor: 3, x1: 0, y1: 5000, x2: 6000, y2: 5000, thick: 120 }
    ]
  };
}
const LOW1 = { zone: 'low1', road: false, north: true };
// 条文から独立に解いた北側斜線（基準5000・勾配1.25・境界は y=0）
function northLimitMm(yMm) { return 5000 + 1.25 * yMm; }

// ══ 1. 設定が無ければ何も起きない ═════════════════════════════════════
test('17(最重要): 斜線を設定していないプランでは、片流れ屋根が1枚も作られない', () => {
  const ctx = makeCtx(basePlan(null));
  assert.deepEqual(plain(run(ctx, 'setbackPlanes()')), []);
  assert.deepEqual(plain(run(ctx, 'setbackRoofItems()')), []);
  assert.deepEqual(plain(run(ctx, 'setbackRoofsOverRoom(DATA.rooms[0])')), []);
  // 面を直接渡せば範囲は出る。出ないのは「面が1枚も作られない」からであって、
  // 切り取りの計算そのものが壊れているからではない、と言い分けておく。
  assert.notEqual(run(ctx,
    'setbackCutSpanMm({kind:"north",baseMm:5000,slope:1.25,nx:0,ny:1,d0:0,px:-1,py:0})'), null);
});

test('17(最重要): 斜線を設定していないプランでは、applySetbackCut がメッシュを1つも触らない', () => {
  const ctx = makeCtx(basePlan(null));
  run(ctx, 'var m=new THREE.Mesh(new THREE.BufferGeometry(),null);' +
    'm.geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,9,0, 1,9,0, 0,9,1],3));' +
    'm.userData={b:true}; sc3.add(m); __before=m.geometry;');
  assert.equal(run(ctx, 'applySetbackCut()'), null);
  assert.equal(run(ctx, 'sc3.children[0].geometry===__before'), true, 'ジオメトリが差し替わっていない');
});

test('17: 斜線の無い部屋の天井は今までどおり null プロファイル（宣言も斜線も無い）', () => {
  const ctx = makeCtx(basePlan(null));
  assert.equal(run(ctx, 'roomCeilingProfile(DATA.rooms[0])'), null);
});

// ══ 2. 片流れ屋根は制限面そのものに一致する ═══════════════════════════
test('17(最重要): 斜線の片流れ屋根の屋根面は「5000 + 1.25 × 北側境界からの距離」に一致する', () => {
  const ctx = makeCtx(basePlan(LOW1));
  const roofs = run(ctx, 'setbackRoofItems()');
  assert.equal(roofs.length, 1, '北側斜線1枚ぶんの片流れ屋根');
  assert.equal(roofs[0].roofType, 'mono', '片流れである');
  assert.equal(roofs[0].setbackKind, 'north');
  // 屋根の高さは既存の roofUndersideWorldYAt（= roofLocalPoint + roofSurfaceHeightAt）
  // で読む。斜線側に高さの計算を書き足していないことの検査でもある。
  // 切り取り範囲（この試験プランでは境界から 906〜2531mm）の中で測る
  const span = run(ctx, 'setbackCutSpanMm(setbackPlanes()[0])');
  assert.ok(span.tLo < 1100 && span.tHi > 2400, '切り取り範囲: ' + JSON.stringify(span));
  [1200, 1600, 2000, 2400].forEach((y) => {
    const covered = run(ctx, 'roofCoversPlanPoint(setbackRoofItems()[0],3000,' + y + ')');
    assert.equal(covered, true, 'y=' + y + ' は切り口の範囲に入る');
    const got = run(ctx, 'roofUndersideWorldYAt(setbackRoofItems()[0],3000,' + y + ')/U');
    assert.ok(Math.abs(got - northLimitMm(y)) < 1e-6,
      'y=' + y + ' で屋根面 ' + got + ' が制限 ' + northLimitMm(y) + ' に一致しない');
  });
});

test('17: 片流れ屋根の勾配は斜線の勾配そのもの（atan 1.25 = 51.34°）', () => {
  const ctx = makeCtx(basePlan(LOW1));
  const r = run(ctx, 'setbackRoofItems()[0]');
  assert.ok(Math.abs(r.pitch - Math.atan(1.25) * 180 / Math.PI) < 1e-9);
  assert.equal(r.rot, 0, '北側は平面 +y 方向へ上がるので回転 0');
});

test('17: 切り取り範囲は「制限面より上に建物がある所」だけで、建物が低ければ屋根は出ない', () => {
  // 建物を敷地の南端へ動かすと、そこでの制限は 5000+1.25*6000=12500mm。
  // 2階建て(基礎450+2700*2=5850)は届かないので削るものが無い。
  const plan = basePlan(LOW1);
  plan.rooms.forEach((r) => { r.y += 5000; });
  plan.walls.forEach((w) => { w.y1 += 5000; w.y2 += 5000; });
  plan.items[1].y += 5000;
  const ctx = makeCtx(plan);
  assert.equal(run(ctx, 'setbackPlanes().length'), 1, '面そのものは出ている');
  assert.equal(run(ctx, 'setbackCutSpanMm(setbackPlanes()[0])'), null, '削る範囲が無い');
  assert.deepEqual(plain(run(ctx, 'setbackRoofItems()')), [], '屋根も出ない');
});

// ══ 3. 天井は削った結果として勾配になる ═══════════════════════════════
test('17(最重要): 削られた部屋は宣言なしで勾配天井になり、その高さは「制限 − 250mm」である', () => {
  const ctx = makeCtx(basePlan(LOW1));
  const p = run(ctx, 'roomCeilingProfile(DATA.rooms[0])');
  assert.ok(p, '北の部屋にプロファイルが出る');
  assert.equal(p.reason, 'setback', '効いたのは宣言ではなく斜線である');
  assert.equal(run(ctx, 'roomDeclaresSlopedCeiling(DATA.rooms[0])'), false, '宣言はしていない');
  [1200, 1600, 2000, 2400].forEach((y) => {
    const got = run(ctx, 'roomCeilingWorldYAtMm(DATA.rooms[0],roomCeilingProfile(DATA.rooms[0]),3000,' + y + ')/U');
    const want = northLimitMm(y) - 250;
    assert.ok(Math.abs(got - want) < 1e-6, 'y=' + y + ' の天井 ' + got + ' が ' + want + ' でない');
  });
});

test('17(最重要): 制限に当たっていない場所の天井高は1mmも動かない', () => {
  const ctx = makeCtx(basePlan(LOW1));
  // 同じ「北の部屋」でも、南寄り(y=3800)では制限のほうが高いので削られない。
  // そこの天井は元の平天井(階高)のままでなければならない。
  const flat = run(ctx, '(floorBaseY(3)+roomCeilingHeightM(DATA.rooms[0]))/U');
  assert.ok(northLimitMm(3800) - 250 > flat, '前提: y=3800 では制限のほうが高い');
  const got = run(ctx, 'roomCeilingWorldYAtMm(DATA.rooms[0],roomCeilingProfile(DATA.rooms[0]),3000,3800)/U');
  assert.ok(Math.abs(got - flat) < 1e-6, '削られていない位置の天井 ' + got + ' が元の ' + flat + ' と違う');
});

test('17: 宣言した勾配天井と斜線由来の勾配天井は reason で見分けられる', () => {
  const plan = basePlan(LOW1);
  plan.rooms[1].ceiling = { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 };
  const ctx = makeCtx(plan);
  assert.equal(run(ctx, 'roomCeilingProfile(DATA.rooms[0]).reason'), 'setback');
  assert.equal(run(ctx, 'roomCeilingProfile(DATA.rooms[1]).reason'), 'declared');
});

test('17: 上に部屋がある階には斜線の勾配天井は出ない（あいだに床があるから）', () => {
  const ctx = makeCtx(basePlan(LOW1));
  assert.equal(run(ctx, 'DATA.rooms[3].floor'), 1);
  assert.equal(run(ctx, 'roomHasRoomAbove(DATA.rooms[3])'), true, '前提: 1階の上には部屋がある');
  assert.deepEqual(plain(run(ctx, 'setbackRoofsOverRoom(DATA.rooms[3])')), []);
  assert.equal(run(ctx, 'roomCeilingProfile(DATA.rooms[3])'), null);
});

// ══ 4. 壁の頭は同じ屋根で切られる ════════════════════════════════════
test('17(最重要): 斜線の片流れ屋根は「壁の頭を押さえる屋根」として壁に渡る', () => {
  const ctx = makeCtx(basePlan(LOW1));
  const roofs = run(ctx, 'wallLimitingRoofs(DATA.walls[0])');
  assert.equal(roofs.length >= 1, true, '北の壁に屋根が渡っている');
  assert.equal(roofs.some((r) => r.setbackRoof === true), true, 'そのうち1枚は斜線由来である');
});

test('17(最重要): 北の壁の上端は、その位置の制限面より上に出ない', () => {
  const ctx = makeCtx(basePlan(LOW1));
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
    const y = run(ctx, '(function(){var w=DATA.walls[0];var rf=wallLimitingRoofs(w);' +
      'return floorBaseY(w.floor)+wallTopHeightAtM(w,' + t + ',wallFullHeightM(w.floor),undefined,rf);})()/U');
    const lim = northLimitMm(1000);
    assert.ok(y <= lim + 1e-6, 't=' + t + ' の壁上端 ' + y + ' が制限 ' + lim + ' を超えている');
  });
});

// ══ 5. 三角形の切り分けは1本から出る ═════════════════════════════════
test('17(最重要): 上側と下側は同じ切り方から出る（足すと元の三角形の面積に戻る）', () => {
  const ctx = makeCtx(basePlan(null));
  // 水平な面 y=0 を跨ぐ三角形
  const tri = [0, -1, 0, 4, -1, 0, 0, 3, 0];
  const co = { a: 0, b: 0, c: 0 };
  const res = run(ctx, '(function(){var tri=' + JSON.stringify(tri) + ',co=' + JSON.stringify(co) + ';' +
    'var fv=setbackTriF(tri,co); var s=splitTriangleBySetbackPlane(fv);' +
    'var rows=[[tri[0],tri[1],tri[2]],[tri[3],tri[4],tri[5]],[tri[6],tri[7],tri[8]]];' +
    'function area(list){var A=0;list.forEach(function(t){var v=[];' +
    'setbackLerpVert(t[0],rows,3,v);setbackLerpVert(t[1],rows,3,v);setbackLerpVert(t[2],rows,3,v);' +
    'A+=Math.abs((v[3]-v[0])*(v[7]-v[1])-(v[6]-v[0])*(v[4]-v[1]))/2;});return A;}' +
    'return {above:area(s.above),below:area(s.below)};})()');
  const whole = Math.abs((4 - 0) * (3 - (-1)) - (0 - 0) * (-1 - (-1))) / 2;
  assert.ok(res.above > 0.01 && res.below > 0.01, '両側とも出ている');
  assert.ok(Math.abs(res.above + res.below - whole) < 1e-9,
    '上 ' + res.above + ' + 下 ' + res.below + ' が元の ' + whole + ' にならない');
});

test('17: 面より完全に下の三角形は、上側が空・下側がそのまま1枚', () => {
  const ctx = makeCtx(basePlan(null));
  const r = run(ctx, '(function(){var fv=setbackTriF([0,-2,0, 1,-3,0, 0,-2,1],{a:0,b:0,c:0});' +
    'var s=splitTriangleBySetbackPlane(fv); return {a:s.above.length,b:s.below.length};})()');
  assert.deepEqual(plain(r), { a: 0, b: 1 });
});

// ══ 6. 実際に削る ════════════════════════════════════════════════════
// 世界座標 y=2 の水平面（a=0,b=0,c=2）で、縦に伸びた箱を切る。
function boxTriangles(x0, y0, z0, x1, y1, z1) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
             [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]];
  const out = [];
  f.forEach((t) => t.forEach((i) => out.push(p[i][0], p[i][1], p[i][2])));
  return out;
}
function cutCtxWithBox(matrixWorld) {
  const ctx = makeCtx(basePlan(null));
  const pos = boxTriangles(0, 0, 0, 1, 4, 1);
  const uv = [];
  for (let i = 0; i < pos.length / 3; i++) uv.push(0, pos[i * 3 + 1] / 4);
  run(ctx, '__pos=' + JSON.stringify(pos) + '; __uv=' + JSON.stringify(uv) + ';');
  run(ctx, 'var g=new THREE.BufferGeometry();' +
    'g.setAttribute("position",new THREE.Float32BufferAttribute(__pos,3));' +
    'g.setAttribute("uv",new THREE.Float32BufferAttribute(__uv,2));' +
    '__mesh=new THREE.Mesh(g,null); __mesh.userData={b:true};' +
    (matrixWorld ? '__mesh.matrixWorld={elements:' + JSON.stringify(matrixWorld) + '};' : '') +
    'sc3.add(__mesh);');
  return ctx;
}
// 世界座標での全頂点を読む
function worldVerts(ctx) {
  return run(ctx, '(function(){var g=__mesh.geometry,p=g.attributes.position,out=[],i,v;' +
    'for(i=0;i<p.count;i++){v=new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(__mesh.matrixWorld);' +
    'out.push([v.x,v.y,v.z]);} return out;})()');
}

test('17(最重要): 面より上の部分は本当に消え、下の部分は残る', () => {
  const ctx = cutCtxWithBox(null);
  const before = worldVerts(ctx);
  assert.ok(before.some((v) => v[1] > 2.001), '切る前は面より上に頂点がある');
  const ng = run(ctx, 'setbackCutGeometry(__mesh,[{a:0,b:0,c:2}])');
  assert.ok(ng, 'ジオメトリが差し替わる');
  run(ctx, '__mesh.geometry=setbackCutGeometry(__mesh,[{a:0,b:0,c:2}])||__mesh.geometry;');
  const after = worldVerts(ctx);
  const maxY = after.reduce((m, v) => Math.max(m, v[1]), -Infinity);
  const minY = after.reduce((m, v) => Math.min(m, v[1]), Infinity);
  assert.ok(maxY <= 2 + 1e-6, '面(2.0)より上に頂点が残っている: ' + maxY);
  assert.ok(Math.abs(minY - 0) < 1e-6, '下の端(0)まで残っている: ' + minY);
  assert.ok(after.length > 0, '全部消えてはいない');
});

test('17(最重要): 移動・回転している壁でも、切れる位置は世界座標の面の上である', () => {
  // 90度回して (10, 5, -3) へ動かした行列（three.js の列優先）。
  // 位置をローカルのまま内分し、そのうえで逆行列を掛けてしまうと、この検査が落ちる。
  const m = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 10, 5, -3, 1];
  const ctx = cutCtxWithBox(m);
  const before = worldVerts(ctx);
  assert.ok(before.some((v) => v[1] > 7.9), '切る前は世界 y=9 まである');
  run(ctx, '__mesh.geometry=setbackCutGeometry(__mesh,[{a:0,b:0,c:7}])||__mesh.geometry;');
  const after = worldVerts(ctx);
  const maxY = after.reduce((mx, v) => Math.max(mx, v[1]), -Infinity);
  const minY = after.reduce((mx, v) => Math.min(mx, v[1]), Infinity);
  assert.ok(maxY <= 7 + 1e-6, '世界 y=7 より上が残っている: ' + maxY);
  assert.ok(Math.abs(minY - 5) < 1e-6, '箱の下端（世界 y=5）が動いてしまった: ' + minY);
  // 水平方向は1mmも動いてはならない
  // world.x = z+10 ∈ [10,11]、world.z = -x-3 ∈ [-4,-3]（行列は列優先）
  const xs = after.map((v) => v[0]), zs = after.map((v) => v[2]);
  assert.ok(Math.abs(Math.min.apply(null, xs) - 10) < 1e-6, 'x の最小が動いた: ' + Math.min.apply(null, xs));
  assert.ok(Math.abs(Math.max.apply(null, xs) - 11) < 1e-6, 'x の最大が動いた: ' + Math.max.apply(null, xs));
  assert.ok(Math.abs(Math.min.apply(null, zs) - (-4)) < 1e-6, 'z の最小が動いた: ' + Math.min.apply(null, zs));
  assert.ok(Math.abs(Math.max.apply(null, zs) - (-3)) < 1e-6, 'z の最大が動いた: ' + Math.max.apply(null, zs));
});

test('17(最重要): 切った断面では UV も同じ t で内分される（位置だけ切って仕上げを置き去りにしない）', () => {
  const ctx = cutCtxWithBox(null);
  run(ctx, '__mesh.geometry=setbackCutGeometry(__mesh,[{a:0,b:0,c:2}])||__mesh.geometry;');
  const rows = run(ctx, '(function(){var g=__mesh.geometry,p=g.attributes.position,u=g.attributes.uv,out=[],i;' +
    'for(i=0;i<p.count;i++) out.push([p.getY(i),u.getY(i)]); return out;})()');
  assert.ok(rows.length > 0);
  rows.forEach((r) => {
    assert.ok(Math.abs(r[1] - r[0] / 4) < 1e-6,
      '高さ ' + r[0] + ' の UV.v が ' + r[1] + '（期待 ' + (r[0] / 4) + '）');
  });
});

test('17: 面より完全に下のメッシュは触られない（ジオメトリが同一オブジェクトのまま）', () => {
  const ctx = cutCtxWithBox(null);
  assert.equal(run(ctx, 'setbackCutGeometry(__mesh,[{a:0,b:0,c:99}])'), null);
});

test('17: マテリアルの分かれ目（groups）は切ったあとも保たれる', () => {
  const ctx = cutCtxWithBox(null);
  run(ctx, '__mesh.geometry.addGroup(0,18,0); __mesh.geometry.addGroup(18,18,1);');
  run(ctx, '__ng=setbackCutGeometry(__mesh,[{a:0,b:0,c:2}]);');
  const gs = run(ctx, '__ng.groups.map(function(g){return [g.start,g.count,g.materialIndex];})');
  assert.equal(gs.length, 2, 'グループが2つ残る');
  const total = run(ctx, '__ng.attributes.position.count');
  assert.equal(gs[0][0], 0);
  assert.equal(gs[0][1] + gs[1][1], total, 'グループの合計が頂点数と一致する');
  assert.deepEqual(gs.map((g) => g[2]).sort(), [0, 1]);
});

// ══ 7. 削り残しが無い（実行して数える） ═══════════════════════════════
test('17(最重要): 削ったあと、制限面より上に建物の頂点が1つも残らない', () => {
  const ctx = makeCtx(basePlan(LOW1));
  // 制限面をまたぐ壁を3枚建てる（それぞれ違う位置・違う高さ）
  run(ctx, '[[0,1000,6000,1000],[0,3000,6000,3000],[0,1000,0,5000]].forEach(function(s,k){' +
    'var g=new THREE.BufferGeometry();var pos=[];' +
    'var y0=0.45,y1=9.0;' +
    'pos.push(s[0]*U,y0,s[1]*U, s[2]*U,y0,s[3]*U, s[2]*U,y1,s[3]*U);' +
    'pos.push(s[0]*U,y0,s[1]*U, s[2]*U,y1,s[3]*U, s[0]*U,y1,s[1]*U);' +
    'g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));' +
    'var m=new THREE.Mesh(g,null); m.userData={b:true}; sc3.add(m);});');
  const before = run(ctx, 'setbackOverhangAudit()');
  assert.ok(before.overVerts > 0, '切る前は面より上に頂点がある: ' + before.overVerts);
  assert.ok(before.tris > 0, '切る前ははみ出しの三角形がある: ' + before.tris);
  const res = run(ctx, 'applySetbackCut()');
  assert.ok(res && res.cut > 0, '削られたメッシュがある');
  const after = run(ctx, 'setbackOverhangAudit()');
  assert.equal(after.overVerts, 0, '削ったあとに面より上の頂点が ' + after.overVerts + ' 個残っている');
  assert.equal(after.tris, 0, '削ったあとにはみ出しの三角形が ' + after.tris + ' 枚残っている');
});

test('17(最重要): 家具（InstancedMesh）は削らない', () => {
  const ctx = makeCtx(basePlan(LOW1));
  run(ctx, 'var g=new THREE.BufferGeometry();' +
    'g.setAttribute("position",new THREE.Float32BufferAttribute([0,9,1, 1,9,1, 0,9.5,1],3));' +
    'var m=new THREE.Mesh(g,null); m.isInstancedMesh=true; m.count=3; m.userData={b:true};' +
    'sc3.add(m); __furn=m; __furnGeo=g;');
  assert.equal(run(ctx, 'isSetbackSubjectMesh(__furn)'), false, '家具は対象外である');
  run(ctx, 'applySetbackCut();');
  assert.equal(run(ctx, '__furn.geometry===__furnGeo'), true, '家具のジオメトリが差し替わった');
  assert.equal(run(ctx, '__furnGeo.disposed'), false, '家具のジオメトリが捨てられた');
});

test('17: 2方向にかかれば2枚の片流れ屋根ができ、向きが90度ちがう', () => {
  const plan = basePlan({ zone: 'low1', road: true, north: true });
  // 敷地の東に幅員4000の道路（rot=90 なので幅方向は平面 x）
  plan.items.push({ type: 'road', id: 'rd', x: 2000, y: -2000, w: 12000, d: 4000, rot: 90 });
  const ctx = makeCtx(plan);
  assert.equal(run(ctx, 'setbackPlanes().length'), 2, '面が2枚');
  const roofs = run(ctx, 'setbackRoofItems()');
  assert.equal(roofs.length, 2, '片流れ屋根が2枚');
  const kinds = plain(roofs.map((r) => r.setbackKind).sort());
  assert.deepEqual(kinds, ['north', 'road']);
  const dr = Math.abs(roofs[0].rot - roofs[1].rot) % 180;
  assert.ok(Math.abs(dr - 90) < 1e-6, '2枚の向きが90度ちがわない: ' + roofs[0].rot + ' / ' + roofs[1].rot);
});

test('17(最重要): 道路斜線の片流れ屋根も「勾配 × 道路の反対側の境界からの距離」に一致する', () => {
  const plan = basePlan({ zone: 'low1', road: true, north: true });
  plan.items.push({ type: 'road', id: 'rd', x: 2000, y: -2000, w: 12000, d: 4000, rot: 90 });
  const ctx = makeCtx(plan);
  const rd = run(ctx, 'setbackPlanes().filter(function(p){return p.kind==="road";})[0]');
  const roof = run(ctx, 'setbackRoofItems().filter(function(r){return r.setbackKind==="road";})[0]');
  assert.ok(rd && roof, '道路斜線の面と片流れ屋根が出ている');
  // 道路の中心は x=8000（rot=90 なので幅方向は平面 x）、幅員 4000。
  // 敷地側の路肩は x=6000、反対側の境界は x=10000。制限 = 1.25 × (10000 − x)。
  // 制限が低いのは道路に近い東側なので、削られるのは建物の東の端である。
  let checked = 0;
  [3700, 4000, 4500, 5000, 5500, 6000].forEach((x) => {
    if (!run(ctx, 'roofCoversPlanPoint(setbackRoofItems().filter(function(r){return r.setbackKind==="road";})[0],' + x + ',2000)')) return;
    checked++;
    const got = run(ctx, 'roofUndersideWorldYAt(setbackRoofItems().filter(function(r){return r.setbackKind==="road";})[0],' + x + ',2000)/U');
    const want = 1.25 * (10000 - x);
    assert.ok(Math.abs(got - want) < 1e-6, 'x=' + x + ' で屋根面 ' + got + ' が制限 ' + want + ' に一致しない');
  });
  assert.ok(checked >= 2, '屋根の下で測れた点が ' + checked + ' 個しかない');
});

test('17(最重要): 宣言した勾配天井の部屋が斜線にも当たるとき、壁には屋根が2枚とも渡る', () => {
  const plan = basePlan(LOW1);
  // 北の部屋に本物の切妻屋根を載せ、そのうえで勾配天井を宣言する
  plan.rooms[0].ceiling = { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 };
  plan.items.push({ type: 'roof', id: 'r2', roofType: 'gable', x: 0, y: 1000, w: 6000, d: 3000,
    rot: 0, floor: 4, elev: 0, pitch: 20, roofThickness: 180 });
  const ctx = makeCtx(plan);
  const p = run(ctx, 'roomCeilingProfile(DATA.rooms[0])');
  assert.equal(p.reason, 'declared', '宣言のほうが理由として立つ');
  assert.equal(p.roof.setbackRoof, undefined, '主たる屋根は本物の屋根である');
  const roofs = run(ctx, 'wallLimitingRoofs(DATA.walls[0])');
  assert.equal(roofs.some((r) => r.setbackRoof === true), true,
    '斜線の片流れ屋根が壁に渡っていない（渡らないと壁が制限面を突き抜ける）');
  assert.equal(roofs.some((r) => !r.setbackRoof), true, '本物の屋根も渡っている');
});

test('17(最重要): 制限面にぴったり載っているだけの面は、はみ出しとして数えない', () => {
  const ctx = makeCtx(basePlan(LOW1));
  // 制限面(5000+1.25y mm)の上に**ちょうど**乗る三角形。切り口や斜線の片流れ屋根が
  // これにあたる。バウンディングボックスの隅は面より上に出るので、メッシュ単位の
  // 判定だけでは落ちない。三角形ごとに見ていないと赤くなる。
  run(ctx, '(function(){var g=new THREE.BufferGeometry();' +
    'var p=[0,6.25,1, 6,6.25,1, 0,8.75,3];' +
    'g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));' +
    'var m=new THREE.Mesh(g,null); m.userData={b:true}; sc3.add(m); __flat=m;})()');
  assert.equal(run(ctx, 'setbackLiveCoefsForMesh(__flat,setbackPlanes().map(setbackPlaneWorldCoef)).length'), 1,
    '前提: バウンディングボックスの隅は面より上に出ている');
  const audit = run(ctx, 'setbackOverhangAudit()');
  assert.equal(audit.tris, 0, '面の上に載っているだけの三角形が ' + audit.tris + ' 枚数えられている');
  assert.equal(audit.overVerts, 0);
});
