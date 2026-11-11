// プランを開くときの補完を1つにまとめた normalizeLoadedPlan の検査。
// 関数を app-source から名前で切り出し、ensure* を「呼ばれた名前を積むだけ」の偽物にして動かす。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const src = require('./app-source.cjs').appSource();

function grabFunction(name) {
  const at = src.search(new RegExp('(^|\\n)function ' + name + '\\s*\\('));
  assert.notEqual(at, -1, 'function ' + name + ' が無い');
  const start = src.indexOf('function ' + name, at);
  let i = src.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('波括弧が閉じない: ' + name);
}

const NAMES = ['resetHeightGlobalsForPlanLoad', 'syncNorthFromPlan', 'ensureObjectIds',
  'ensureExteriorWallSettings', 'ensureInteriorWallSettings', 'ensureRoofAppearance',
  'ensureFloorMetadata', 'ensureHeightDefaults', 'syncHeightDefaultsUI',
  'syncExteriorWallSettings', 'normalizeLegacyFurnitureItems', 'restoreViewState'];

function setup(extra) {
  const calls = [];
  const warns = [];
  const sb = { DATA: { walls: [], rooms: [], items: [] }, console: { warn: (...a) => warns.push(a), info() {}, log() {} } };
  NAMES.forEach((n) => { sb[n] = () => { calls.push(n); }; });
  Object.assign(sb, extra || {});
  vm.createContext(sb);
  vm.runInContext(grabFunction('normalizeLoadedPlan'), sb);
  return { sb, calls, warns };
}

test('既定では決まった順番で全部呼ぶ', () => {
  const { sb, calls } = setup();
  const r = vm.runInContext('normalizeLoadedPlan()', sb);
  assert.deepEqual(calls, NAMES);
  assert.deepEqual([...r.warnings], []);
});

test('restoreView:false では restoreViewState を呼ばない', () => {
  const { sb, calls } = setup();
  vm.runInContext('normalizeLoadedPlan({restoreView:false})', sb);
  assert.deepEqual(calls, NAMES.filter((n) => n !== 'restoreViewState'));
});

test('resetHeights:false では resetHeightGlobalsForPlanLoad を呼ばない', () => {
  const { sb, calls } = setup();
  vm.runInContext('normalizeLoadedPlan({resetHeights:false})', sb);
  assert.deepEqual(calls, NAMES.filter((n) => n !== 'resetHeightGlobalsForPlanLoad'));
});

test('syncUi:false では syncHeightDefaultsUI を呼ばない', () => {
  const { sb, calls } = setup();
  vm.runInContext('normalizeLoadedPlan({syncUi:false})', sb);
  assert.deepEqual(calls, NAMES.filter((n) => n !== 'syncHeightDefaultsUI'));
});

test('形の検査の問題は warnings に入り、例外にしない', () => {
  const { sb, warns } = setup({ PlanSchema: { validatePlan: () => ['walls must be an array'] } });
  const r = vm.runInContext('normalizeLoadedPlan()', sb);
  assert.ok(r.warnings.includes('walls must be an array'));
  assert.equal(warns.length, 1);
});

test('validatePlan の本物の戻り値(errors と warnings)も文にして入れる', () => {
  const { sb } = setup({ PlanSchema: { validatePlan: () => ({ ok: false, errors: ['e1'], warnings: ['w1'] }) } });
  const r = vm.runInContext('normalizeLoadedPlan()', sb);
  assert.deepEqual([...r.warnings], ['e1', 'w1']);
});

test('validatePlan が例外を投げても読み込みを止めず、警告に入れる', () => {
  const { sb, calls } = setup({ PlanSchema: { validatePlan: () => { throw new Error('boom'); } } });
  const r = vm.runInContext('normalizeLoadedPlan()', sb);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /boom/);
  assert.deepEqual(calls, NAMES);
});

test('ensure* の例外は握りつぶさず呼び出し側へ伝える', () => {
  const { sb } = setup({ ensureObjectIds: () => { throw new Error('ensure failed'); } });
  assert.throws(() => vm.runInContext('normalizeLoadedPlan()', sb), /ensure failed/);
});
