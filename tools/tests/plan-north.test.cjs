// Task 19: 方位をプランに保存し、図面とビューの呼称を方位に合わせる。
//
// grep ではない。index.html から関数と JISDRAW の即時実行関数を波括弧の対応で
// 切り出し、node:vm で **走らせて** 値と SVG を読む。
//
// ここで守りたいこと:
//   19-1 方位の真実源は DATA.northDeg。LIGHT_SETTINGS.northDeg はその写し。
//        方位を持たないプラン（＝既存の全プラン）は 0 度。
//   19-2 斜線制限はプラン側の方位を読む。0 度なら今までと同じ面が出る。
//   19-3 8方位の呼称。0 度では「北立面図」等の文字列が1文字も変わらない。
//        立面図の**軸は動かさない** = SVG の中身は方位を回しても同一。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const Law = require(join(ROOT, 'assets', 'js', 'setback-law.js'));
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

// ── index.html からの切り出し（setback-limits.test.cjs と同じ数え方） ──
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
  const at = m.index;
  return html.slice(at + 1, balanced(at) + 1) + ';';
}
// var JISDRAW=(function(){ … })(); を丸ごと。中身は書き換えず、そのまま走らせる。
function jisdrawIife() {
  const at = html.indexOf('\nvar JISDRAW=(function(){');
  assert.notEqual(at, -1, 'var JISDRAW=(function(){ が index.html に無い');
  const end = balanced(at);
  const tail = html.slice(end, end + 6);
  assert.equal(tail.slice(0, 5), '})();', 'JISDRAW の閉じ方が変わっている: ' + JSON.stringify(tail));
  return html.slice(at + 1, end + 5);
}

const NORTH_FNS = [
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg',
  'compassSector', 'compassNameJa', 'compassCode',
  'planDirBearingDeg', 'elevationDirNameJa', 'elevationSheetLabel', 'elevationDirCode',
  'computeSunPosition'
];
const NORTH_VARS = ['COMPASS_8_JA', 'COMPASS_8_CODE', 'ELEV_DIR_SCREEN_DEG'];

// 立面図 SVG を作るのに必要な、JISDRAW の外側の関数群。
const DRAW_FNS = [
  'bestFmpType',
  'getFmpItem',
  'isDoorLikeOpeningType',
  'isWindowLikeType',
  'isOpeningItemType',
  'wallAdjacentRoomsCeiling',
  'wallCeilingHeightM',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber', 'wallDisplayHeightM',
  'wallSolidCoverHeightMm', 'wallCoreBoxHitMm', 'wallEndCornerExtensionMm', 'getObjBounds', 'isFiniteCanvasValue'
];
const DRAW_VARS = ['FMP_ITEMS', 'U', 'WALL_H', 'WALL_CORE_END_PAD_MM', 'FLOOR_H', 'FLOOR_SLAB_H'];
// 複数行のオブジェクトリテラル（1行の var 抽出では取れない）。
const DRAW_OBJ_VARS = ['LEGACY_FMP_TYPE_MAP'];

function makeCtx(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String, Boolean, parseInt, parseFloat, Date,
    SetbackLaw: Law, HeightModel,
    DATA: data,
    ST: { showDim: true, selected: null, floor: 1 },
    LIGHT_SETTINGS: { northDeg: 0, hour: 13, season: 'equinox', sunSim: false },
    // DOM は無い。syncNorthUi は document が無ければ何もしないので、そのまま呼べる。
    // 立面図が触る外側のフックは、値を返すだけの最小の形で置く。
    roomAtPointOnFloor: () => null,
    getOpeningWallInfo: () => null,
    isDoorItemType: () => false,
    escHtml: (s) => String(s)
  });
  vm.runInContext(
    DRAW_OBJ_VARS.map(topLevelObjectVar).concat(NORTH_VARS.concat(DRAW_VARS).map(topLevelVar))
      .concat(NORTH_FNS.concat(DRAW_FNS).map(topLevelFunction))
      .join('\n'),
    ctx
  );
  return ctx;
}
function withDrawing(ctx) {
  vm.runInContext(jisdrawIife(), ctx);
  return ctx;
}
function run(ctx, src) { return vm.runInContext(src, ctx); }

