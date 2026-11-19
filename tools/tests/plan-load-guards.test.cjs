// プランを画面に入れる前に形をそろえる処理(assets/js/plan-schema.js の tidyPlan・loadProblem)と、
// 画面のどの入口もそれを通ることを確かめる。
//
//   1. 壊れた・攻撃のプランの固定集(fixtures/injection/plans.json)を通すと、例外が出ず、
//      walls・items・rooms が素のオブジェクトの配列になり、座標と階が有限の数で範囲に入り、
//      危ない鍵が残らず、Object.prototype が汚れない。
//   2. 手元の正当なプラン(固定プラン・互換の保存データ。既定プランで保存した物を含む)は1バイトも変わらない。
//   3. 知らない欄・座標の端数・壁厚の数の文字は残る。
//   4. 大きすぎるプランは loadProblem が利用者向けの文で断る。上限ちょうどは通す。
//   5. 入口(ファイルの読み込み・自動保存の復元・一覧・比較・共有の部屋・開く経路の補完・写し)が、
//      tidyLoadedPlan / planLoadProblem を呼んでいる(ソースを読んで確かめる)。
//   6. 画面の normalizeLoadedPlan を本物の ensure* と一緒に vm で動かし、固定集で例外が出ない。
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
const PlanCorePatch = require(join(ROOT, 'assets', 'js', 'plan-core', 'patch.js'));
const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'injection', 'plans.json'), 'utf8'));

const UNSAFE = ['__proto__', 'constructor', 'prototype'];
const protoKeys = () => Object.getOwnPropertyNames(Object.prototype).sort().join(',');
const PROTO_BEFORE = protoKeys();

function parseCase(c) {
  return c.json !== undefined ? JSON.parse(c.json) : JSON.parse(JSON.stringify(c.plan));
}

function hasUnsafeOwnKey(v) {
  const stack = [v];
  while (stack.length) {
    const x = stack.pop();
    if (!x || typeof x !== 'object') continue;
    for (const k of UNSAFE) if (Object.prototype.hasOwnProperty.call(x, k)) return true;
    for (const k of Object.keys(x)) stack.push(x[k]);
  }
  return false;
}

// そろえたあとの形の決まり。ふつうのプランにも攻撃のプランにも同じ物を当てる。
function assertShape(plan, label) {
  const COORDS = { walls: ['x1', 'y1', 'x2', 'y2'], rooms: ['x', 'y', 'w', 'd'], items: ['x', 'y'] };
  for (const name of ['walls', 'items', 'rooms']) {
    assert.ok(Array.isArray(plan[name]), `${label}: ${name} が配列でない`);
    plan[name].forEach((o, i) => {
      assert.ok(o && typeof o === 'object' && !Array.isArray(o), `${label}: ${name}[${i}] が素のオブジェクトでない`);
      for (const k of COORDS[name]) {
        const v = o[k];
        if (v === undefined || v === null || v === '') continue;   // 古い保存データ(部屋の検査と同じく残す)
        assert.ok(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9, `${label}: ${name}[${i}].${k}=${v}`);
      }
      if (o.floor !== undefined && o.floor !== null) {
        const f = Number(o.floor);
        assert.ok((typeof o.floor === 'number' || typeof o.floor === 'string') && Number.isFinite(f) && f >= PlanSchema.TIDY_FLOOR_MIN && f <= PlanSchema.TIDY_FLOOR_MAX, `${label}: ${name}[${i}].floor=${o.floor}`);
      }
      for (const k of PlanSchema.SCALAR_KEYS) {
        assert.ok(!(o[k] !== null && typeof o[k] === 'object'), `${label}: ${name}[${i}].${k} がオブジェクトのまま`);
      }
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && !v.startsWith('data:')) assert.ok(v.length <= PlanSchema.TIDY_MAX_TEXT, `${label}: ${name}[${i}].${k} が長すぎる`);
      }
    });
  }
  assert.ok(!hasUnsafeOwnKey(plan), `${label}: 危ない鍵が残っている`);
  assert.equal(protoKeys(), PROTO_BEFORE, `${label}: Object.prototype に鍵が増えた`);
  assert.equal(({}).polluted, undefined, `${label}: Object.prototype が汚れた`);
}

