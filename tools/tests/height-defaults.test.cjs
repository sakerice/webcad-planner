// 壁・床の既定値(サイドメニュー)と、そこから決まる階の位置。
//
// 直した不良: 低層階の壁を高くしても上階の始まる高さが据え置かれ、下階の壁が
// 上階へめり込んでいた。階高は「床スラブ + その階の既定の壁高さ」を下回れない。
// 個別に高くした壁は階全体を持ち上げず、その壁の上に載る床だけを持ち上げる。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
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

const FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'usesFinishedHeightModel', 'defaultFloorThicknessMm',
  'perFloorHeightsEnabled', 'planFloorHeightEntry',
  'defaultWallHeightMmForFloor', 'defaultFloorRaiseMmForFloor',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorSlabMmForFloor', 'floorSlabHeightM', 'floorSlabHeightMForFloor',
  'floorBaseY', 'floorTopY', 'localSupportTopY', 'floorHasSkipLevel', 'wallSkipBaseMm', 'wallSkipLevelsMm', 'wallSkipFootMm', 'floorMaxSkipLevelMm', 'roomSkipLevelMm', 'roomAtPointOnFloor', 'segmentInsideRectLengthMm',
  'wallFullHeightM', 'wallHeightMm',
  'roomFloorOffsetMm', 'roomFloorTopY', 'roomStoreyFloorTopY', 'roomFloorAt'
];

function ctxFor(data) {
  const ctx = vm.createContext({ console, HeightModel, DATA: data, Number, Math, isFinite });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'), topLevelVar('U')
  ].concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

// 2階建て。1階に外周の壁を1本だけ置く(高さの指定なし = 既定に従う)。
function house(extra) {
  const plan = {
    floors: {}, heightDefaults: {}, items: [],
    rooms: [
      { id: 'a', floor: 2, x: 0, y: 0, w: 4000, d: 4000 },
      { id: 'b', floor: 2, x: 4000, y: 0, w: 4000, d: 4000 }
    ],
    walls: [
      { id: 1, floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120 },
      { id: 2, floor: 1, x1: 4000, y1: 0, x2: 8000, y2: 0, thick: 120 }
    ]
  };
  Object.assign(plan, extra || {});
  return plan;
}

test('既定のままの家は、これまでと同じ位置に建つ', () => {
  const g = ctxFor(house());
  assert.equal(g.storyHeightMmForFloor(1), 2700);
  // 基礎を置いていない家なので 1階の基準面は 0。2階は階高ぶんだけ上がる。
  assert.equal(Math.round(g.floorBaseY(1) / g.U), 0);
  assert.equal(Math.round(g.floorBaseY(2) / g.U), 2700);
  assert.equal(Math.round(g.floorTopY(2) / g.U), 2880);    // + 床スラブ180
  assert.equal(g.defaultFloorRaiseMmForFloor(1), 0);
});

// ── 直した不良 ──────────────────────────────────────────────────────────
test('既定の壁高さを上げると、上階の始まる高さも上がる（壁がめり込まない）', () => {
  const g = ctxFor(house());
  g.WALL_H = 3200;
  assert.equal(g.storyHeightMmForFloor(1), 3200);
  assert.equal(Math.round(g.floorBaseY(2) / g.U), 3200);
  // 外皮としての壁の天端が、2階の基準面をはみ出さない
  assert.equal(Math.round(g.wallFullHeightM(1) / g.U),
               Math.round((g.floorBaseY(2) - g.floorBaseY(1)) / g.U));
});

test('既定の壁高さが階高より低いときは、階高(2700)のまま下がらない', () => {
  const g = ctxFor(house());
  g.WALL_H = 2400;
  assert.equal(g.storyHeightMmForFloor(1), 2700);
  g.WALL_H = 2600;
  assert.equal(g.storyHeightMmForFloor(1), 2700);
});