// ── プラン素材 ────────────────────────────────────────────────────────
// 敷地 x:0..8000 / y:0..7000、北側斜線あり。壁は南北に長い箱1つ。
function plan(extra) {
  const p = {
    walls: [
      { id: 1, x1: 1000, y1: 1000, x2: 6000, y2: 1000, thick: 120, floor: 1 },
      { id: 2, x1: 6000, y1: 1000, x2: 6000, y2: 5000, thick: 120, floor: 1 },
      { id: 3, x1: 6000, y1: 5000, x2: 1000, y2: 5000, thick: 120, floor: 1 },
      { id: 4, x1: 1000, y1: 5000, x2: 1000, y2: 1000, thick: 120, floor: 1 }
    ],
    items: [
      { id: 10, type: 'site-rect', x: 0, y: 0, w: 8000, d: 7000, rot: 0,
        setback: { zone: 'low1', north: true, road: false } }
    ],
    rooms: [], floorMetadata: {}
  };
  if (extra) Object.keys(extra).forEach((k) => { p[k] = extra[k]; });
  return p;
}

// ══ 19-1 方位はプランが持つ ═══════════════════════════════════════════

test('19-1(最重要): 方位を持たないプランは 0 度（既存の全プランがこれ）', () => {
  const ctx = makeCtx(plan());
  assert.equal(run(ctx, 'DATA.northDeg'), undefined, '素材に方位は入っていない');
  assert.equal(run(ctx, 'planNorthDeg()'), 0);
  assert.equal(run(ctx, 'syncNorthFromPlan()'), 0);
  assert.equal(run(ctx, 'LIGHT_SETTINGS.northDeg'), 0);
  // null / 空文字 / 壊れた値も 0 に倒れる（保存データは何でも入りうる）。
  [null, '', 'abc', NaN, undefined].forEach((bad) => {
    run(ctx, 'DATA.northDeg=' + JSON.stringify(bad === undefined ? null : bad));
    if (bad !== bad) run(ctx, 'DATA.northDeg=NaN');
    assert.equal(run(ctx, 'planNorthDeg()'), 0, '壊れた値 ' + String(bad) + ' は 0 度');
  });
});

test('19-1(最重要): 方位を設定すると DATA に入り、照明設定はその写しになる', () => {
  const ctx = makeCtx(plan());
  assert.equal(run(ctx, 'setPlanNorthDeg(45)'), 45);
  assert.equal(run(ctx, 'DATA.northDeg'), 45, '真実源はプラン側');
  assert.equal(run(ctx, 'LIGHT_SETTINGS.northDeg'), 45, '照明設定は写し');
  // 写しを直接書き換えても真実源は動かず、次の同期で写しが正される。
  run(ctx, 'LIGHT_SETTINGS.northDeg=200');
  assert.equal(run(ctx, 'planNorthDeg()'), 45, '写しを触ってもプランの方位は動かない');
  assert.equal(run(ctx, 'syncNorthFromPlan()'), 45);
  assert.equal(run(ctx, 'LIGHT_SETTINGS.northDeg'), 45, '写しが正された');
});

test('19-1(最重要): 保存 → 読み込みで方位が 45 度のまま生き残る（JSON の往復）', () => {
  const a = makeCtx(plan());
  run(a, 'setPlanNorthDeg(45)');
  // 保存経路が使う直列化（serializeDataSnapshot / StorageAdapter.save と同じ形）
  const saved = run(a, 'JSON.stringify(DATA,function(k,v){return k==="_texObj"?undefined:v;})');
  assert.ok(/"northDeg":45/.test(saved), '保存された JSON に方位が入っている: ' + saved.slice(0, 120));
  // 読み込み側は新しい文脈。DATA を差し替えて、アプリと同じ同期を1回だけ呼ぶ。
  const b = makeCtx(plan());
  run(b, 'DATA=JSON.parse(' + JSON.stringify(saved) + '); syncNorthFromPlan();');
  assert.equal(run(b, 'planNorthDeg()'), 45, '開き直しても 45 度');
  assert.equal(run(b, 'LIGHT_SETTINGS.northDeg'), 45);
});

test('19-1: 方位を持たないプランを保存しても JSON に方位は増えない', () => {
  const ctx = makeCtx(plan());
  run(ctx, 'syncNorthFromPlan()');
  const saved = run(ctx, 'JSON.stringify(DATA)');
  assert.equal(/northDeg/.test(saved), false, '既存プランの保存内容は太らない: ' + saved.slice(0, 200));
});

