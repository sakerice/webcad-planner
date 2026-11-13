// 共同編集で相手の変更を受けたとき(applySharedPatch)に、こちらの視点と壁の高さの全体の値を
// 動かさないこと。applySharedPatch は開くときの補完 normalizeLoadedPlan を通すが、
// 編集中に差分を当てるだけなので restoreView:false・resetHeights:false で呼ぶ。
// 既定のまま呼ぶと、相手が1つ動かすたびに、こちらの画面が保存時の視点へ飛ぶ。
//
// applySharedPatch と normalizeLoadedPlan を本物のまま名前で切り出し、補完の中身
// (ensure* ほか)だけを「呼ばれた名前を積む」偽物にして動かす。
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

const COMPLETIONS = ['resetHeightGlobalsForPlanLoad', 'syncNorthFromPlan', 'ensureObjectIds',
  'ensureExteriorWallSettings', 'ensureInteriorWallSettings', 'ensureRoofAppearance',
  'ensureFloorMetadata', 'ensureHeightDefaults', 'syncHeightDefaultsUI',
  'syncExteriorWallSettings', 'normalizeLegacyFurnitureItems', 'restoreViewState'];

function setup() {
  const calls = [], options = [];
  const sb = {
    DATA: { walls: [{ id: 1, x1: 0, y1: 0, x2: 1000, y2: 0 }], items: [], rooms: [], viewState: { twoD: { zoom: 9, panX: 1, panY: 2 } } },
    ST: { selected: null, zoom: 0.5, panX: 300, panY: 400 },
    SHARED: { applying: false, baseline: null },
    console: { warn() {}, info() {}, log() {} },
    document: { getElementById: () => ({ classList: { remove() {} } }) },
    sharedCollectionNameFor: () => null,
    sharedClone: (v) => JSON.parse(JSON.stringify(v)),
    clearMultiSelection() {}, clearEditHistory() { calls.push('clearEditHistory'); }, draw2d() {}, updateProps() {},
    sharedSchedule3DRefresh() {}, sharedBaselineFrom: () => ({}), markDirtyUiOnly() {},
  };
  COMPLETIONS.forEach((n) => { sb[n] = () => { calls.push(n); }; });
  // 本物の restoreViewState と同じく、保存された視点を ST へ写す偽物
  sb.restoreViewState = () => { calls.push('restoreViewState'); const v = sb.DATA.viewState.twoD; sb.ST.zoom = v.zoom; sb.ST.panX = v.panX; sb.ST.panY = v.panY; };
  vm.createContext(sb);
  vm.runInContext(grabFunction('normalizeLoadedPlan'), sb);
  vm.runInContext(grabFunction('applySharedPatch'), sb);
  // 渡された options も記録する（本物の normalizeLoadedPlan はそのまま呼ぶ）
  vm.runInContext('var __real=normalizeLoadedPlan; normalizeLoadedPlan=function(o){ __options.push(o); return __real(o); };', Object.assign(sb, { __options: options }));
  return { sb, calls, options };
}

const PATCH = { collections: { walls: { upserts: [{ id: 2, x1: 0, y1: 0, x2: 0, y2: 1000 }], removes: [] } }, fields: { northDeg: 30 } };

test('相手の変更を受けても、こちらの視点は動かない', () => {
  const { sb, calls } = setup();
  vm.runInContext('applySharedPatch(' + JSON.stringify(PATCH) + ', false)', sb);
  assert.equal(sb.DATA.walls.length, 2, 'patch が当たっていない');
  assert.ok(!calls.includes('restoreViewState'), '視点を保存時の値へ戻している: ' + calls.join(','));
  assert.deepEqual([sb.ST.zoom, sb.ST.panX, sb.ST.panY], [0.5, 300, 400]);
});

test('applySharedPatch は normalizeLoadedPlan を restoreView:false・resetHeights:false で1回呼ぶ', () => {
  const { sb, calls, options } = setup();
  vm.runInContext('applySharedPatch(' + JSON.stringify(PATCH) + ', false)', sb);
  assert.equal(options.length, 1);
  assert.equal(options[0].restoreView, false);
  assert.equal(options[0].resetHeights, false);
  assert.ok(!calls.includes('resetHeightGlobalsForPlanLoad'));
  // 高さの欄の描き直しと古い家具の補完は、今までどおり通す
  assert.ok(calls.includes('syncHeightDefaultsUI'));
  assert.ok(calls.includes('normalizeLegacyFurnitureItems'));
  // 履歴は今までどおり、補完のあとで捨てる
  assert.ok(calls.indexOf('clearEditHistory') > calls.indexOf('normalizeLegacyFurnitureItems'));
});