test('階ごとの設定は、その階だけを動かす', () => {
  const g = ctxFor(house({
    heightDefaults: { perFloor: true },
    floors: { '1': { wallHeight: 2400 }, '2': { wallHeight: 3000 } }
  }));
  assert.equal(g.defaultWallHeightMmForFloor(1), 2400);
  assert.equal(g.defaultWallHeightMmForFloor(2), 3000);
  assert.equal(g.storyHeightMmForFloor(1), 2700);          // 2400 < 2700 なので据え置き
  assert.equal(g.storyHeightMmForFloor(2), 3180);          // 床スラブ180 + 3000
  assert.equal(Math.round(g.floorBaseY(3) / g.U), 2700 + 3180);
});

test('階ごとの設定がOFFなら、階ごとの値は読まれない', () => {
  const g = ctxFor(house({
    heightDefaults: { perFloor: false },
    floors: { '2': { wallHeight: 3000 } }
  }));
  assert.equal(g.defaultWallHeightMmForFloor(2), g.WALL_H);
  assert.equal(g.storyHeightMmForFloor(2), 2700);
});

test('階ごとの床の高さは、個別指定の無い部屋の床上げになる', () => {
  const g = ctxFor(house({
    heightDefaults: { perFloor: true },
    floors: { '2': { floorRaise: 50 } }
  }));
  assert.equal(g.roomFloorOffsetMm(g.DATA.rooms[0]), 50);
  // 個別指定はいつでも優先される
  g.DATA.rooms[0].floorRaiseMm = 0;
  assert.equal(g.roomFloorOffsetMm(g.DATA.rooms[0]), 0);
});

// ── 一部の壁だけ高くしたとき ────────────────────────────────────────────
test('1本だけ高くした壁は、階全体ではなく その上に載る床だけを持ち上げる', () => {
  const g = ctxFor(house());
  g.DATA.walls[0].wallHeight = 4000;    // 0..4000 の区間の壁だけ高い
  // 階の基準面は動かない
  assert.equal(Math.round(g.floorBaseY(2) / g.U), 2700);
  // 高い壁の上に載る部屋の床だけが上がる
  assert.equal(Math.round(g.roomFloorTopY(g.DATA.rooms[0]) / g.U), 4000 + 180);
  // 載っていない部屋は従来どおり
  assert.equal(Math.round(g.roomFloorTopY(g.DATA.rooms[1]) / g.U), 2880);
});

test('既定と同じ高さの壁は、床を1mmも持ち上げない', () => {
  const g = ctxFor(house());
  g.DATA.walls.forEach(function (w) { w.wallHeight = g.WALL_H; });
  assert.equal(Math.round(g.roomFloorTopY(g.DATA.rooms[0]) / g.U), 2880);
  assert.equal(Math.round(g.roomFloorTopY(g.DATA.rooms[1]) / g.U), 2880);
});

test('1階の床は下階の壁を見ない（基礎の上に直接載る）', () => {
  const g = ctxFor(house());
  g.DATA.walls[0].wallHeight = 4000;
  assert.equal(g.localSupportTopY(1, 0, 0, 8000, 4000), g.floorBaseY(1));
});