test('固定集: 例外が出ず、形がそろい、Object.prototype が汚れない', () => {
  for (const c of FIX.plans) {
    const plan = parseCase(c);
    const before = JSON.stringify(plan);
    let r;
    assert.doesNotThrow(() => { r = PlanSchema.tidyPlan(plan); }, c.id);
    assertShape(plan, c.id);
    const e = c.expect;
    assert.equal(plan.walls.length, e.walls, c.id + ' walls');
    assert.equal(plan.items.length, e.items, c.id + ' items');
    assert.equal(plan.rooms.length, e.rooms, c.id + ' rooms');
    for (const [name, i, k, want] of e.numbers || []) assert.equal(plan[name][i][k], want, `${c.id}: ${name}[${i}].${k}`);
    for (const [name, i, k] of e.absent || []) assert.ok(!(k in plan[name][i]), `${c.id}: ${name}[${i}].${k} が残っている`);
    if (e.unchanged) {
      assert.equal(JSON.stringify(plan), before, c.id + ': 変えてはいけないのに変わった');
      assert.equal(r.changed, 0, c.id);
    } else {
      assert.ok(r.changed > 0, c.id + ': 何も変えていない');
    }
    // 捨てた物の数は dropped と同じで、知らせる数 lost に入る
    const dropped = r.dropped.walls + r.dropped.items + r.dropped.rooms;
    assert.ok(r.lost >= dropped, c.id + ': lost が捨てた数より少ない');
  }
});

test('設定の入れ物: 形の違う物は消え、正しい中身は残る', () => {
  const plan = parseCase(FIX.plans.find((c) => c.id === 'settings-wrong-types'));
  PlanSchema.tidyPlan(plan);
  assert.ok(!('exteriorWallSettings' in plan));
  assert.ok(!('whole' in plan.interiorWallSettings));
  assert.ok(!('floors' in plan.interiorWallSettings));
  assert.ok(!('faces' in plan.interiorWallSettings));
  assert.deepEqual(plan.interiorWallSettings.walls, { 2: { color: '#ffffff' } });
  assert.ok(!('floors' in plan.roofAppearance));
  assert.deepEqual(plan.floorMetadata, { 2: { use: 'living' } });
  for (const k of ['heightDefaults', 'exteriorDetail', 'viewState', 'floors', 'northDeg']) assert.ok(!(k in plan), k + ' が残っている');
});

test('知らない欄・端数・壁厚の数の文字は変えない', () => {
  const plan = parseCase(FIX.plans.find((c) => c.id === 'unknown-fields-kept'));
  PlanSchema.tidyPlan(plan);
  assert.deepEqual(plan.futureField, { a: 1 });
  assert.equal(plan.walls[0].x1, 0.25);
  assert.equal(plan.walls[0].thick, '120');
  assert.deepEqual(plan.walls[0].futureWallProp, [1, 2]);
  assert.equal(plan.items[0].futureProp, 'x');
  assert.equal(plan.items[0].x, 1500.5);
  assert.equal(plan.rooms[0].floor, 1.5);
});

test('長すぎる文字は TIDY_MAX_TEXT 字で切り、画像の data: URL とそれまでの長さの名前は切らない', () => {
  const MAX = PlanSchema.TIDY_MAX_TEXT;
  const longName = 'あ'.repeat(2000000);
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(MAX + 50000);
  const atMax = '名'.repeat(MAX);
  const plan = { walls: [], items: [{ id: 1, type: 'sofa', x: 0, y: 0, texture: dataUrl, label: atMax }], rooms: [{ id: 'rm2', n: longName, x: 0, y: 0, w: 1000, d: 1000 }], planName: longName };
  const t0 = Date.now();
  const r = PlanSchema.tidyPlan(plan);
  assert.ok(Date.now() - t0 < 2000, 'そろえるのに時間がかかりすぎる');
  assert.equal(plan.rooms[0].n.length, MAX);
  assert.equal(plan.planName.length, MAX);
  assert.equal(plan.items[0].texture, dataUrl);
  assert.equal(plan.items[0].label, atMax);
  assert.equal(r.lost, 2, '切った2つを知らせる数に入れる');
});

test('手元の正当なプランは1バイトも変わらない', () => {
  const files = [
    ...readdirSync(join(__dirname, 'fixtures', 'compat')).filter((f) => f.endsWith('.json') && f !== 'golden.json').map((f) => join(__dirname, 'fixtures', 'compat', f)),
    join(__dirname, 'fixtures', 'house-2f.json'),
    join(__dirname, 'fixtures', 'review23-house-2f.json'),
    join(__dirname, 'fixtures', 'raised-floor-plan.json'),
  ];
  // 既定プランそのものはテストで読まない決まり(fixture-only.test.cjs)。本番の既定プランで保存した物は compat に入っている
  assert.ok(files.length >= 7);
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const plan = JSON.parse(raw);
    const r = PlanSchema.tidyPlan(plan);
    assert.equal(r.changed, 0, f);
    assert.equal(JSON.stringify(plan), JSON.stringify(JSON.parse(raw)), f);
    assert.equal(PlanSchema.loadProblem(plan), null, f);
  }
});

