// Task 23 / Task 25-1: 斜線制限を JIS 平面図に出す。**出すのは境界線だけ**。
//
// grep ではない。index.html から関数と JISDRAW の即時実行関数を波括弧の対応で
// 切り出し、node:vm で **走らせて** 出来た SVG の座標・線種・文字を読む。
//
// 確かめること:
//   23-1 斜線制限を設定していないプランでは、平面図の SVG が1バイトも変わらない。
//   23-2 制限そのもの = 斜線が立ち上がる境界線が、正しい位置に一点鎖線で出る。
//   25-1 削られた結果(屋根伏せの階段状の破線・勾配の矢印・勾配の注記)は
//        **平面図には出さない**。斜線制限そのものは立面図が示す(Task 24)ので、
//        平面図の役目は「どこから斜線が立ち上がるか」だけである。
//   23-4 2方向(道路＋北側)にかかる場合は境界線が両方出る。
//   23-5 読める図面であること: 用紙に乗らない境界線は引かない、注記は枠内。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

// ── index.html からの切り出し(plan-north.test.cjs と同じ数え方) ────────────
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

const DRAW_FNS = [
  'bestFmpType', 'getFmpItem',
  'isDoorLikeOpeningType', 'isWindowLikeType', 'isOpeningItemType',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber', 'wallDisplayHeightM',
  'getObjBounds', 'isFiniteCanvasValue',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg'
];
const DRAW_VARS = ['FMP_ITEMS', 'U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H'];
const DRAW_OBJ_VARS = ['LEGACY_FMP_TYPE_MAP'];