// ── 保存と復元 ──────────────────────────────────────────────────────────
test('既定値はプランに保存される（保存して開き直すと壁が2400に戻らない）', () => {
  assert.match(html, /function ensureHeightDefaults\(/);
  const body = topLevelFunction('ensureHeightDefaults');
  assert.match(body, /WALL_H=clampWallHeightMm\(hd\.wallHeight\)/);
  // 読み込み経路で必ず呼ばれる
  const load = html.slice(html.indexOf('async function loadPlanFromStorage('));
  assert.match(load.slice(0, 2000), /ensureHeightDefaults\(\);/);
});

// New height semantics are opt-in by data version; legacy cases above remain intact.
test('v2: all storeys including 1F are wall height + slab; room offsets consume interior space', () => {
 const g=ctxFor(house({heightDefaults:{modelVersion:2,floorThickness:180}}));
 for(const f of [1,2,3]){assert.equal(g.storyHeightMmForFloor(f),2580);assert.equal(g.floorSlabMmForFloor(f),180);}
 const base=g.foundationHeightM();
 assert.ok(Math.abs(g.floorBaseY(4)-(base+3*2.58))<1e-9);
 const r={floor:2,x:0,y:0,w:2000,d:2000,floorRaiseMm:150};
 const ceiling=g.floorBaseY(2)+g.storyHeightM(2);
 assert.ok(Math.abs((ceiling-g.roomFloorTopY(r))/.001-2250)<1e-6);
 r.floorRaiseMm=-100;assert.ok(Math.abs((ceiling-g.roomFloorTopY(r))/.001-2500)<1e-6);
 r.floorRaiseMm=-999;assert.equal(g.roomFloorOffsetMm(r),-160);
});
test('v2: floor-specific wall/slab settings accumulate independently', () => {
 const g=ctxFor(house({heightDefaults:{modelVersion:2,perFloor:true,floorThickness:180},floors:{1:{wallHeight:2500,floorThickness:220},2:{wallHeight:2400,floorThickness:300}}}));
 assert.equal(g.storyHeightMmForFloor(1),2720);assert.equal(g.storyHeightMmForFloor(2),2700);
 assert.ok(Math.abs(g.floorBaseY(3)-g.foundationHeightM()-5.42)<1e-9);
 const roundTrip=JSON.parse(JSON.stringify(g.DATA));const restored=ctxFor(roundTrip);
 assert.equal(restored.floorBaseY(3),g.floorBaseY(3));
});

// ── 別のプランを読み込んだとき、前のプランの壁の高さが残らないこと ──────────
//
// WALL_H は「いま編集しているプランの壁の高さ」を持つ変数。ensureHeightDefaults は
// プランが値を持っていればそれを写し、**持っていなければ逆にグローバルの値を
// プランへ書く**。そのため、壁の高さを持つ既定間取りを見たあとに、持っていない
// プランを読み込むと、読み込んだ家が288mm高く建つ。
function loadCtx(data) {
  const ctx = vm.createContext({ console, HeightModel, DATA: data, Number, Math, isFinite });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('DEFAULT_WALL_H_MM'),
    topLevelVar('WALL_H_MIN'),      // WALL_H_MAX も同じ1行にある
    topLevelVar('DEFAULT_FLOOR_RAISE_MM'),
    topLevelFunction('clampWallHeightMm'),
    topLevelFunction('ensureHeightDefaults'),
    topLevelFunction('resetHeightGlobalsForPlanLoad')
  ].join('\n'), ctx);
  return ctx;
}

test('壁の高さの既定は1か所の数字（WALL_H の初期値と戻す先が同じ）', () => {
  assert.match(html, /var WALL_H = 2400;/);
  assert.match(html, /var DEFAULT_WALL_H_MM = 2400;/);
});

test('壁の高さを持たないプランを読み込むと、既定に戻る（前のプランを引き継がない）', () => {
  const ctx = loadCtx({ heightDefaults: { wallHeight: 2688 }, floors: {} });
  ctx.ensureHeightDefaults();
  assert.equal(ctx.WALL_H, 2688, '保存された壁の高さが読めていない');

  ctx.DATA = { heightDefaults: {}, floors: {} };   // 高さを持たないプランを読み込む
  ctx.resetHeightGlobalsForPlanLoad();
  ctx.ensureHeightDefaults();
  assert.equal(ctx.WALL_H, 2400, '前のプランの壁の高さが残っている');
  assert.equal(ctx.DATA.heightDefaults.wallHeight, 2400, '前のプランの値が書き込まれている');
});

test('プランを差し替える経路は、必ず高さの既定を戻してからそろえる', () => {
  // 読み込みの手順は3か所(ファイル取り込み・白紙・共同編集の同期)にある。
  // 1か所でも抜けると「エラーは出ないのに家の高さだけ違う」壊れ方をする。
  const doImport = html.slice(html.indexOf('function doImport('), html.indexOf('function doImport(') + 1600);
  assert.match(doImport, /resetHeightGlobalsForPlanLoad\(\)/);
  assert.match(doImport, /ensureHeightDefaults\(\)/);
  const blank = html.slice(html.indexOf('function chooseBlankPlan('), html.indexOf('function chooseBlankPlan(') + 1200);
  assert.match(blank, /resetHeightGlobalsForPlanLoad\(\)/);
  assert.match(blank, /ensureHeightDefaults\(\)/);
});
