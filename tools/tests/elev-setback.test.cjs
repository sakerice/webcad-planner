// Task 24: 立面図が「削られた実際の形」を描き、斜線制限そのものを引く。
//
// grep ではない。index.html から関数と JISDRAW の即時実行関数を波括弧の対応で
// 切り出し、node:vm で **走らせて** 出来た立面図 SVG の座標を読む。
//
// 確かめること:
//   24-0 斜線も勾配天井も無いプランの立面図 SVG は1バイトも変わらない。
//   24-1 壁の上端は 3D と同じ折れ線(wallTopProfileM)で描かれる。屋根も、
//        斜線で削られた形＋斜線由来の片流れ屋根が出る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

// ── index.html からの切り出し(plan-setback.test.cjs と同じ数え方) ────────────
function balanced(startAt) {
  let i = html.indexOf('{', startAt);
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
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('閉じ括弧が見つからない @' + startAt);
}
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  return html.slice(at + 1, balanced(at + 1) + 1);
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}
function topLevelObjectVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=\\s*\\{'));
  assert.notEqual(m, null, 'var ' + name + ' = { … } が index.html に無い');
  return html.slice(m.index + 1, balanced(m.index) + 1) + ';';
}
function jisdrawIife() {
  const at = html.indexOf('\nvar JISDRAW=(function(){');
  assert.notEqual(at, -1, 'var JISDRAW=(function(){ が index.html に無い');
  const end = balanced(at);
  assert.equal(html.slice(end, end + 5), '})();', 'JISDRAW の閉じ方が変わっている');
  return html.slice(at + 1, end + 5);
}

const BASE_VARS = ['FMP_ITEMS', 'U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H',
  'COMPASS_8_JA', 'COMPASS_8_CODE', 'ELEV_DIR_SCREEN_DEG'];
const BASE_OBJ_VARS = ['LEGACY_FMP_TYPE_MAP'];
const BASE_FNS = [
  'bestFmpType', 'getFmpItem',
  'isDoorLikeOpeningType', 'isWindowLikeType', 'isOpeningItemType',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber', 'wallHeightMm', 'wallDisplayHeightM',
  'getObjBounds', 'isFiniteCanvasValue',
  'roomAtPointOnFloor',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg',
  'compassSector', 'compassNameJa', 'compassCode',
  'planDirBearingDeg', 'elevationDirNameJa', 'elevationSheetLabel', 'elevationDirCode',
  'roofLocalToWorldMm'
];