// 斜線制限まわり(setback-cut.test.cjs と同じ顔ぶれのうち、平面図が触るぶん)。
const SETBACK_VARS = ['SETBACK_PLANE_MARGIN_MM', 'SETBACK_CUT_EPS_M',
  'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX',
  'SETBACK_VALLEY_LAP_MM', 'SETBACK_CUT_SAMPLES', 'SETBACK_ROOF_MAX_RECTS',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_setbackRoofCache', '_setbackRoofCacheKey'];
const SETBACK_FNS = [
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'setbackClipsCoverPlan', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt',
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane', 'setbackDistanceMm', 'setbackLimitHeightMmAt',
  'setbackPointAt', 'setbackPlanes',
  'setbackBuildingPlanBoundsMm', 'setbackBuildingTopWorldYAt', 'setbackCutSpanMm',
  'setbackRoofTemplateItem', 'setbackPlaneKeyOf', 'setbackBindingClipPlan', 'setbackBindingClipsPlan', 'setbackRoofItemForPlane', 'setbackRoofItems'
];

function makeCtx(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String, Boolean, parseInt, parseFloat, Date,
    SetbackLaw: Law, HeightModel,
    DATA: data,
    ST: { showDim: true, selected: null, floor: 1 },
    LIGHT_SETTINGS: { northDeg: 0, hour: 13, season: 'equinox', sunSim: false },
    roomAtPointOnFloor: () => null,
    getOpeningWallInfo: () => null,
    isDoorItemType: () => false,
    escHtml: (s) => String(s)
  });
  vm.runInContext(
    DRAW_OBJ_VARS.map(topLevelObjectVar).concat(DRAW_VARS.map(topLevelVar))
      .concat(DRAW_FNS.map(topLevelFunction)).join('\n'),
    ctx
  );
  return ctx;
}
function withSetback(ctx) {
  vm.runInContext(SETBACK_VARS.map(topLevelVar).concat(SETBACK_FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function withDrawing(ctx) { vm.runInContext(jisdrawIife(), ctx); return ctx; }
function run(ctx, src) { return vm.runInContext(src, ctx); }
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// ── 試験用プラン ──────────────────────────────────────────────────────
// 敷地は y=0 が北側境界(x:-1000..7000, y:0..7000)。建物は x:0..6000, y:1000..5000 の
// 3階建て(階高2700・基礎450 → 3階の天端 8550mm)。
// 北側斜線(5000 + 1.25d)が 8550 になるのは y=2840。つまり y<2840 の側だけが削られる。
// 道路は南側 y:5500..8500(幅員3000)。反対側の境界は y=8500 で、
// 道路斜線(1.25 × (8500-y))が 8550 になるのは y=1660。つまり y>1660 の側が削られる。
const OPTS = '{scale:"100",paper:"a3"}';
function basePlan(setback, opts) {
  const o = opts || {};
  const site = { id: 'site', type: 'site-rect', x: -1000, y: 0, w: 8000, d: 7000, rot: 0 };
  // 素材は毎回作り直す(テストが setback を書き換えるので、共有すると隣へ漏れる)。
  if (setback) site.setback = JSON.parse(JSON.stringify(setback));
  const items = [site,
    { id: 'roof1', type: 'roof', roofType: 'flat', x: 0, y: 1000, w: 6000, d: 4000,
      rot: 0, floor: 4, elev: 0, pitch: 30, roofThickness: 180 }];
  if (o.road) {
    items.push({ id: 'road1', type: 'road', x: -1000, y: o.roadY, w: 8000, d: 3000, rot: 0 });
  }
  const rooms = [], walls = [];
  [1, 2, 3].forEach((f) => {
    rooms.push({ id: 'r' + f, n: f + '階', floor: f, x: 0, y: 1000, w: 6000, d: 4000 });
    walls.push({ id: 'wn' + f, floor: f, x1: 0, y1: 1000, x2: 6000, y2: 1000, thick: 120 });
    walls.push({ id: 'we' + f, floor: f, x1: 6000, y1: 1000, x2: 6000, y2: 5000, thick: 120 });
    walls.push({ id: 'ws' + f, floor: f, x1: 6000, y1: 5000, x2: 0, y2: 5000, thick: 120 });
    walls.push({ id: 'ww' + f, floor: f, x1: 0, y1: 5000, x2: 0, y2: 1000, thick: 120 });
  });
  return { items, rooms, walls, floorMetadata: {} };
}
const NORTH_ONLY = { zone: 'low1', road: false, north: true };
const BOTH = { zone: 'low1', road: true, north: true };
// 条文から独立に解いた制限高さ(index.html の式は写していない)
function northLimitMm(yMm) { return 5000 + 1.25 * yMm; }
function roadLimitMm(yMm, farY) { return 1.25 * (farY - yMm); }

function planSvg(ctx, floor) {
  return run(ctx, 'JISDRAW.buildFloorPlanSvg(' + (floor || 3) + ',' + OPTS + ')');
}
function viewBox(svg) {
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
  assert.ok(m, 'viewBox が無い');
  const x = Number(m[1]), y = Number(m[2]), w = Number(m[3]), h = Number(m[4]);
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}
// 方位記号(右上の円+針)は図面本体のいちばん後ろに付く。針も「塗りつぶし三角」なので、
// 勾配の矢じりと混ざらないよう、記号から後ろを落としてから読む
// (plan-north.test.cjs の splitNorthMark と同じ切り方)。
function body(svg) {
  const at = svg.indexOf('>N</text>');
  assert.notEqual(at, -1, '方位記号の N が見つからない');
  return svg.slice(0, svg.lastIndexOf('<text', at));
}
// 一点鎖線(境界線)の <line>。dasharray が4値のものだけを拾う。
function chainLines(svg) {
  const out = [];
  const re = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#000" stroke-width="([-\d.]+)" stroke-dasharray="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(svg))) {
    const dash = m[6].split(' ');
    if (dash.length !== 4) continue;
    out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], dash: m[6] });
  }
  return out;
}
// 破線の <line>。dasharray が2値のものだけを拾う。Task 25-1 より後は
// **1本も出てはいけない**(屋根伏せの階段状の破線を平面図から外したため)。
function roofDashLines(svg) {
  const out = [];
  const re = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#000" stroke-width="([-\d.]+)" stroke-dasharray="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[6].split(' ').length !== 2) continue;
    out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5] });
  }
  return out;
}
// 矢じり(塗りつぶし三角、stroke 無し)。壁の黒塗りは stroke を持つので混ざらない。
function arrowHeads(svgAll) {
  const svg = body(svgAll);
  const out = [];
  const re = /<polygon points="([^"]+)" fill="#000"\/>/g;
  let m;
  while ((m = re.exec(svg))) {
    const pts = m[1].trim().split(' ').map((p) => {
      const v = p.split(',');
      return { x: +v[0], y: +v[1] };
    });
    if (pts.length !== 3) continue;
    out.push({ tip: pts[0], base: { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } });
  }
  return out;
}
function texts(svg) {
  const out = [];
  const re = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) out.push({ x: +m[1], y: +m[2], s: m[3] });
  return out;
}
// ══ 23-1 既定は「何も出ない」 ═════════════════════════════════════════

