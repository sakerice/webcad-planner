// 天井付けの器具(シーリングライト・ダウンライト・シーリングファン)が
// 天井仕上げ面に付いているか。
//
// 同じ「高さ」でも基準が3つあり、取り違えると必ず浮くか埋まる。
//   部屋の天井高 roomCeilingHeightM … 床スラブ**下端**(floorBaseY)から
//   アイテムの elev                 … 床**仕上げ面**(floorTopY)から
//   天井面のメッシュ                 … 上の天井高から仕上げ厚 12mm ぶん下
// 既定値は長らく wallFullHeightM-160 という当て推量で、1階148mm低く2階32mm高く、
// 既定プランは全灯 elev=2380 の一律で1階が308mm浮いていた。
//
// grep では通ってしまうので、index.html から関数を切り出して node:vm で
// 実際に走らせ、数値で見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
// 間取りは凍結フィクスチャを読む。出荷する assets/default_plan.json を
// 直接読むと、既定間取りを良くするたびにここが落ちる(役割は tools/tests/fixtures/README.md)。
const PLAN = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));

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

const FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'setbackClipsCoverPlan', 'roofCoversPlanPoint',
  'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomAtPointOnFloor', 'ceilingFinishElevationMm', 'defaultLightElevationMm',
  'snapCeilingFixturesToCeiling'
];
const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  'CEILING_FINISH_M', 'CEILING_FIXTURE_TOP_MM', 'PLAN_FIX_CEILING_FIXTURES'];

function makeCtx(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {}, info() {}, error() {} },
    HeightModel, DATA: data, ST: { floor: 1 },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String, Boolean
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const isFixture = (it) => /^light-/.test(it.type) || it.type === 'fmp-CeilingFan01';

test('天井仕上げ面は 1階2688 / 2階2508 / 吹抜5388', () => {
  const ctx = makeCtx(clone(PLAN));
  const at = (fl, x, y) => {
    ctx.__a = [fl, x, y];
    return vm.runInContext('ceilingFinishElevationMm(__a[0],__a[1],__a[2])', ctx);
  };
  assert.equal(at(1, 900, 900), 2688, '1階(浴室)');
  assert.equal(at(2, 1800, 1400), 2508, '2階(洋室A)');
  assert.equal(at(1, 5005, 6370), 5388, '吹き抜け(リビング)');
});

test('新しく置く照明の既定値は、その部屋の天井仕上げ面になる', () => {
  const ctx = makeCtx(clone(PLAN));
  const def = (fl, x, y) => {
    ctx.__a = [fl, x, y];
    return vm.runInContext('defaultLightElevationMm(__a[0],__a[1],__a[2])', ctx);
  };
  // 旧実装は wallFullHeightM-160 = 2540 の一律で、1階148mm低く2階32mm高かった
  assert.equal(def(1, 900, 900), 2688);
  assert.equal(def(2, 1800, 1400), 2508);
  assert.equal(def(1, 5005, 6370), 5388, '吹き抜けでは高所に付く');
});

test('室内の天井付け器具は、すべて天井仕上げ面に一致する', () => {
  const ctx = makeCtx(clone(PLAN));
  let checked = 0;
  for (const it of PLAN.items) {
    if (!isFixture(it)) continue;
    const fl = it.floor || 1;
    const cx = it.x + it.w / 2, cy = it.y + it.d / 2;
    ctx.__a = [fl, cx, cy];
    if (!vm.runInContext('roomAtPointOnFloor(__a[0],__a[1],__a[2])', ctx)) continue; // 屋外
    const want = vm.runInContext('ceilingFinishElevationMm(__a[0],__a[1],__a[2])', ctx);
    const topOff = vm.runInContext('CEILING_FIXTURE_TOP_MM', ctx)[it.type] || 0;
    assert.equal((it.elev || 0) + topOff, want,
      `${it.type} ${it.id} の上端が天井面 ${want}mm と合わない`);
    checked++;
  }
  assert.ok(checked >= 30, `検査した器具が少なすぎる: ${checked}`);
});

test('保存済みプランの移行は1度だけ走り、屋外の器具は触らない', () => {
  const legacy = clone(PLAN);
  let n = 0;
  for (const it of legacy.items) if (isFixture(it)) { it.elev = 2380; n++; }
  assert.ok(n >= 30);
  delete legacy.planFixes;
  const ctx = makeCtx(legacy);

  const moved = vm.runInContext('snapCeilingFixturesToCeiling()', ctx);
  assert.ok(moved >= 30, `移行で動いた器具が少なすぎる: ${moved}`);
  assert.equal(vm.runInContext('DATA.planFixes[PLAN_FIX_CEILING_FIXTURES]', ctx), 1,
    '済んだ印が書かれていない');

  // 屋外(玄関ポーチ)の器具は天井が無いので動かさない
  const outdoor = legacy.items.filter((it) => {
    if (!isFixture(it)) return false;
    ctx.__a = [it.floor || 1, it.x + it.w / 2, it.y + it.d / 2];
    return !vm.runInContext('roomAtPointOnFloor(__a[0],__a[1],__a[2])', ctx);
  });
  assert.ok(outdoor.length >= 1, '屋外の器具が1つも無いと、この検査は意味を持たない');
  outdoor.forEach((it) => assert.equal(it.elev, 2380, '屋外の器具まで動かしている'));

  // 2度目は走らない(利用者が意図して下げたペンダントを戻さないため)
  legacy.items.filter(isFixture).forEach((it) => { it.elev = 1500; });
  assert.equal(vm.runInContext('snapCeilingFixturesToCeiling()', ctx), 0,
    '移行が2度走っている = 利用者が下げた器具を天井へ戻してしまう');
  legacy.items.filter(isFixture).forEach((it) =>
    assert.equal(it.elev, 1500, '2度目で位置が書き換わっている'));
});