// 斜線制限まわり(plan-setback.test.cjs と同じ顔ぶれ)。
const SETBACK_VARS = ['SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M',
  'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX',
  'SETBACK_CUT_SAMPLES', 'SETBACK_ROOF_MAX_RECTS',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_setbackRoofCache', '_setbackRoofCacheKey'];
const SETBACK_FNS = [
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt',
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane', 'setbackDistanceMm', 'setbackLimitHeightMmAt',
  'setbackPointAt', 'setbackPlanes',
  'setbackBuildingPlanBoundsMm', 'setbackBuildingTopWorldYAt', 'setbackCutSpanMm',
  'setbackRoofTemplateItem', 'setbackRoofItemForPlane', 'setbackRoofItems',
  'setbackRoofsOverRoom', 'setbackRoofsForRoom'
];
// 壁の上端の折れ線(3D と共通の経路)。
const TOP_VARS = ['CEILING_SAMPLE_STEP_M', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  '_ceilingClampWarned', 'WALL_EXT_FACE_GAP_M', 'WALL_INT_FACE_GAP_M', 'WALL_FACE_JITTER_M',
  'WALL_TOP_SAMPLE_STEP_M'];
const TOP_FNS = [
  'roomDeclaresSlopedCeiling', 'roofItemOverRoom', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm',
  'wallTouchesSlopedCeiling',
  'roofTopLimitAtPlanPoint', 'wallRoofTopLimitWorldY', 'wallLimitingRoofs', 'wallTopHeightAtM',
  'wallFaceJitterStep', 'wallFaceJitterM', 'wallExteriorFaceOffsetM', 'wallInteriorFaceOffsetM'
];
// Task 24 で足した関数。**これだけが無い世界** = 変更前のコードである。
const NEW_FNS = ['wallTopCutEnv', 'wallTopProfileSimplify', 'wallTopProfileM'];

function makeCtx(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String, Boolean, parseInt, parseFloat, Date,
    SetbackLaw: Law, HeightModel,
    DATA: data,
    ST: { showDim: true, selected: null, floor: 1 },
    LIGHT_SETTINGS: { northDeg: 0, hour: 13, season: 'equinox', sunSim: false },
    // 試験の家はどれも箱の外周なので、壁はすべて外皮に面している。
    getWallExteriorSpans: () => [{ a: 0, b: 1e9, sign: 1 }],
    getOpeningWallInfo: () => null,
    isDoorItemType: () => false,
    escHtml: (s) => String(s)
  });
  vm.runInContext(
    BASE_OBJ_VARS.map(topLevelObjectVar).concat(BASE_VARS.map(topLevelVar))
      .concat(BASE_FNS.map(topLevelFunction)).join('\n'),
    ctx
  );
  return ctx;
}
function withSetback(ctx) {
  vm.runInContext(SETBACK_VARS.map(topLevelVar).concat(SETBACK_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function withWallTop(ctx, withNew) {
  const fns = withNew === false ? TOP_FNS : TOP_FNS.concat(NEW_FNS);
  vm.runInContext(TOP_VARS.map(topLevelVar).concat(fns.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function withDrawing(ctx) { vm.runInContext(jisdrawIife(), ctx); return ctx; }
function full(data) { return withDrawing(withWallTop(withSetback(makeCtx(data)))); }
// 変更前の世界: 壁の折れ線も斜線制限も存在しない(=どちらの新しい枝にも入れない)。
function before(data) { return withDrawing(withWallTop(makeCtx(data), false)); }
function run(ctx, src) { return vm.runInContext(src, ctx); }
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ── 試験用の家 ────────────────────────────────────────────────────────
// 箱1つ。壁は外周4枚 × 階数。
function box(floor, x0, y0, x1, y1) {
  return [
    { id: 'w' + floor + 'n', floor: floor, x1: x0, y1: y0, x2: x1, y2: y0, thick: 120 },
    { id: 'w' + floor + 'e', floor: floor, x1: x1, y1: y0, x2: x1, y2: y1, thick: 120 },
    { id: 'w' + floor + 's', floor: floor, x1: x1, y1: y1, x2: x0, y2: y1, thick: 120 },
    { id: 'w' + floor + 'w', floor: floor, x1: x0, y1: y1, x2: x0, y2: y0, thick: 120 }
  ];
}
// 2階建て＋切妻屋根。棟は東西(x方向)に走り、y=3000 で折り返す。
// ceiling を渡すと2階の部屋が勾配天井を宣言する。
function gableHouse(ceiling) {
  const walls = [], rooms = [];
  [1, 2].forEach((f) => {
    box(f, 0, 1000, 6000, 5000).forEach((w) => walls.push(w));
    rooms.push({ id: 'r' + f, n: f + '階', floor: f, x: 0, y: 1000, w: 6000, d: 4000 });
  });
  if (ceiling) rooms[1].ceiling = ceiling;
  return {
    walls, rooms, floors: {},
    items: [{ id: 'roof1', type: 'roof', roofType: 'gable', x: -500, y: 500, w: 7000, d: 5000,
      rot: 0, floor: 3, elev: 0, pitch: 35, roofThickness: 180 }]
  };
}
// 3階建て＋陸屋根。敷地 x:-1000..7000 / y:0..7000。北側境界線は y=0。
// road を立てると東側(敷地側の路肩 x=7000、幅員3000 → 反対側境界 x=10000)に道路。
function setbackHouse(cfg, road) {
  const walls = [], rooms = [];
  [1, 2, 3].forEach((f) => {
    box(f, 0, 1000, 6000, 5000).forEach((w) => walls.push(w));
    rooms.push({ id: 'r' + f, n: f + '階', floor: f, x: 0, y: 1000, w: 6000, d: 4000 });
  });
  const site = { id: 'site', type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  if (cfg) site.setback = JSON.parse(JSON.stringify(cfg));
  const items = [site,
    { id: 'roof1', type: 'roof', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
      rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }];
  if (road) items.push({ id: 'road1', type: 'road', x: 4500, y: 2000, w: 8000, d: 3000, rot: 90 });
  return { walls, rooms, floors: {}, items };
}
const NORTH_ONLY = { zone: 'low1', road: false, north: true };
const BOTH = { zone: 'low1', road: true, north: true };
const SLOPED = { type: 'sloped', lowMm: 2200, highMm: 3900, direction: 0 };

const OPTS = '{scale:"100",paper:"a3"}';
function elev(ctx, dir, opts) {
  return run(ctx, 'JISDRAW.buildElevationSvg("' + dir + '",' + (opts || OPTS) + ')');
}
// 図面本体(反転グループの中)。座標は (u, 高さmm、上向き正)。
// 方位記号(Task 19)はグループの外にあるので、ここで自然に落ちる。
function bodyOf(svg) {
  const at = svg.indexOf('<g transform="scale(1,-1)">');
  assert.notEqual(at, -1, '反転グループが無い');
  const end = svg.lastIndexOf('</g>');
  return svg.slice(at, end);
}
// 太線の閉じた輪郭(壁のスカイライン・屋根)。
function thickPolys(svg, lw) {
  const out = [];
  const re = new RegExp('<polygon points="([^"]+)" fill="none" stroke="#000" stroke-width="' + lw + '"\\/>', 'g');
  let m;
  while ((m = re.exec(bodyOf(svg)))) {
    out.push(m[1].trim().split(' ').map((p) => p.split(',').map(Number)));
  }
  return out;
}
// 一点鎖線(4値の dasharray)。太さで斜線本体(mid)と起点の線(thin)を見分ける。
function chainLines(svg) {
  const out = [];
  const re = /<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)" stroke="#000" stroke-width="([-\d.e]+)" stroke-dasharray="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(bodyOf(svg)))) {
    if (m[6].split(' ').length !== 4) continue;
    out.push({ u1: +m[1], h1: +m[2], u2: +m[3], h2: +m[4], w: +m[5] });
  }
  return out;
}
function texts(svg) {
  const out = [];
  const re = /<text[^>]*>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(bodyOf(svg)))) out.push(m[1]);
  return out;
}
const DIRS = ['e', 'w', 's', 'n'];

// ══ 24-0 何も設定していないプランは1バイトも変わらない ═══════════════════

test('24-0(最重要): 斜線も勾配天井も無いプランの立面図は1バイトも変わらない', () => {
  // 変更前のコード = 「壁の折れ線」も「斜線制限」も存在しない世界。新しい呼び出しは
  // そこで必ず従来の枝/空文字列へ倒れるので、両者が一致すれば1バイトも増えていない。
  const old = before(gableHouse(null));
  const after = full(gableHouse(null));
  DIRS.forEach((d) => {
    ['"50"', '"100"', '"200"', '"auto"'].forEach((s) => {
      ['"a3"', '"a4"'].forEach((p) => {
        const o = '{scale:' + s + ',paper:' + p + '}';
        assert.equal(elev(after, d, o), elev(old, d, o), d + ' ' + s + ' ' + p + ' が変わった');
      });
    });
  });
  const svg = elev(after, 'e');
  assert.equal(chainLines(svg).length, 0, '一点鎖線が出ている');
  assert.equal(/斜線/.test(svg), false, '斜線の注記が出ている');
  assert.equal(/<g[^>]*>\s*<\/g>|<g\s*\/>/.test(svg), false, '空のグループが増えている');
});

test('24-0: 敷地はあるが用途地域の設定が無いプランでも、立面図に斜線は出ない', () => {
  const ctx = full(setbackHouse({ zone: 'low1', road: false, north: false }, false));
  assert.deepEqual(plain(run(ctx, 'setbackPlanes()')), [], '面が1枚も作られない');
  DIRS.forEach((d) => {
    assert.equal(chainLines(elev(ctx, d)).length, 0, d + ' に一点鎖線が出ている');
  });
});

// ══ 24-1 壁の上端は 3D と同じ折れ線 ═══════════════════════════════════

test('24-1(最重要): 削られていない壁は null、勾配天井に接する壁は折れ線を返す', () => {
  const flat = full(gableHouse(null));
  const wFlat = 'DATA.walls.filter(function(w){return w.floor===2&&w.x1===0&&w.x2===0;})[0]';
  assert.equal(run(flat, 'wallTopProfileM(' + wFlat + ')'), null,
    '勾配を宣言していない家の壁は従来のまっすぐな上辺のまま');
  const sloped = full(gableHouse(SLOPED));
  const prof = plain(run(sloped, 'wallTopProfileM(' + wFlat + ')'));
  assert.ok(prof && prof.length >= 3, '折れ線が返る: ' + JSON.stringify(prof));
  assert.equal(prof[0][0], 0, 't は 0 から');
  assert.equal(prof[prof.length - 1][0], 1, 't は 1 まで');
  const hs = prof.map((p) => p[1]);
  assert.ok(Math.max.apply(null, hs) - Math.min.apply(null, hs) > 1.0,
    '棟に向かって1m以上上がっている: ' + JSON.stringify(hs));
  // 斜線の面に接していても、そこが**実際には削られていない**壁は折れ線にしない
  // (点列を持たせると、形は同じまま図面の点だけが増える)。
  const sb = full(setbackHouse(NORTH_ONLY, false));
  const south = 'DATA.walls.filter(function(w){return w.floor===3&&w.y1===5000&&w.y2===5000;})[0]';
  const north = 'DATA.walls.filter(function(w){return w.floor===3&&w.y1===1000&&w.y2===1000;})[0]';
  assert.ok(run(sb, 'wallTouchesSlopedCeiling(' + south + ')'), '南の壁も斜線の部屋に接してはいる');
  assert.equal(run(sb, 'wallTopProfileM(' + south + ')'), null,
    '境界から遠く、制限に当たっていない壁は従来のまっすぐな上辺のまま');
  assert.ok(plain(run(sb, 'wallTopProfileM(' + north + ')')), '境界に近い壁は削られている');
});

test('24-1(最重要): 立面図の壁の上端が、3D と同じ高さ(wallTopHeightAtM)に一致する', () => {
  const ctx = full(gableHouse(SLOPED));
  const svg = elev(ctx, 'e');
  const lw = run(ctx, 'JISDRAW.lineWidths(100).thick');
  const polys = thickPolys(svg, lw);
  assert.ok(polys.length >= 1, '輪郭が描かれている');
  const wall = polys[0];
  // 東立面図の u = -y。壁(x=0, y:5000→1000)の t は u から一意に決まる。
  const w = 'DATA.walls.filter(function(x){return x.floor===2&&x.x1===0&&x.x2===0;})[0]';
  const baseM = run(ctx, 'floorBaseY(2)');
  const fullH = run(ctx, 'wallDisplayHeightM(' + w + ')');
  const y1 = run(ctx, w + '.y1'), y2 = run(ctx, w + '.y2');
  // 上端の点だけを拾う(下端は base=0 まで降りている)
  const tops = wall.filter((p) => p[1] > 1000);
  assert.ok(tops.length >= 3, '上端が1本の水平線ではない: ' + JSON.stringify(wall));
  let checked = 0;
  tops.forEach((p) => {
    const yMm = -p[0];                       // u = -y
    const t = (yMm - y1) / (y2 - y1);
    if (t < 0.02 || t > 0.98) return;        // 端は折れ線の丸めが乗るので中だけ見る
    const env = 'wallTopCutEnv(' + w + ')';
    const h = run(ctx, 'wallTopHeightAtM(' + w + ',' + t + ',' + fullH + ',' + env + '.minH,' + env + '.roofs)');
    const expected = (baseM + Math.min(h, fullH)) / run(ctx, 'U');
    assert.ok(Math.abs(expected - p[1]) < 2,
      't=' + t + ' で図面 ' + p[1] + ' / 3D ' + expected);
    checked++;
  });
  assert.ok(checked >= 1, '中間の点を1つ以上照合した');
});

test('24-1(最重要): 斜線で削られた階の壁が、立面図で斜めに切れる(勾配は制限の勾配)', () => {
  const ctx = full(setbackHouse(NORTH_ONLY, false));
  const lw = run(ctx, 'JISDRAW.lineWidths(100).thick');
  const wall = thickPolys(elev(ctx, 'e'), lw)[0];
  // 上端のうち、隣り合う2点で高さが変わる区間の勾配を測る。
  let found = null;
  for (let i = 1; i < wall.length; i++) {
    const a = wall[i - 1], b = wall[i];
    if (Math.abs(b[1] - a[1]) < 100 || Math.abs(b[0] - a[0]) < 100) continue;
    if (a[1] < 1000 || b[1] < 1000) continue;
    found = Math.abs((b[1] - a[1]) / (b[0] - a[0]));
    break;
  }
  assert.ok(found !== null, '斜めの区間が無い(長方形のまま): ' + JSON.stringify(wall));
  assert.ok(Math.abs(found - 1.25) < 0.02, '勾配が北側斜線の 1.25 と一致する: ' + found);
});

test('24-1: 斜線由来の片流れ屋根が、立面図にも出る(3D に建っている屋根と同じ)', () => {
  const off = full(setbackHouse(null, false));
  const on = full(setbackHouse(NORTH_ONLY, false));
  const lw = run(on, 'JISDRAW.lineWidths(100).thick');
  const nRoof = plain(run(on, 'setbackRoofItems()')).length;
  assert.equal(nRoof, 1, '3D に斜線由来の屋根が1枚建っている');
  assert.equal(thickPolys(elev(on, 'e'), lw).length,
    thickPolys(elev(off, 'e'), lw).length + nRoof,
    '立面図の輪郭がその枚数ぶん増えている');
});

test('24-1(最重要): 既存の屋根は、制限面より上には描かれない(3D は切っている)', () => {
  const ctx = full(setbackHouse(NORTH_ONLY, false));
  const lw = run(ctx, 'JISDRAW.lineWidths(100).thick');
  const pl = plain(run(ctx, 'setbackPlanes()'))[0];
  // 東立面図の u = -y。北側斜線の面は n=(0,1)・d0=0 なので t=-u、制限高さ=5000+1.25*(-u)。
  const limitAt = (u) => pl.baseMm + pl.slope * (-u - pl.d0);
  const uncut = thickPolys(elev(before(setbackHouse(NORTH_ONLY, false)), 'e'), lw);
  let over = 0;
  uncut.forEach((poly) => poly.forEach((p) => { if (p[1] > limitAt(p[0]) + 1) over++; }));
  assert.ok(over > 0, '切る前は制限より上に点があった(比較が空振りしていない)');
  thickPolys(elev(ctx, 'e'), lw).forEach((poly) => {
    poly.forEach((p) => {
      assert.ok(p[1] <= limitAt(p[0]) + 1,
        '制限 ' + Math.round(limitAt(p[0])) + ' に対し ' + p[1] + ' が出ている');
    });
  });
});