test('23-1(最重要): 斜線制限を設定していないプランの平面図は1バイトも変わらない', () => {
  // 変更前のコード = 斜線制限の関数が1つも存在しない世界。新しく足した呼び出しは
  // そこで必ず空文字列に倒れるので、両者が完全一致すれば「1バイトも増えていない」。
  const before = withDrawing(makeCtx(basePlan(null)));
  const after = withDrawing(withSetback(makeCtx(basePlan(null))));
  const a = planSvg(before, 3), b = planSvg(after, 3);
  assert.equal(b, a, '斜線制限の関数がある/ないで平面図が変わってはいけない');
  // 念のため、新しい線種・注記が1つも混ざっていないこと。
  assert.equal(chainLines(a).length, 0, '一点鎖線が出ている');
  assert.equal(roofDashLines(a).length, 0, '破線が出ている');
  assert.equal(/境界線|勾配/.test(a), false, '斜線の注記が出ている: ' + a.slice(0, 200));
  // 中身の無いタグ(空のグループ等)も1つも増えていない。文字列が一致していても、
  // 「関数がある/ない」の両方で同じ空タグを出していれば一致してしまうため。
  assert.equal(/<g[^>]*>\s*<\/g>|<g\s*\/>/.test(a), false, '空のグループが増えている');
  [1, 2].forEach((f) => {
    assert.equal(planSvg(after, f), planSvg(before, f), f + 'F も1バイトも変わらない');
  });
});

test('23-1: 敷地はあるが用途地域の設定が無いプランでも何も出ない', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan({ zone: 'low1', road: false, north: false }))));
  assert.deepEqual(plain(run(ctx, 'setbackPlanes()')), [], '面が1枚も作られない');
  assert.equal(chainLines(planSvg(ctx, 3)).length, 0);
  assert.equal(roofDashLines(planSvg(ctx, 3)).length, 0);
});

// ══ 23-2 制限そのもの = 境界線 ════════════════════════════════════════

test('23-2(最重要): 北側斜線を設定すると、北側境界線が正しい位置に一点鎖線で出る', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  const svg = planSvg(ctx, 3);
  const cl = chainLines(svg);
  assert.equal(cl.length, 1, '境界線は1本: ' + JSON.stringify(cl));
  // 敷地の北側の辺は y=0(この敷地は y:0..7000)。線はそこを通る水平線である。
  assert.equal(cl[0].y1, 0, '北側境界線は y=0 を通る');
  assert.equal(cl[0].y2, 0);
  assert.notEqual(cl[0].x1, cl[0].x2, '線に長さがある');
  // 線の太さは lineWidths(scale).thin(細線)。縮尺100なら 0.13*100=13。
  assert.equal(cl[0].w, run(ctx, 'JISDRAW.lineWidths(100).thin'), '境界線は細線');
  // 「この線から斜線がかかる」ことが読める注記。基準高さと勾配は条文の値。
  const label = texts(svg).filter((t) => /北側境界線/.test(t.s));
  assert.equal(label.length, 1, '注記が1つ: ' + JSON.stringify(texts(svg).map((t) => t.s)));
  assert.ok(/5000/.test(label[0].s), '基準高さが書いてある: ' + label[0].s);
  assert.ok(/1\.25/.test(label[0].s), '勾配が書いてある: ' + label[0].s);
});

test('23-2(最重要): 境界線は面が動けば一緒に動く(方位を回すと線も回る)', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  const before = chainLines(planSvg(ctx, 3))[0];
  assert.equal(before.y1, 0);
  run(ctx, 'setPlanNorthDeg(90)');
  const after = chainLines(planSvg(ctx, 3))[0];
  // 真北が東を向いたので、北側境界線は敷地の東の辺(x=7000)を通る縦線になる。
  assert.ok(Math.abs(after.x1 - 7000) < 1e-6, '境界線が敷地の東辺へ移った: ' + after.x1);
  assert.ok(Math.abs(after.x2 - 7000) < 1e-6, after.x2);
  assert.notEqual(after.y1, after.y2, '縦線になっている');
  run(ctx, 'setPlanNorthDeg(0)');
  assert.equal(chainLines(planSvg(ctx, 3))[0].y1, 0, '0度へ戻すと元へ戻る');
});