test('19-1: 角度は 0〜360 に畳まれる（負・360超・小数）', () => {
  const ctx = makeCtx(plan());
  assert.equal(run(ctx, 'setPlanNorthDeg(-45)'), 315);
  assert.equal(run(ctx, 'setPlanNorthDeg(725)'), 5);
  assert.equal(run(ctx, 'setPlanNorthDeg(360)'), 0);
  assert.equal(run(ctx, 'setPlanNorthDeg(22.5)'), 22.5, '小数は丸めない');
});

// ══ 19-2 斜線制限はプランの方位を読む ═════════════════════════════════

const SETBACK_VARS = ['SETBACK_PLANE_MARGIN_MM',
  'SETBACK_BASE_MIN_MM', 'SETBACK_BASE_MAX_MM', 'SETBACK_SLOPE_MIN', 'SETBACK_SLOPE_MAX'];
const SETBACK_FNS = [
  'setbackLawApi', 'setbackOverrideNum', 'siteSetbackConfig', 'activeSetbackSite', 'activeSetbackSites',
  'setbackBoundsMm', 'setbackNorthDeg', 'setbackNorthVecPlan',
  'setbackRoadWidthDir', 'setbackRoadItems', 'setbackRoadItem', 'setbackRoadWidthMm',
  'setbackPlanesForSite', 'makeSetbackPlane', 'setbackDistanceMm', 'setbackLimitHeightMmAt',
  'setbackPointAt', 'setbackPlanes'
];
function withSetback(ctx) {
  vm.runInContext(
    SETBACK_VARS.map(topLevelVar).concat(SETBACK_FNS.map(topLevelFunction)).join('\n'),
    ctx
  );
  return ctx;
}

test('19-2(最重要): 斜線制限は DATA の方位を読む。0 度なら今までと同じ面', () => {
  const ctx = withSetback(makeCtx(plan()));
  const pl = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
  assert.equal(pl.kind, 'north');
  assert.equal(pl.nx, 0);
  assert.equal(pl.ny, 1, '法線は真南 = 平面図の下（従来と同じ）');
  assert.equal(pl.d0, 0, '北側境界は敷地の最小 y');
});

test('19-2(最重要): 保存した方位で開き直すと、面はその方位ぶん回っている', () => {
  const saver = makeCtx(plan());
  run(saver, 'setPlanNorthDeg(90)');
  const saved = run(saver, 'JSON.stringify(DATA)');

  const ctx = withSetback(makeCtx(plan()));
  run(ctx, 'DATA=JSON.parse(' + JSON.stringify(saved) + '); syncNorthFromPlan();');
  assert.equal(run(ctx, 'setbackNorthDeg()'), 90, '開き直しても方位は 90 度');
  const pl = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
  assert.ok(Math.abs(pl.nx + 1) < 1e-9, '法線は西向き（真北が東を向いた）: ' + pl.nx);
  assert.ok(Math.abs(pl.ny) < 1e-9, pl.ny);
});

test('19-2(最重要): 写し（LIGHT_SETTINGS）だけを回しても制限面は動かない', () => {
  // ここが Task 19 の目的そのもの。写しが真実源として効いていると、
  // プランを開き直したときに斜線制限の向きだけが前のセッションへ戻る。
  const ctx = withSetback(makeCtx(plan()));
  const before = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
  run(ctx, 'LIGHT_SETTINGS.northDeg=180');
  const after = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
  assert.deepEqual([after.nx, after.ny, after.d0], [before.nx, before.ny, before.d0],
    '照明設定を触っても面は動かない');
  run(ctx, 'setPlanNorthDeg(180)');
  const moved = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
  assert.ok(Math.abs(moved.ny + 1) < 1e-9, 'プラン側を回したときだけ動く: ' + moved.ny);
});

test('19-2: 真北の向きは日照シミュレーションと同じまま（太陽から独立に検算）', () => {
  [0, 22, 45, 90, 180, 270, 355].forEach((deg) => {
    const ctx = withSetback(makeCtx(plan()));
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    const sun = JSON.parse(JSON.stringify(run(ctx, 'computeSunPosition(12,"equinox",' + deg + ')')));
    const len = Math.hypot(sun.x, sun.z);
    const pl = JSON.parse(JSON.stringify(run(ctx, 'setbackPlanes()')))[0];
    assert.ok(Math.abs(pl.nx - sun.x / len) < 1e-9 && Math.abs(pl.ny - sun.z / len) < 1e-9,
      deg + '°: 面の法線が正午の太陽（真南）と違う');
  });
});