test('大きいプランは確認の文を出し、画面が扱えない桁だけ断る', () => {
  const warnAt = PlanSchema.LIMITS.MAX_LOAD_OBJECTS;
  const refuseAt = PlanSchema.LIMITS.MAX_OPEN_OBJECTS;
  const make = (n) => ({ walls: [], rooms: [], items: { length: n } });
  const real = (n) => ({ walls: [], rooms: [], items: Array.from({ length: n }, (_, i) => ({ id: i + 1, type: 'sofa', x: i, y: 0 })) });
  assert.equal(PlanSchema.loadWarning(real(warnAt)), null);
  assert.equal(PlanSchema.loadProblem(real(warnAt)), null);
  const warn = PlanSchema.loadWarning(real(warnAt + 1));
  assert.match(warn, /時間がかかります。開きますか？/);
  assert.match(warn, new RegExp(String(warnAt + 1)));
  assert.doesNotMatch(warn, /items|walls|rooms|JSON|undefined/);
  assert.equal(PlanSchema.loadProblem(real(warnAt + 1)), null, '確認の大きさでは断らない');
  const big = { walls: [], rooms: [], items: new Array(refuseAt + 1).fill(null) };
  assert.match(PlanSchema.loadProblem(big), /大きすぎるため開けません/);
  assert.equal(PlanSchema.loadProblem({ walls: [], rooms: [], items: new Array(refuseAt).fill(null) }), null);
  void make;
  assert.match(PlanSchema.loadProblem('abc'), /開けません/);
  assert.match(PlanSchema.loadProblem(null), /開けません/);
  assert.match(PlanSchema.loadProblem([]), /開けません/);
  // 確認の線は手元の正当なプランの最大(287 個)より十分大きく、断る線は部屋の検査の配列の上限と同じ
  assert.ok(warnAt >= 287 * 5);
  assert.equal(refuseAt, 50000);
});

test('文字・数のはずの欄の表は1か所(部屋の検査も同じ表を見る)', () => {
  const guard = read('worker/room-guard.mjs');
  assert.match(guard, /const SCALAR_KEYS = PlanSchema\.SCALAR_KEYS;/);
  assert.ok(PlanSchema.SCALAR_KEYS.includes('n') && PlanSchema.SCALAR_KEYS.includes('floor'));
});

test('危ない id の一覧は差分の当て方(patch.js)と同じ', () => {
  assert.deepEqual([...PlanSchema.TIDY_UNSAFE_IDS].sort(), [...PlanCorePatch.UNSAFE_KEYS].sort());
});