test('23-2: 境界線は敷地境界の線種(一点鎖線)で引かれる', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  const svg = planSvg(ctx, 3);
  const chain = chainLines(svg)[0].dash.split(' ').map(Number);
  assert.equal(chain.length, 4, '境界線は長線・間・点・間の4値 = 一点鎖線');
  assert.ok(chain[0] > chain[2], '長線のほうが点より長い: ' + chain.join(' '));
});

// ══ 25-1 削られた結果は平面図に描かない ══════════════════════════════
// Task 23 では、切り口に架かる屋根の伏せ(階段状の破線)・勾配の矢印・勾配の注記も
// 平面図に出していた。Task 25-1 でそれをやめた。**消えたことを実行して確かめる**。
// 「そもそも削られていないから出ない」で受かってしまわないよう、どの試験でも
// 先に setbackRoofItems() で「3D には屋根が架かっている」ことを確かめてから見る。

// 平面図から、境界線(一点鎖線)とその注記だけを取り除いた文字列。
// これが「斜線を設定していない平面図」と一致すれば、平面図に足されたのは
// 境界線とその注記**だけ**である。
function withoutLimitLines(svg) {
  return svg
    .replace(/<line [^>]*stroke-dasharray="[\d.]+ [\d.]+ [\d.]+ [\d.]+"\/>/g, '')
    .replace(/<text [^>]*>[^<]*境界線[^<]*<\/text>/g, '');
}

test('25-1(最重要): 削られているプランでも、屋根の輪郭・勾配の矢印・勾配の注記が1つも出ない', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  // 空振りしていないことの確認: 3D には切り口の屋根が1枚架かっている。
  assert.equal(plain(run(ctx, 'setbackRoofItems()')).length, 1,
    '削られていないプランで試している(試験が空振りする)');
  const svg = planSvg(ctx, 3);
  assert.equal(roofDashLines(svg).length, 0,
    '屋根伏せの破線が出ている: ' + JSON.stringify(roofDashLines(svg)));
  assert.equal(arrowHeads(svg).length, 0,
    '勾配の矢印が出ている: ' + JSON.stringify(arrowHeads(svg)));
  const sun = texts(svg).filter((t) => /寸|勾配/.test(t.s) && !/境界線/.test(t.s));
  assert.deepEqual(sun, [], '勾配の注記が出ている: ' + JSON.stringify(sun));
  // 残すものは残っている。
  assert.equal(chainLines(svg).length, 1, '境界線が消えている');
  const label = texts(svg).filter((t) => /北側境界線/.test(t.s));
  assert.equal(label.length, 1, '境界線の注記が消えている: ' + JSON.stringify(texts(svg).map((t) => t.s)));
  assert.ok(/5000/.test(label[0].s) && /1\.25/.test(label[0].s),
    '基準高さと勾配が注記から消えている: ' + label[0].s);
});

test('25-1(最重要): 平面図に足されるのは境界線とその注記だけ(他の要素は1つも増えない)', () => {
  const off = withDrawing(withSetback(makeCtx(basePlan(null))));
  const on = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  assert.equal(plain(run(on, 'setbackRoofItems()')).length, 1, '削られているプランで比べている');
  [1, 2, 3].forEach((f) => {
    assert.equal(withoutLimitLines(planSvg(on, f)), planSvg(off, f),
      f + 'F: 境界線と注記のほかにも何かが足されている');
  });
});

test('25-1(最重要): 2方向にかかる場合も、屋根の輪郭も矢印も出ない(境界線は2本出る)', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(BOTH, { road: true, roadY: 5500 }))));
  assert.equal(plain(run(ctx, 'setbackRoofItems()')).length, 2, '3D には屋根が2枚架かっている');
  const svg = planSvg(ctx, 3);
  assert.equal(roofDashLines(svg).length, 0, '屋根伏せの破線が出ている');
  assert.equal(arrowHeads(svg).length, 0, '勾配の矢印が出ている');
  assert.equal(chainLines(svg).length, 2, '境界線が2本出ていない');
  const labels = texts(svg).map((t) => t.s);
  assert.ok(labels.some((s) => /北側境界線/.test(s)), '北側の注記が無い: ' + labels.join(' / '));
  assert.ok(labels.some((s) => /道路反対側境界線/.test(s)), '道路の注記が無い: ' + labels.join(' / '));
});