// ══ 19-3 呼称は方位から作る ═══════════════════════════════════════════

test('19-3(最重要): 方位 0 度では呼称が1文字も変わらない', () => {
  const ctx = makeCtx(plan());
  assert.equal(run(ctx, 'elevationSheetLabel("n")'), '北立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("e")'), '東立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("s")'), '南立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("w")'), '西立面図');
  ['n', 'e', 's', 'w'].forEach((d) => {
    assert.equal(run(ctx, 'elevationDirCode("' + d + '")'), d, '書き出し名の方角コードも従来どおり');
  });
});

test('19-3(最重要): 8方位の境目は真北±22.5度。22.4度と22.6度で「北」と「北東」が分かれる', () => {
  const ctx = makeCtx(plan());
  // ここが1つずれると、22.4 と 22.6 のどちらも「もっともらしく」見えてしまう。
  assert.equal(run(ctx, 'compassNameJa(0)'), '北');
  assert.equal(run(ctx, 'compassNameJa(22.4)'), '北', '22.4度はまだ北');
  assert.equal(run(ctx, 'compassNameJa(22.6)'), '北東', '22.6度から北東');
  assert.equal(run(ctx, 'compassNameJa(67.4)'), '北東', '67.4度はまだ北東');
  assert.equal(run(ctx, 'compassNameJa(67.6)'), '東', '67.6度から東');
  assert.equal(run(ctx, 'compassNameJa(337.6)'), '北', '337.6度で北へ戻る');
  assert.equal(run(ctx, 'compassNameJa(337.4)'), '北西', '337.4度はまだ北西');
  // 8つの中心はそれぞれの名前ちょうど。
  ['北', '北東', '東', '南東', '南', '南西', '西', '北西'].forEach((name, i) => {
    assert.equal(run(ctx, 'compassNameJa(' + i * 45 + ')'), name, i * 45 + '度');
    assert.equal(run(ctx, 'compassNameJa(' + (i * 45 - 22.4) + ')'), name, '下側の縁');
    assert.equal(run(ctx, 'compassNameJa(' + (i * 45 + 22.4) + ')'), name, '上側の縁');
  });
});

test('19-3(最重要): 方位を回すと呼称が回る。回る向きは真北ベクトルと一致する', () => {
  const ctx = withSetback(makeCtx(plan()));
  // 真北が平面図のどちらを向くかは setbackNorthVecPlan が答える。呼称はそれと
  // 同じ答えでなければならない（食い違うと、北側斜線が立っている辺と
  // 「北立面図」の面が別物になる）。
  [0, 45, 90, 135, 180, 225, 270, 315].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    const nv = JSON.parse(JSON.stringify(run(ctx, 'setbackNorthVecPlan()')));
    // 真北ベクトルの画面角（上=0、時計回り）。
    const northScreen = ((Math.atan2(nv.x, -nv.y) * 180 / Math.PI) % 360 + 360) % 360;
    ['n', 'e', 's', 'w'].forEach((d) => {
      const screen = { n: 0, e: 90, s: 180, w: 270 }[d];
      const expect = ((screen - northScreen) % 360 + 360) % 360;
      assert.equal(run(ctx, 'planDirBearingDeg("' + d + '")'), Math.round(expect * 1e6) / 1e6,
        deg + '° の ' + d + ' 面');
    });
  });
});

test('19-3(最重要): 方位45度では平面図の上は「北西」を向く（真北は上ではなく右上）', () => {
  const ctx = withSetback(makeCtx(plan()));
  run(ctx, 'setPlanNorthDeg(45)');
  const nv = JSON.parse(JSON.stringify(run(ctx, 'setbackNorthVecPlan()')));
  assert.ok(nv.x > 0 && nv.y < 0, '真北は平面図の右上を向く: ' + JSON.stringify(nv));
  assert.equal(run(ctx, 'elevationSheetLabel("n")'), '北西立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("e")'), '北東立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("s")'), '南東立面図');
  assert.equal(run(ctx, 'elevationSheetLabel("w")'), '南西立面図');
  assert.equal(run(ctx, 'elevationDirCode("n")'), 'nw');
  assert.equal(run(ctx, 'elevationDirCode("e")'), 'ne');
});