// 画面のソースから関数の本文を切り出す(文字列とコメントを飛ばして波括弧を数える)。
const src = require('./app-source.cjs').appSource();
function functionBody(text, header) {
  const at = text.indexOf(header);
  assert.notEqual(at, -1, header + ' が無い');
  let i = text.indexOf('{', at), depth = 0, mode = null;
  for (; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(at, i + 1); }
  }
  throw new Error('閉じない: ' + header);
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('どの入口も、形をそろえる処理と大きさの確かめを通る', () => {
  // 丸ごと入れ替える入口: 先に大きさを見る
  const replace = [
    ['index.html', 'function doImport('],
    ['index.html', 'async function loadPlanFromStorage('],
    ['index.html', 'function installSharedPlan('],
    ['assets/js/plan-library.js', 'function loadIntoEditor('],
    ['assets/js/compare-mode.js', 'function start(planB'],
  ];
  for (const [file, header] of replace) {
    const body = functionBody(read(file), header);
    if (header === 'function installSharedPlan(') {
      assert.match(body, /PlanSchema\.loadProblem\(plan\)/, '共有の部屋が開けない桁を見ていない');
      assert.match(body, /!resuming&&[^;]*PlanSchema\.loadWarning\(plan\)/, '共有の部屋に初めて入るときだけ確かめていない');
    } else {
      assert.match(body, /planLoadAllowed\(/, `${file} ${header} が大きさを見ていない`);
    }
  }
  // 起動時の復元で開かなかったら、保存の枠を自動では上書きしない
  assert.match(functionBody(read('index.html'), 'async function loadPlanFromStorage('), /STORAGE_KEEP_SAVED=true; return null;/);
  assert.match(functionBody(read('index.html'), 'async function sharedAutoSaveLocal('), /if\(STORAGE_KEEP_SAVED\)return;/);
  assert.match(functionBody(read('index.html'), 'async function savePlanToStorage('), /if\(STORAGE_KEEP_SAVED\)\{\s*if\(!confirm\(/);
  // 形をそろえる: normalizeLoadedPlan の最初・共有の部屋・写し
  const norm = functionBody(read('assets/js/app-state.js'), 'function normalizeLoadedPlan(');
  assert.match(norm, /tidyLoadedPlan\(DATA\)/);
  assert.ok(norm.indexOf('tidyLoadedPlan(DATA)') < norm.indexOf('ensureObjectIds()'), 'ensure* より先にそろえる');
  assert.match(functionBody(read('index.html'), 'function installSharedPlan('), /tidyLoadedPlan\(loaded\.plan\)/);
  assert.match(read('assets/js/plan-snapshot.js'), /tidyLoadedPlan\(DATA, \{ quiet: true \}\)/);
  // そのほかの入口は normalizeLoadedPlan を呼ぶ(相手の差分・読み取り・チャット・既定プラン・自動保存・一覧・ファイル)
  assert.match(functionBody(read('index.html'), 'function applySharedPatch('), /normalizeLoadedPlan\(/);
  assert.match(read('assets/js/plan-import.js'), /normalizeLoadedPlan\(\{ resetHeights: false, restoreView: false \}\)/);
  assert.match(read('assets/js/chat/chat-ui.js'), /call\('normalizeLoadedPlan'/);
  // プランを DATA へ丸ごと入れる所は、ここに挙げた物だけ(増えたら、そろえる処理を通すか確かめてここに足す)
  const assigns = [];
  for (const rel of ['index.html', ...readdirSync(join(ROOT, 'assets', 'js')).filter((f) => f.endsWith('.js')).map((f) => 'assets/js/' + f),
    ...readdirSync(join(ROOT, 'assets', 'js', 'chat')).filter((f) => f.endsWith('.js')).map((f) => 'assets/js/chat/' + f)]) {
    read(rel).split('\n').forEach((line, i) => {
      if (/(^|[^.\w])DATA\s*=\s*(?!=)/.test(line) && !/\bvar DATA\b/.test(line)) assigns.push(rel);
    });
  }
  const counts = assigns.reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m; }, {});
  assert.deepEqual(counts, {
    'index.html': 5,                    // 取り消し(自分の写し)・自動保存の復元(と失敗時の空)・共有の部屋・ファイル
    'assets/js/plan-data.js': 3,        // 読み取りの作業面の入れ替え(2)・白紙
    'assets/js/plan-library.js': 1,     // 一覧
    'assets/js/plan-snapshot.js': 1,    // 写し
  });
});

// 6. 画面の normalizeLoadedPlan を vm で動かす。ensure* は「呼ばれた時点のプランの形」を確かめる偽物にする
//    (本物の ensure* は画面の定数を多く使うので、本物を通す確かめは画面テスト plan-load-guards.browser.mjs で行う)。
test('画面の normalizeLoadedPlan は、ensure* より先に形をそろえる', () => {
  const vm = require('node:vm');
  const grab = (name) => functionBody(src, '\nfunction ' + name + '(').slice(1);
  const seen = [];
  const notices = [];
  const sb = { PlanSchema, console: { warn() {}, log() {}, info() {}, error() {} }, showPlanNotice: (t) => notices.push(t) };
  vm.createContext(sb);
  vm.runInContext('var PLAN_TIDY_LAST=null;', sb);
  vm.runInContext(grab('tidyLoadedPlan'), sb);
  vm.runInContext(grab('planTidyNoticeText'), sb);
  vm.runInContext(grab('normalizeLoadedPlan'), sb);
  sb.__check = (label) => { assertShape(sb.DATA, label); seen.push(label); };
  for (const n of ['resetHeightGlobalsForPlanLoad', 'syncNorthFromPlan', 'ensureObjectIds', 'ensureExteriorWallSettings', 'ensureInteriorWallSettings',
    'ensureRoofAppearance', 'ensureFloorMetadata', 'ensureHeightDefaults', 'syncHeightDefaultsUI', 'syncExteriorWallSettings',
    'normalizeLegacyFurnitureItems', 'restoreViewState']) {
    vm.runInContext('function ' + n + '(){ __check(' + JSON.stringify(n) + '); }', sb);
  }
  for (const c of FIX.plans) {
    // vm の中の JSON.parse で作る(__proto__ を自分の鍵として保つ)
    sb.__src = c.json !== undefined ? c.json : JSON.stringify(c.plan);
    vm.runInContext('DATA = JSON.parse(__src)', sb);
    assert.doesNotThrow(() => vm.runInContext('normalizeLoadedPlan({restoreView:false})', sb), c.id);
  }
  assert.ok(seen.includes('ensureObjectIds'));
  assert.equal(vm.runInContext('({}).polluted', sb), undefined);
  // 捨てた・消した部分があった固定集では、利用者向けの1行の知らせが出る(開発の用語なし)。変えない固定集では出ない
  const lossy = FIX.plans.filter((c) => !c.expect.unchanged).length;
  assert.ok(notices.length >= lossy - 2, '知らせが出ていない: ' + notices.length);
  for (const t of notices) {
    assert.match(t, /^開けない部分が \d+ 個あったため、その部分を除いて開きました。$/);
  }
});