test('25-1: 境界線はどの階の平面図にも出る。屋根の輪郭はどの階にも出ない', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  [1, 2, 3].forEach((f) => {
    const svg = planSvg(ctx, f);
    assert.equal(chainLines(svg).length, 1, f + 'F に境界線が無い');
    assert.equal(roofDashLines(svg).length, 0, f + 'F に屋根の輪郭が出ている');
    assert.equal(arrowHeads(svg).length, 0, f + 'F に勾配の矢印が出ている');
  });
});

// ══ 23-4 2方向にかかる場合 ════════════════════════════════════════════

test('23-4(最重要): 道路＋北側の2方向にかかる場合、境界線が両方出る', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(BOTH, { road: true, roadY: 5500 }))));
  const planes = plain(run(ctx, 'setbackPlanes()'));
  assert.equal(planes.length, 2, '面が2枚: ' + JSON.stringify(planes.map((p) => p.kind)));
  const svg = planSvg(ctx, 3);
  const cl = chainLines(svg);
  assert.equal(cl.length, 2, '境界線が2本出ていない: ' + JSON.stringify(cl));
  const ys = cl.map((l) => l.y1).sort((a, b) => a - b);
  assert.equal(ys[0], 0, '北側境界線は y=0');
  assert.equal(ys[1], 8500, '道路の反対側の境界線は y=8500(道路 5500..8500 の向こう側)');
  assert.ok(roadLimitMm(1660, 8500) > 8500, '手計算の確認(y=1660 で制限 8550)');
  const labels = texts(svg).map((t) => t.s);
  assert.ok(labels.some((s) => /北側境界線/.test(s)), '北側の注記が無い: ' + labels.join(' / '));
  assert.ok(labels.some((s) => /道路反対側境界線/.test(s)), '道路の注記が無い: ' + labels.join(' / '));
  // それぞれの注記に、その制限の勾配が入っている(どちらの斜線かが読める)。
  assert.ok(labels.some((s) => /北側斜線/.test(s)), '北側斜線の勾配注記が無い: ' + labels.join(' / '));
  assert.ok(labels.some((s) => /道路斜線/.test(s)), '道路斜線の勾配注記が無い: ' + labels.join(' / '));
});

// ══ 23-5 読める図面であること ═════════════════════════════════════════

test('23-5(最重要): 用紙に乗らない境界線は引かない(枠外へ伸びる線・注記を作らない)', () => {
  // 道路を 100m 南へ置くと、その反対側の境界線は用紙(1:100 の A3 = 42m×29.7m)の外。
  const ctx = withDrawing(withSetback(makeCtx(basePlan(BOTH, { road: true, roadY: 100000 }))));
  assert.equal(plain(run(ctx, 'setbackPlanes()')).length, 2, '面そのものは2枚できている');
  const svg = planSvg(ctx, 3);
  const cl = chainLines(svg);
  assert.equal(cl.length, 1, '用紙に乗らない境界線まで引いている: ' + JSON.stringify(cl));
  assert.equal(cl[0].y1, 0, '残るのは北側境界線');
  assert.equal(/道路反対側境界線/.test(svg), false, '枠外の線の注記だけが残っている');
});

