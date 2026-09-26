// 2枚の屋根の段差を塞ぐ壁(roofGapInfillRuns / roofGapInfillAppearance)。
// 利用者のプラン32: LDK の西に陸屋根、東に片流れ。境の上に三角形の隙間が開き、
// 室内の天井の段が外から見えた。3D で外壁の面を建てて塞ぐ(利用者の選択)。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

function sliceFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が無い');
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
  throw new Error(name + ' が閉じていない');
}
const covers = (rf, x, y) => x >= rf.x && x <= rf.x + rf.w && y >= rf.y && y <= rf.y + rf.d;
// 片流れ(東): 西の縁 x=5430 で、北(y=4615)が高く南(y=8255)へ下がる。面の高さは線形。
const mono = { id: 'm', type: 'roof', roofType: 'mono', floor: 2, x: 5430, y: 4615, w: 3730, d: 3640, rot: 0, roofThickness: 260 };
const flat = { id: 'f', type: 'roof', roofType: 'flat', floor: 2, x: -60, y: 4610, w: 5490, d: 3645, rot: 0, roofThickness: 260 };
const surface = (rf, x, y) => (rf === mono ? 6.25 - (y - 4615) / 3640 * 2.0 : 4.13);
function ctx(opts) {
  opts = opts || {};
  const c = vm.createContext({
    DATA: { items: opts.items || [mono, flat], walls: opts.walls || [] }, U: 0.001, Math, Number,
    roofCoversPlanPoint: covers,
    roofUndersideWorldYAt: opts.surface || surface,
    roomAtPointOnFloor: opts.noRoom ? () => null : (f, x, y) => (f === 1 && x >= 0 && x <= 9100 && y >= 4550 && y <= 8190 ? { id: 'ldk' } : null),
    wallCoreBoxHitMm: (w, x, y) => Math.abs(x - w.x) <= 60 && y >= w.y1 && y <= w.y2,
    wallTopWorldYAtPointM: (w) => w.top,
    ensureExteriorWallSettings: () => opts.ext || { whole: { linked: false }, floors: { 1: { color: '#F2F0EB', texture: 'plaster_white' } } },
    defaultExteriorFloorSetting: () => ({}),
    WALL_COLORS: { 1: '#5c3820' },
  });
  vm.runInContext(['var ROOF_GAP_SAMPLE_MM=60;', 'var ROOF_GAP_MIN_M=0.03;'].concat(
    ['roofSlabThickM', 'roofSlabTopWorldYAt', 'roofSlabBottomWorldYAt', 'roofFootprintCornersMm', 'roofGapInfillRuns', 'roofGapInfillAppearance']
      .map(sliceFunction)).join('\n'), c);
  return c;
}

test('陸屋根の上に片流れが高く架かる境を、陸屋根の上面から片流れの下面まで塞ぐ', () => {
  const runs = ctx().roofGapInfillRuns(mono);
  assert.equal(runs.length, 1);
  const pts = runs[0].pts;
  pts.forEach((p) => assert.ok(Math.abs(p.x - 5430) < 1e-6, '西の縁に沿っていない ' + p.x));
  assert.ok(Math.abs(pts[0].bottom - 4.39) < 1e-9, '下端は陸屋根の板の上面(据え付け面+厚み)');
  const north = pts.reduce((a, b) => (a.y < b.y ? a : b));
  assert.ok(Math.abs(north.top - (6.25 - 0.26 - (north.y - 4615) / 3640 * 2.0)) < 1e-6, '上端は片流れの板の下面');
  // 片流れが陸屋根より下がる南側では塞がない(隙間が無い)
  pts.forEach((p) => assert.ok(p.top - p.bottom >= 0.03));
  // 端は刻みの手前で止まらず、陸屋根の北の縁(y=4610 の外は屋根が無い)まで詰めてある
  assert.ok(north.y < 4620 + 1, '北の端が刻みの手前で止まっている ' + north.y);
});