test('19-3: 方位を 0 度に戻すと呼称も戻る', () => {
  const ctx = makeCtx(plan());
  run(ctx, 'setPlanNorthDeg(45)');
  assert.equal(run(ctx, 'elevationSheetLabel("n")'), '北西立面図');
  run(ctx, 'setPlanNorthDeg(0)');
  assert.equal(run(ctx, 'elevationSheetLabel("n")'), '北立面図');
  assert.equal(run(ctx, 'elevationDirCode("n")'), 'n');
});

// ══ 19-3 立面図の軸は動かさない（SVG を実際に作って比べる） ════════════

test('19-3(最重要): シート一覧の呼称は方位から作られる。0 度では従来の文字列', () => {
  const ctx = withDrawing(makeCtx(plan()));
  const at0 = JSON.parse(JSON.stringify(run(ctx, 'JISDRAW.availableSheets()')));
  assert.deepEqual(at0.filter((s) => s.kind === 'elev').map((s) => s.label),
    ['東立面図', '西立面図', '南立面図', '北立面図']);
  run(ctx, 'setPlanNorthDeg(45)');
  const at45 = JSON.parse(JSON.stringify(run(ctx, 'JISDRAW.availableSheets()')));
  // 並びは e, w, s, n のまま。45度では e→北東 / w→南西 / s→南東 / n→北西。
  assert.deepEqual(at45.filter((s) => s.kind === 'elev').map((s) => s.label),
    ['北東立面図', '南西立面図', '南東立面図', '北西立面図']);
  // 平面図のシート名は方位で変わらない。
  assert.deepEqual(at45.filter((s) => s.kind === 'plan').map((s) => s.label),
    at0.filter((s) => s.kind === 'plan').map((s) => s.label));
  // 軸のキー（どの面を描くか）は同じ順・同じ値のまま。
  assert.deepEqual(at45.map((s) => s.kind + ':' + s.key), at0.map((s) => s.kind + ':' + s.key));
});

test('19-3(最重要): 立面図の中身は方位を回しても同一（軸は建物に正対したまま）', () => {
  const ctx = withDrawing(makeCtx(plan()));
  const opts = '{scale:"100",paper:"a3"}';
  // 比べるのは図形の本体。方位記号（19-4）は方位で回るので、そこは切り離す。
  const body = (d) => splitNorthMark(run(ctx, 'JISDRAW.buildElevationSvg("' + d + '",' + opts + ')')).before;
  const base = {};
  ['n', 'e', 's', 'w'].forEach((d) => { base[d] = body(d); });
  assert.ok(base.n.length > 200, '中身のある SVG が出ている: ' + base.n.length);
  [45, 90, 137, 270].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    ['n', 'e', 's', 'w'].forEach((d) => {
      assert.equal(body(d), base[d], deg + '° の ' + d + ' 面の図形が変わっている（軸が動いた）');
    });
  });
  // 東西の面と南北の面は別物である（比較そのものが空振りしていないことの確認）。
  assert.notEqual(base.n, base.e);
});

test('19-3(最重要): 平面図の SVG は方位を回しても同一', () => {
  const ctx = withDrawing(makeCtx(plan()));
  const opts = '{scale:"100",paper:"a3"}';
  // 方位記号（19-4）だけは方位で回る。図形の本体はまったく動かない。
  const body = () => splitNorthMark(run(ctx, 'JISDRAW.buildFloorPlanSvg(1,' + opts + ')')).before;
  const base = body();
  [45, 90, 180].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    assert.equal(body(), base, deg + '° で平面図の図形が変わった');
  });
});

// ══ 19-1 共同編集の経路でも往復する ═══════════════════════════════════

const SHARE_FNS = ['sharedFastSignature', 'sharedClone', 'sharedBaselineFrom', 'buildSharedPatch'];
function withSharing(ctx) {
  vm.runInContext(
    [topLevelVar('SHARED'), topLevelVar('SHARED_FIELDS')]
      .concat(SHARE_FNS.map(topLevelFunction)).join('\n'),
    ctx
  );
  run(ctx, 'SHARED.dirtyIds={walls:{},items:{},rooms:{}};SHARED.forceScan=false;');
  return ctx;
}