test('23-5(最重要): 境界線が用紙の外にあるときは、その脇に置く注記も出さない', () => {
  // 手入力の勾配(0.1)を使うと、制限面は遠くまで低いままなので、境界線から
  // ずっと離れた3階建てだけが制限を超える。境界線 y=0 は用紙の外に出る。
  //   平屋 y=1000..20000 … 天端3150 < 5000+0.1d  → 超えない
  //   3階建て y=25000..29000 … 天端8550 > 5000+0.1d(=7500〜7900) → 超える
  const site = { id: 'site', type: 'site-rect', x: -1000, y: 0, w: 8000, d: 40000, rot: 0,
    setback: { zone: 'low1', north: true, road: false, northBaseMm: 5000, northSlope: 0.1 } };
  const rooms = [{ id: 'flat', n: '平屋', floor: 1, x: 0, y: 1000, w: 6000, d: 19000 }];
  const walls = [{ id: 'f1', floor: 1, x1: 0, y1: 1000, x2: 6000, y2: 1000, thick: 120 },
    { id: 'f2', floor: 1, x1: 0, y1: 20000, x2: 6000, y2: 20000, thick: 120 }];
  [1, 2, 3].forEach((f) => {
    rooms.push({ id: 't' + f, n: '塔' + f, floor: f, x: 0, y: 25000, w: 6000, d: 4000 });
    walls.push({ id: 'tn' + f, floor: f, x1: 0, y1: 25000, x2: 6000, y2: 25000, thick: 120 });
    walls.push({ id: 'ts' + f, floor: f, x1: 0, y1: 29000, x2: 6000, y2: 29000, thick: 120 });
  });
  const ctx = withDrawing(withSetback(makeCtx({ items: [site], rooms, walls, floorMetadata: {} })));
  const svg = run(ctx, 'JISDRAW.buildFloorPlanSvg(3,{scale:"100",paper:"a4"})');
  const v = viewBox(svg);
  assert.ok(v.minY > 0, '用紙は塔のまわりだけを写している(境界線 y=0 は枠の外): ' + v.minY);
  assert.ok(plain(run(ctx, 'setbackRoofItems()')).length >= 1, '3D には屋根が架かっている');
  assert.equal(chainLines(svg).length, 0, '枠の外の境界線を引いている');
  const note = texts(svg).filter((t) => /境界線|勾配/.test(t.s));
  assert.equal(note.length, 0, '枠の外に注記を置いている: ' + JSON.stringify(note));
});

test('23-5(最重要): 線も注記も用紙の枠の中に収まる(はみ出さない)', () => {
  [['{scale:"100",paper:"a3"}', 100], ['{scale:"200",paper:"a4"}', 200]].forEach(([opts, scale]) => {
    const ctx = withDrawing(withSetback(makeCtx(basePlan(BOTH, { road: true, roadY: 5500 }))));
    const svg = run(ctx, 'JISDRAW.buildFloorPlanSvg(3,' + opts + ')');
    const v = viewBox(svg);
    const fs = run(ctx, 'JISDRAW.lineWidths(' + scale + ').text') * 0.8;
    chainLines(svg).forEach((l) => {
      [[l.x1, l.y1], [l.x2, l.y2]].forEach((p) => {
        assert.ok(p[0] >= v.minX - 1e-6 && p[0] <= v.maxX + 1e-6, '線が枠の外: ' + JSON.stringify(l));
        assert.ok(p[1] >= v.minY - 1e-6 && p[1] <= v.maxY + 1e-6, '線が枠の外: ' + JSON.stringify(l));
      });
    });
    texts(svg).filter((t) => /境界線|勾配/.test(t.s)).forEach((t) => {
      const half = t.s.length * fs * 0.95 / 2;   // estRoomLabelWidth と同じ見積り
      assert.ok(t.x - half >= v.minX && t.x + half <= v.maxX,
        scale + ': 注記が横にはみ出す: ' + t.s + ' @' + t.x);
      assert.ok(t.y >= v.minY + fs && t.y <= v.maxY - fs,
        scale + ': 注記が縦にはみ出す: ' + t.s + ' @' + t.y);
    });
  });
});

test('23-5: 斜線の注記は上下が裏返らない向きで書かれる(回転は -90以上90未満)', () => {
  const ctx = withDrawing(withSetback(makeCtx(basePlan(NORTH_ONLY))));
  let seen = 0;
  [0, 90, 137].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    const re = /<text [^>]*?(?:transform="rotate\(([-\d.]+) [^"]*")?>([^<]*)<\/text>/g;
    let m;
    while ((m = re.exec(planSvg(ctx, 3)))) {
      if (!/境界線|勾配/.test(m[2])) continue;
      seen++;
      if (m[1] === undefined) continue;   // 回転なし = 水平のまま
      const a = Number(m[1]);
      assert.ok(a >= -90 && a < 90, deg + '度: 文字が裏返る角度 ' + a + ' / ' + m[2]);
      // 縦になる文字は「下から上へ読む」向き(既存の左側寸法と同じ -90)。
      if (Math.abs(Math.abs(a) - 90) < 1e-9) assert.equal(a, -90, '縦書きの向きが逆: ' + m[2]);
    }
  });
  assert.equal(seen, 3, '境界線の注記が方位ごとに1つずつ読めていない: ' + seen);
});