test('隣の屋根の方が高ければ塞がない', () => {
  const high = (rf, x, y) => (rf === mono ? 5.0 : 5.5);
  assert.equal(ctx({ surface: high }).roofGapInfillRuns(mono).length, 0);
});

test('下に部屋が無い所(軒先の外など)は塞がない', () => {
  assert.equal(ctx({ noRoom: true }).roofGapInfillRuns(mono).length, 0);
});

test('すでに壁が立っている所は塞がない(二重にしない)', () => {
  const wall = { x: 5460, y1: 4000, y2: 9000, top: 6.3 };
  assert.equal(ctx({ walls: [wall] }).roofGapInfillRuns(mono).length, 0);
});

test('仕上げの既定は下の階の外壁と同じ。屋根に指定すればそれを使う', () => {
  const c = ctx();
  const def = c.roofGapInfillAppearance(mono);
  assert.equal(def.color, '#F2F0EB');
  assert.equal(def.texture, 'plaster_white');
  const own = c.roofGapInfillAppearance(Object.assign({}, mono, { gapInfillColor: '#8a5a3c' }));
  assert.equal(own.color, '#8a5a3c');
  assert.equal(own.texture, null);
  // 家全体の外壁設定が優先中なら、それに従う
  const c2 = ctx({ ext: { whole: { linked: true, color: '#333333', texture: null }, floors: {} } });
  assert.equal(c2.roofGapInfillAppearance(mono).color, '#333333');
});

// 壁の厚みは縁の外側(低い方の屋根の上 = 屋外)へ取る。内側(高い方の屋根の下)へ
// 取ると勾配天井の部屋の中に入り、室内に棚のように張り出した(利用者の報告)。
test('塞ぐ壁の厚みは縁の外(低い方の屋根の上)にあり、高い方の屋根の下(室内側)へ出ない', () => {
  const html = require('./app-source.cjs').appSource();
  const src = (n) => {
    const at = html.indexOf('\nfunction ' + n + '(');
    assert.notEqual(at, -1, n);
    let i = html.indexOf('{', at), depth = 0;
    for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
    return html.slice(at + 1, i + 1);
  };
  const constLine = html.match(/\nvar ROOF_GAP_WALL_THICK_M=[^;]*;/)[0];
  const built = [];
  function Geo() { this.attributes = {}; }
  Geo.prototype.setAttribute = function (k, a) { this.attributes[k] = a; };
  Geo.prototype.setIndex = function () {}; Geo.prototype.computeVertexNormals = function () {};
  const c = vm.createContext({
    Math, U: 0.001,
    DATA: { items: [mono] },
    THREE: { BufferGeometry: Geo, Float32BufferAttribute: function (a) { this.array = a; },
      Mesh: function (g) { this.geometry = g; this.userData = {}; } },
    shouldRenderItemInCurrent3DView: () => true,
    roofGapInfillRuns: () => [{ nx: 1, ny: 0, pts: [{ x: 5430, y: 5000, bottom: 4.39, top: 5.8 }, { x: 5430, y: 7000, bottom: 4.39, top: 4.8 }] }],
    roofGapInfillAppearance: () => ({ color: '#fff' }),
    texTileM: () => 1, wallTextureTileHeight: () => 1,
    makeRoofGapInfillMaterial: () => ({}), mark3DSelectable: () => {},
    sc3: { add: (m) => built.push(m) },
  });
  vm.runInContext(constLine + '\n' + src('build3DRoofGapInfills'), c);
  c.build3DRoofGapInfills();
  assert.equal(built.length, 1);
  const pos = built[0].geometry.attributes.position.array;
  const xs = []; for (let i = 0; i < pos.length; i += 3) xs.push(pos[i] * 1000);
  // 屋根の内側向きは +x(縁 x=5430 の東が高い方の屋根)。壁はすべて縁より西にある。
  assert.ok(Math.max(...xs) <= 5430 - 5, '壁が高い方の屋根の下(室内側)へ出ている: ' + Math.max(...xs));
  assert.ok(Math.min(...xs) <= 5430 - 100, '厚みが取れていない: ' + Math.min(...xs));
});