test('19-1(最重要): 共同編集の差分に方位が乗る（相手にも届く）', () => {
  const ctx = withSharing(makeCtx(plan()));
  run(ctx, 'SHARED.baseline=sharedBaselineFrom(DATA);');
  assert.equal(run(ctx, 'buildSharedPatch(DATA,SHARED.baseline)'), null, 'まだ何も変わっていない');
  run(ctx, 'setPlanNorthDeg(45);');
  const patch = JSON.parse(JSON.stringify(run(ctx, 'buildSharedPatch(DATA,SHARED.baseline)')));
  assert.ok(patch, '方位を回したら差分が出る');
  assert.equal(patch.fields.northDeg, 45, '差分に方位が入っている: ' + JSON.stringify(patch.fields));
});

test('19-1(最重要): 受け取った差分を当てると方位が入り、写しも揃う', () => {
  const sender = withSharing(makeCtx(plan()));
  run(sender, 'SHARED.baseline=sharedBaselineFrom(DATA);setPlanNorthDeg(45);');
  const patch = run(sender, 'JSON.stringify(buildSharedPatch(DATA,SHARED.baseline))');

  // 受け手。applySharedPatch と同じ「fields をそのまま入れて同期する」経路をなぞる。
  const rcv = withSetback(withSharing(makeCtx(plan())));
  assert.equal(run(rcv, 'planNorthDeg()'), 0);
  run(rcv, 'var __p=JSON.parse(' + JSON.stringify(patch) + ');' +
    'Object.keys(__p.fields).forEach(function(k){if(k!=="viewState")DATA[k]=sharedClone(__p.fields[k]);});' +
    'syncNorthFromPlan();');
  assert.equal(run(rcv, 'planNorthDeg()'), 45, '相手の方位が届いた');
  assert.equal(run(rcv, 'LIGHT_SETTINGS.northDeg'), 45, '写しも揃った');
  const pl = JSON.parse(JSON.stringify(run(rcv, 'setbackPlanes()')))[0];
  assert.ok(Math.abs(pl.nx - (-Math.sin(Math.PI / 4))) < 1e-9, '斜線制限も45度ぶん回った: ' + pl.nx);
});

test('19-1: 方位を持たないプランは共同編集の差分を1つも生まない', () => {
  const ctx = withSharing(makeCtx(plan()));
  run(ctx, 'SHARED.baseline=sharedBaselineFrom(DATA);syncNorthFromPlan();');
  assert.equal(run(ctx, 'buildSharedPatch(DATA,SHARED.baseline)'), null,
    '同期しただけで差分が出てはいけない（既存プランが黙って書き換わる）');
});

// ══ 19-3 書き出しファイル名も方位から作る ═════════════════════════════

test('19-3(最重要): 立面図の書き出しファイル名は方位のコードになる（0度では従来のまま）', () => {
  const ctx = makeCtx(plan());
  vm.runInContext([topLevelVar('JIS_UI'), topLevelFunction('jisFileBaseName')].join('\n'), ctx);
  function nameFor(kind, key) {
    run(ctx, 'JIS_UI.sheet={kind:"' + kind + '",key:' + JSON.stringify(key) + '};');
    // 日付部分（YYYYMMDD）はここでの関心ではないので落とす。
    return run(ctx, 'jisFileBaseName()').replace(/-\d{8}$/, '');
  }
  ['n', 'e', 's', 'w'].forEach((d) => {
    assert.equal(nameFor('elev', d), 'jis-elev-' + d, '方位0度では従来のファイル名');
  });
  assert.equal(nameFor('plan', 1), 'jis-plan1f', '平面図の名前は方位で変わらない');

  run(ctx, 'setPlanNorthDeg(45)');
  assert.equal(nameFor('elev', 'n'), 'jis-elev-nw');
  assert.equal(nameFor('elev', 'e'), 'jis-elev-ne');
  assert.equal(nameFor('elev', 's'), 'jis-elev-se');
  assert.equal(nameFor('elev', 'w'), 'jis-elev-sw');
  assert.equal(nameFor('plan', 2), 'jis-plan2f', '平面図の名前は方位で変わらない');

  run(ctx, 'setPlanNorthDeg(90)');
  assert.equal(nameFor('elev', 'n'), 'jis-elev-w', '90度では平面図の上は西を向く');
  run(ctx, 'setPlanNorthDeg(0)');
  assert.equal(nameFor('elev', 'n'), 'jis-elev-n', '0度に戻すと元のファイル名へ戻る');
});

// ══ 19-4 方位記号 ═════════════════════════════════════════════════════

// 方位記号は本体のいちばん後ろに付く。'N' の文字から後ろが記号ぶん。
function splitNorthMark(svg) {
  const at = svg.indexOf('text-anchor="middle" font-family="\'Noto Sans JP\',sans-serif" font-size="330" fill="#000">N</text>');
  assert.notEqual(at, -1, '方位記号の N が見つからない: ' + svg.slice(-300));
  const head = svg.lastIndexOf('<text', at);
  return { before: svg.slice(0, head), mark: svg.slice(head) };
}

test('19-4(最重要): 平面図の方位記号は方位ぶん回る。0度では回転を付けない', () => {
  const ctx = withDrawing(makeCtx(plan()));
  const opts = '{scale:"100",paper:"a3"}';
  const at0 = run(ctx, 'JISDRAW.buildFloorPlanSvg(1,' + opts + ')');
  const m0 = splitNorthMark(at0);
  assert.equal(/<g transform="rotate\(/.test(m0.mark), false,
    '0度では針に回転を付けない（これまでの出力と1バイトも変わらない）');

  run(ctx, 'setPlanNorthDeg(45)');
  const at45 = run(ctx, 'JISDRAW.buildFloorPlanSvg(1,' + opts + ')');
  const m45 = splitNorthMark(at45);
  assert.equal(m45.before, m0.before, '図面の中身は方位で変わらない（変わるのは記号だけ）');
  const g = m45.mark.match(/<g transform="rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)">/);
  assert.ok(g, '45度では針が回る: ' + m45.mark);
  assert.equal(Number(g[1]), 45, '回転角は保存された方位そのもの');
  // 回転の中心は記号の円の中心。
  const circle = m45.mark.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/);
  assert.equal(g[2], circle[1], '回転の中心x = 円の中心x');
  assert.equal(g[3], circle[2], '回転の中心y = 円の中心y');
  // 針の <g> を外すと 0 度の記号に戻る = 針以外は何も動いていない。
  assert.equal(m45.mark.replace(/<g transform="rotate\([^)]*\)">/, '').replace('</g>', ''), m0.mark);

  [90, 180, 270, 137.5].forEach((deg) => {
    run(ctx, 'setPlanNorthDeg(' + deg + ')');
    const s = splitNorthMark(run(ctx, 'JISDRAW.buildFloorPlanSvg(1,' + opts + ')')).mark;
    assert.equal(Number(s.match(/rotate\(([-\d.]+) /)[1]), deg, deg + '度');
  });

  run(ctx, 'setPlanNorthDeg(0)');
  assert.equal(run(ctx, 'JISDRAW.buildFloorPlanSvg(1,' + opts + ')'), at0, '0度へ戻すと元の図面へ戻る');
});

test('19-4(最重要): 立面図にも方位記号が入る（0度でも出る＝立面図の出力は変わる）', () => {
  const ctx = withDrawing(makeCtx(plan()));
  const opts = '{scale:"100",paper:"a3"}';
  const at0 = run(ctx, 'JISDRAW.buildElevationSvg("n",' + opts + ')');
  const m0 = splitNorthMark(at0);
  // 記号は上下反転グループの外側にある（中に入れると記号ごと裏返る）。
  assert.ok(m0.before.endsWith('</g>'), '記号の直前で scale(1,-1) のグループが閉じている');
  assert.equal(/<g transform="rotate\(/.test(m0.mark), false, '0度では針に回転を付けない');

  run(ctx, 'setPlanNorthDeg(45)');
  const m45 = splitNorthMark(run(ctx, 'JISDRAW.buildElevationSvg("n",' + opts + ')'));
  assert.equal(m45.before, m0.before, '記号を除いた立面図は方位で変わらない（軸は動いていない）');
  assert.equal(Number(m45.mark.match(/rotate\(([-\d.]+) /)[1]), 45, '立面図の方位記号も回る');
});
