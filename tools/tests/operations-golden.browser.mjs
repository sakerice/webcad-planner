// 画面の3つの操作 placeItem(物を置く)・delSel(選んだ物を消す)・updateSelectedProp(設定欄の値を変える)が、
// 今どんな結果を作るかの記録と照合。
//
// なぜ要るか: 段3でこの3つを assets/js/plan-core/operations.js へ移し、画面の関数はその包みに作り替える。
// 作り替えたあとも、置いた物・消えた物・変わった値が1項目も(項目の並びも)変わらないことを、
// 今の画面がそう作ったという記録と比べて確かめる。
//
// 土台: tools/tests/fixtures/house-2f.json を、白紙で起動してから「読込」(ファイル選択)で開く。
// 各ケースの前に、開いた直後のプランを JSON から入れ直し(normalizeLoadedPlan を通す)、
// ST(tool・floor・snap・shiftKey・placingRot・selected・複数選択・selectAll)と nextId を同じ値に戻す。
// Date.now は記録のあいだ決まった時刻を返すように差し替える。
//
// 見るもの
//   1. placeItem: 種類は ISIZES・FMP_ITEMS・LEGACY_FMP_TYPE_MAP のキー全部(factories-golden と同じ集め方)。
//      置く点は 1階の部屋の中(LDK)・1階の屋外(建物の東の敷地)・2階の部屋の中(洋室A)、回転 0 と 90。
//      記録は増えた物の JSON(無ければ null)。
//      加えて種類を 24 個に絞って、ST.shiftKey=true(物の端への吸着)を 3 点と「LDK の角の近く」で、
//      同じ角の近くで shiftKey=false も。階段の部材 3 種は既存の階段(id 1057)の下端のそばに置く。
//   2. delSel: 物1つ・壁1つ・部屋1つ・物と壁の複数選択・ロックした物を含む複数選択・ST.selectAll(1階・2階・
//      ロックした物がある1階)。記録は消えた id の並び、残った数、DATA.exteriorWallSettings。
//   3. updateSelectedProp: 設定欄が updateSelectedProp に渡しているキーをソースから全部拾い(plan-settable と
//      同じ拾い方に、'+q+' で組み立てている呼び出しと関数から直接呼んでいるものを足す)、さらに updateSelectedProp の
//      中で特別に扱うキー(windowTop・stairTarget・baseLevel)を足す。
//      対象は壁・部屋・窓・扉・階段・照明・普通の家具・外構の物の 8 つ。値はキーごとに「通常の値」と「偽の値」。
//      ロックした家具に locked・hidden3D・vis3D・w。記録は変更後の対象の JSON と、対象以外で変わった物・設定。
//
// 3D: 起動直後の 2D 表示では ren が null のままで、placeItem の build3D・delSel と updateSelectedProp の
// rebuild3D はどれも呼ばれない(呼ばれるのは if(ren) の中だけ)。差し替えはしていない。
// ren が null であることは記録の前に確かめる(3D が建っていたら、結果の速さと中身の前提が変わるので落とす)。
//
// 正解を作り直すのは、操作の結果を**意図して**変えたときだけ:
//   UPDATE_GOLDEN=1 PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh operations-golden
// 段3の中では作り直さない(計画書の Global Constraints)。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DIR = join(HERE, 'fixtures', 'operations');
const GOLDEN = join(DIR, 'golden.json');
const PLAN_FILE = join(HERE, 'fixtures', 'house-2f.json');
const APP = process.env.APP_URL || 'http://localhost:8932/';
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const T = { timeout: 60000 };

const FIXED_NOW = 1763251200000; // 2025-11-16T00:00:00Z
const NEXT_ID = 50000;

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// ── 設定欄のキーをソースから拾う ──
const PANEL_FILES = ['assets/js/app-state.js', 'assets/js/app-constants.js', 'assets/js/ceiling-designer.js', 'index.html'];
function panelKeys() {
  const src = PANEL_FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const out = new Set();
  // plan-settable と同じ: HTML の文字列の中の updateSelectedProp(\'key\'
  for (const m of src.matchAll(/updateSelectedProp\(\\'([A-Za-z0-9_]+)\\'/g)) out.add(m[1]);
  // '+q+' で組み立てている欄(手すりの意匠など)と、関数から直接呼んでいるもの('ceiling' など)
  for (const m of src.matchAll(/updateSelectedProp\((?:'\+q\+'|')([A-Za-z0-9_]+)/g)) out.add(m[1]);
  // updateSelectedProp の中で特別に扱うキー(欄からは直接渡していない)
  for (const k of ['windowTop', 'stairTarget', 'baseLevel']) out.add(k);
  return [...out].sort();
}

// キーごとの値: [通常の値, 偽の値]。偽の値はその欄に入り得るもの('' / 0 / false / null)。
// 選択肢の欄は、既定でない選択肢を通常の値にする。
const VALUES = {
  accessSteps: [3, 0],
  baseLevel: ['under', ''],
  ceiling: [{ type: 'flat', heightMm: 2300 }, null],
  ceilingColor: ['#e8e4dc', null],
  ceilingTexture: ['tex-ceiling-test', null],
  ceilingTextureFlipX: [true, false],
  ceilingTextureFlipY: [true, false],
  color: ['#336699', ''],
  columnHeight: [2100, 0],
  contextGhost: [true, false],
  contextHeight: [7200, 0],
  cove: [true, undefined],
  coveColor: ['#ffd9a0', ''],
  coveGap: [120, 0],
  coveIntensity: [0.8, 0],
  customHeight: [900, 0],
  d: [750, 0],
  doorFinish: ['bath-clear', ''],
  doorHeight: [2200, 0],
  doorOpenState: ['closed', ''],
  downspoutTop: [5200, 0],
  elev: [450, 0],
  extLen: [500, 0],
  fenceHeight: [1600, 0],
  fencePattern: ['horizontal', ''],
  fenceTopStyle: ['varied', ''],
  finishColors: [{ body: '#884422' }, null],
  finishRoughness: [{ body: 0.4 }, null],
  finishTextures: [{ body: 'oak' }, null],
  flipX: [true, false],
  flipY: [true, false],
  floorColor: ['#a08060', null],
  footOffsetMm: [300, 0],
  foundationFlashing: [true, false],
  foundationHeight: [600, 0],
  gapInfillColor: ['#cccccc', ''],
  gapInfillTexture: ['tex-gap-test', null],
  gasHeaterMount: [1200, 0],
  gutterMode: ['off', ''],
  hidden3D: [true, false],
  landingLevelMm: [1200, 0],
  latticeCap: [true, undefined],
  latticeHeight: [1800, 0],
  latticePitch: [90, 0],
  latticeSlat: [30, 0],
  lightAim: ['up', undefined],
  lightAngle: [45, 0],
  lightCastShadow: [true, false],
  lightColor: ['#ffcc88', ''],
  lightIntensity: [0.9, 0],
  lightRange: [6000, 0],
  lightShape: ['line', ''],
  locked: [true, false],
  n: ['テスト室', ''],
  name: ['テスト名', ''],
  pitch: [30, 0],
  railBars: [5, 0],
  railCapColor: ['#445566', ''],
  railFrameColor: ['#223344', ''],
  railInfill: ['wires', undefined],
  roofEdgeColor: ['#333333', ''],
  roofSkirt: [200, 0],
  roofThickness: [180, 0],
  roofType: ['hip', ''],
  rot: [90, 0],
  sashColor: ['#222222', ''],
  setback: [{ zone: 'r1-low', road: true, north: true }, null],
  shelfCount: [4, 0],
  shelfHeight: [1800, 0],
  shelfSides: ['both', undefined],
  showDoorHandle: [true, false],
  showDoorSlit: [true, false],
  showMirror: [true, false],
  siteSurface: ['gravel', ''],
  siteZones: [[{ name: '芝生', x: 100, y: 100, w: 2000, d: 1500, surface: 'grass' }], null],
  stairFloorMaterial: ['match', ''],
  stairOrder: [2, undefined],
  stairRail: ['both', undefined],
  stairRailMount: ['post', undefined],
  stairStyle: ['box', undefined],
  stairTarget: ['level', ''],
  targetHeight: [900, 0],
  texture: ['tex-floor-test', null],
  textureFlipX: [true, false],
  textureFlipY: [true, false],
  thick: [150, 0],
  vis3D: ['hide', ''],
  w: [1200, 0],
  wallBand: ['low', ''],
  wallHeight: [2600, 0],
  wallStyle: ['vertical-lattice', ''],
  wallTopShape: ['slope', ''],
  wallTopSide: ['start', ''],
  windowHeight: [1300, 0],
  windowKind: ['casement', ''],
  windowSill: [800, 0],
  windowTop: [2100, 0],
  x: [1234, 0],
  x1: [1234, 0],
  x2: [1234, 0],
  y: [1234, 0],
  y1: [1234, 0],
  y2: [1234, 0],
};

// 物の端への吸着・角の近くで見る種類(カテゴリが偏らないよう決め打ち)
const SHIFT_TYPES = [
  'bed-s', 'sofa', 'desk', 'dining-table', 'kitchen', 'fridge', 'toilet', 'bath', 'washer', 'closet',
  'shelf-built-in', 'tv', 'window', 'door-swing', 'door-slide', 'light-ceiling', 'column', 'fence',
  'original-sofa', 'original-kitchen-i2550', 'kominka-tansu-01', 'rpg-mansion-chair-01', 'fmp-Sofa16', 'fmp-Bed14',
];

// 対象にする物を凍結した間取りから決め打ちで選ぶ(id で渡す)
function pickTargets(plan) {
  const first = (arr, f, label) => { const o = arr.find(f); assert.ok(o, `フィクスチャに ${label} が無い`); return o.id; };
  const ldk = plan.rooms.find((r) => r.n === 'LDK' && r.floor === 1 && r.x === 2730 && r.y === 2730);
  assert.ok(ldk, 'フィクスチャに LDK が無い');
  return {
    wall: first(plan.walls, (w) => (w.floor || 1) === 1, '1階の壁'),
    room: ldk.id,
    window: first(plan.items, (i) => i.type === 'window' && i.floor === 1, '1階の窓'),
    door: first(plan.items, (i) => i.type === 'door-swing' && i.floor === 1, '1階の開き戸'),
    stair: first(plan.items, (i) => i.type === 'stair', '階段'),
    light: first(plan.items, (i) => i.type === 'light-ceiling' && i.floor === 1
      && i.x >= ldk.x && i.x <= ldk.x + ldk.w && i.y >= ldk.y && i.y <= ldk.y + ldk.d, 'LDK のシーリングライト'),
    furniture: first(plan.items, (i) => i.type === 'fmp-Sofa16', 'ソファ'),
    exterior: first(plan.items, (i) => i.type === 'fence', '塀'),
    lockedExtra: first(plan.items, (i) => i.type === 'tree', '木'),
    floor2Wall: first(plan.walls, (w) => w.floor === 2, '2階の壁'),
  };
}

// ── ページの中に記録用の道具を入れる ──
function installHelpers({ snapshot, fixedNow, nextIdBase }) {
  const mark = (k, v) => {
    if (k && k[0] === '_') return undefined;
    if (v === undefined) return '__undefined__';
    if (typeof v === 'number' && !isFinite(v)) return '__' + String(v) + '__';
    return v;
  };
  const clean = (o) => (o === null || o === undefined ? null : JSON.parse(JSON.stringify(o, mark)));
  const str = (o) => JSON.stringify(o, (k, v) => (k && k[0] === '_' ? undefined : v));
  const allObjects = () => DATA.walls.map((o) => ['wall', o]).concat(DATA.rooms.map((o) => ['room', o]), DATA.items.map((o) => ['item', o]));
  const byId = (id) => DATA.walls.concat(DATA.rooms, DATA.items).find((o) => o.id === id);
  const SETTINGS = ['exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'floorMetadata', 'heightDefaults', 'floors', 'exteriorDetail'];
  const realNow = Date.now;

  function restore(floor) {
    DATA = JSON.parse(snapshot);
    normalizeLoadedPlan({ restoreView: false });
    clearEditHistory();
    ST.view = '2d'; ST.tool = 'select'; ST.floor = floor; ST.snap = 10; ST.shiftKey = false;
    ST.placingRot = 0; ST.selected = null; clearMultiSelection(); ST.selectAll = false; ST.drawing = false; ST.drawPts = [];
    nextId = nextIdBase;
  }
  function withFixedNow(fn) {
    Date.now = () => fixedNow;
    try { return fn(); } finally { Date.now = realNow; }
  }
  function run(fn) {
    try { return fn(); } catch (e) { return { error: String(e && e.message || e) }; }
  }

  window.__op = {
    restore,
    // 1件置く。増えた物を返す
    place(type, pos, opts) {
      return withFixedNow(() => {
        restore(opts.floor);
        ST.placingRot = opts.rot; ST.shiftKey = !!opts.shift;
        const before = new Set(DATA.items);
        const beforeCounts = [DATA.walls.length, DATA.rooms.length, DATA.items.length];
        const err = run(() => { placeItem(type, pos.x, pos.y); return null; });
        const added = DATA.items.filter((o) => !before.has(o));
        const out = { item: added.length ? clean(added[0]) : null };
        if (added.length > 1) out.more = added.slice(1).map(clean);
        if (err) out.error = err.error;
        if (DATA.walls.length !== beforeCounts[0] || DATA.rooms.length !== beforeCounts[1]) out.otherCounts = [DATA.walls.length, DATA.rooms.length];
        out.nextIdDelta = nextId - nextIdBase;
        return out;
      });
    },
    placeBatch(types, pts) {
      const out = {};
      for (const type of types) {
        for (const p of pts) {
          const pos = p.near ? (() => {
            const sz = getItemDefaultSize((getOpeningModelToolPreset(type) || {}).baseType || type);
            return { x: p.near.x + sz.w / 2 + p.near.dx, y: p.near.y + sz.d / 2 + p.near.dy };
          })() : { x: p.x, y: p.y };
          out[type + '|' + p.key] = this.place(type, pos, p);
        }
      }
      return out;
    },
    // 階段の部材を既存の階段の下端のそばに置く
    placeStair(stairId) {
      const out = {};
      restore(1);
      const s = byId(stairId);
      const end = { x: s.x + s.w / 2, y: s.y + s.d };
      for (const type of ['stair', 'stair-corner', 'stair-landing']) {
        for (const rot of [0, 180]) {
          for (const [label, dx, dy] of [['near', 40, 70], ['far', 600, 900]]) {
            const sz = getItemDefaultSize(type);
            const pos = { x: end.x + dx, y: end.y + sz.d / 2 + dy };
            out[`${type}|${label}|rot${rot}`] = this.place(type, pos, { floor: 1, rot });
          }
        }
      }
      return out;
    },
    del(setup) {
      return withFixedNow(() => {
        restore(setup.floor || 1);
        (setup.lock || []).forEach((id) => setObjectLocked(byId(id), true));
        const snapBefore = allObjects().map(([kind, o]) => [kind, o.id, o]);
        if (setup.selectAll) ST.selectAll = true;
        if (setup.selected !== undefined) ST.selected = byId(setup.selected);
        if (setup.multi) ST.multiSelected = setup.multi.map(byId);
        const err = run(() => { delSel(); return null; });
        const alive = new Set(DATA.walls.concat(DATA.rooms, DATA.items));
        const out = {
          deleted: snapBefore.filter(([, , o]) => !alive.has(o)).map(([kind, id]) => kind + ':' + id),
          remaining: { walls: DATA.walls.length, items: DATA.items.length, rooms: DATA.rooms.length },
          exteriorWallSettings: clean(DATA.exteriorWallSettings),
          selected: ST.selected ? ST.selected.id : null,
          multiSelected: (ST.multiSelected || []).map((o) => o.id),
          selectAll: ST.selectAll,
        };
        if (err) out.error = err.error;
        return out;
      });
    },
    prop(targetId, key, value, opts) {
      return withFixedNow(() => {
        restore((byId(targetId) || {}).floor || 1);
        // restore のあとで byId を引き直す
        const target = byId(targetId);
        if (opts && opts.lock) setObjectLocked(target, true);
        const before = new Map(allObjects().map(([kind, o]) => [o, str(o)]));
        const settingsBefore = SETTINGS.map((k) => str(DATA[k]));
        const order = allObjects().map(([kind, o]) => o);
        ST.selected = target;
        const v = value === '__undefined__' ? undefined : value;
        const err = run(() => { updateSelectedProp(key, v, false); return null; });
        const out = { target: clean(target) };
        const others = [];
        for (const o of order) {
          if (o === target) continue;
          if (!DATA.walls.includes(o) && !DATA.rooms.includes(o) && !DATA.items.includes(o)) { others.push({ id: o.id, removed: true }); continue; }
          if (str(o) !== before.get(o)) others.push({ id: o.id, value: clean(o) });
        }
        const added = allObjects().filter(([, o]) => !before.has(o)).map(([kind, o]) => ({ kind, value: clean(o) }));
        if (others.length) out.others = others;
        if (added.length) out.added = added;
        const settings = {};
        SETTINGS.forEach((k, i) => { if (str(DATA[k]) !== settingsBefore[i]) settings[k] = clean(DATA[k]); });
        if (Object.keys(settings).length) out.settings = settings;
        if (err) out.error = err.error;
        return out;
      });
    },
  };
}

async function openWithPlan(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(APP);
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST, null, T);
  await page.locator('#preset-choice-modal.show').waitFor(T);
  await page.locator('.preset-blank-btn', { hasText: '白紙から始める' }).click();
  await page.waitForFunction(() => window.PRESET_CURRENT === 'blank' && _defaultPlanPending === false, null, T);
  await page.locator('#preset-choice-modal').waitFor({ state: 'hidden', ...T });
  // カタログ(FMP_ITEMS)が読み終わるのを、factories-golden と同じやり方で待つ
  await page.waitForFunction(() => typeof FMP_ITEMS === 'object' && Object.keys(FMP_ITEMS).length > 0
    && typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_FINISHES !== undefined, null, T);
  let last = -1, same = 0;
  for (let i = 0; i < 60 && same < 5; i++) {
    const n = await page.evaluate(() => Object.keys(FMP_ITEMS).length);
    same = n === last ? same + 1 : 0;
    last = n;
    await page.waitForTimeout(200);
  }
  assert.ok(same >= 5, 'FMP_ITEMS の件数が落ち着かない');
  // 凍結した間取りを「読込」で開く(既存の画面テストと同じ入れ方)
  const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', T),
    page.locator('.toolbar-actions button', { hasText: '読込' }).click(),
  ]);
  await chooser.setFiles(PLAN_FILE);
  await page.waitForFunction((n) => DATA.walls.length === n, plan.walls.length, T);
  await page.waitForTimeout(300);
  return { context, page, errors, plan };
}

// 正解ファイルは1ケース1行で書く(差分が読めるように、かつ字下げで膨らませないように)
function serialize(data) {
  const lines = ['{'];
  const sections = Object.keys(data);
  sections.forEach((s, si) => {
    const v = data[s];
    if (v && typeof v === 'object' && !Array.isArray(v) && s !== 'meta') {
      lines.push(` ${JSON.stringify(s)}: {`);
      const keys = Object.keys(v);
      keys.forEach((k, ki) => lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v[k])}${ki < keys.length - 1 ? ',' : ''}`));
      lines.push(` }${si < sections.length - 1 ? ',' : ''}`);
    } else {
      lines.push(` ${JSON.stringify(s)}: ${JSON.stringify(v)}${si < sections.length - 1 ? ',' : ''}`);
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

function describeDiff(want, got) {
  const out = [];
  const skipped = {};
  for (const s of Object.keys(want)) {
    if (s === 'meta') continue;
    const w = want[s], g = got[s] || {};
    const wk = Object.keys(w), gset = new Set(Object.keys(g));
    const common = wk.filter((k) => gset.has(k));
    // place はカタログの増減を許す(factories-golden と同じ)。それ以外は欠けたら落とす。
    if (s === 'place') {
      if (common.length < wk.length * 0.9) out.push(`place: 比べられるケースが少なすぎる: 記録 ${wk.length} / 共通 ${common.length}`);
    } else {
      for (const k of wk) if (!gset.has(k)) out.push(`${s}.${k}: 今の実行に無い`);
    }
    skipped[s] = { added: Object.keys(g).filter((k) => !(k in w)).length, removed: wk.length - common.length };
    for (const k of common) {
      if (JSON.stringify(w[k]) !== JSON.stringify(g[k])) {
        out.push(`${s}.${k}:\n      期待 ${JSON.stringify(w[k]).slice(0, 600)}\n      実際 ${JSON.stringify(g[k]).slice(0, 600)}`);
      }
    }
  }
  describeDiff.skipped = skipped;
  return out;
}

const browser = await chromium.launch();
let data;
try {
  const { context, page, errors, plan } = await openWithPlan(browser);
  try {
    const keys = panelKeys();
    const missingValues = keys.filter((k) => !(k in VALUES));
    assert.deepEqual(missingValues, [], '値を決めていない設定欄のキーがある。VALUES に足すこと: ' + missingValues.join(', '));
    const ids = pickTargets(plan);
    const snapshot = await page.evaluate(() => JSON.stringify(DATA, (k, v) => (k && k[0] === '_' ? undefined : v)));
    await page.evaluate(installHelpers, { snapshot, fixedNow: FIXED_NOW, nextIdBase: NEXT_ID });
    assert.equal(await page.evaluate(() => ren), null, '3D が建っている(この記録は 2D 表示のまま、3D を作らずに取る前提)');

    const types = await page.evaluate(() => Array.from(new Set([
      ...Object.keys(ISIZES), ...Object.keys(FMP_ITEMS), ...Object.keys(LEGACY_FMP_TYPE_MAP), 'no-such-type',
    ])).sort());
    const counts = await page.evaluate(() => ({ isizes: Object.keys(ISIZES).length, fmpItems: Object.keys(FMP_ITEMS).length, legacy: Object.keys(LEGACY_FMP_TYPE_MAP).length }));

    // ── 1. placeItem ──
    const PTS = [
      { key: 'f1-room|rot0', x: 4550, y: 4100, floor: 1, rot: 0 },
      { key: 'f1-room|rot90', x: 4550, y: 4100, floor: 1, rot: 90 },
      { key: 'f1-out|rot0', x: 9300, y: 3000, floor: 1, rot: 0 },
      { key: 'f1-out|rot90', x: 9300, y: 3000, floor: 1, rot: 90 },
      { key: 'f2-room|rot0', x: 1820, y: 1365, floor: 2, rot: 0 },
      { key: 'f2-room|rot90', x: 1820, y: 1365, floor: 2, rot: 90 },
    ];
    const place = {};
    const t0 = Date.now();
    for (let i = 0; i < types.length; i += 100) {
      Object.assign(place, await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [types.slice(i, i + 100), PTS]));
    }
    const tPlace = Date.now() - t0;
    // 端への吸着: LDK の左上の角(2730,2730)から少し離した位置。格子で寄ったあと、端が 80mm 以内に入る。
    const SHIFT_PTS = [
      { key: 'f1-room|shift', x: 4550, y: 4100, floor: 1, rot: 0, shift: true },
      { key: 'f1-out|shift', x: 9300, y: 3000, floor: 1, rot: 0, shift: true },
      { key: 'f2-room|shift', x: 1820, y: 1365, floor: 2, rot: 0, shift: true },
      { key: 'f1-corner|shift', near: { x: 2730, y: 2730, dx: 37, dy: 43 }, floor: 1, rot: 0, shift: true },
      { key: 'f1-corner|noshift', near: { x: 2730, y: 2730, dx: 37, dy: 43 }, floor: 1, rot: 0, shift: false },
    ];
    const missingShift = SHIFT_TYPES.filter((t) => !types.includes(t));
    assert.deepEqual(missingShift, [], '吸着を見る種類がカタログに無い');
    const placeShift = await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [SHIFT_TYPES, SHIFT_PTS]);
    const placeStair = await page.evaluate((id) => __op.placeStair(id), ids.stair);

    // ── 2. delSel ──
    const DEL = {
      'item': { selected: ids.furniture },
      'wall': { selected: ids.wall },
      'room': { selected: ids.room },
      'item+wall': { selected: ids.furniture, multi: [ids.wall] },
      'item+locked+wall': { selected: ids.furniture, multi: [ids.lockedExtra, ids.wall], lock: [ids.lockedExtra] },
      'locked-only': { selected: ids.lockedExtra, lock: [ids.lockedExtra] },
      'selectAll-f1': { selectAll: true, floor: 1 },
      'selectAll-f2': { selectAll: true, floor: 2 },
      'selectAll-f1-locked': { selectAll: true, floor: 1, lock: [ids.lockedExtra, ids.wall] },
    };
    const del = {};
    for (const [k, setup] of Object.entries(DEL)) del[k] = await page.evaluate(([s]) => __op.del(s), [setup]);

    // ── 3. updateSelectedProp ──
    const TARGETS = ['wall', 'room', 'window', 'door', 'stair', 'light', 'furniture', 'exterior'];
    const enc = (v) => (v === undefined ? '__undefined__' : v);
    const prop = {};
    const t1 = Date.now();
    for (const tk of TARGETS) {
      const jobs = [];
      for (const key of keys) {
        jobs.push([`${tk}|${key}|normal`, ids[tk], key, enc(VALUES[key][0]), null]);
        jobs.push([`${tk}|${key}|falsy`, ids[tk], key, enc(VALUES[key][1]), null]);
      }
      Object.assign(prop, await page.evaluate((js) => {
        const o = {};
        for (const [name, id, key, v, opts] of js) o[name] = __op.prop(id, key, v, opts);
        return o;
      }, jobs));
    }
    const tProp = Date.now() - t1;
    const lockedJobs = ['locked', 'hidden3D', 'vis3D', 'w'].flatMap((key) => [
      [`locked-furniture|${key}|normal`, ids.furniture, key, enc(VALUES[key][0]), { lock: true }],
      [`locked-furniture|${key}|falsy`, ids.furniture, key, enc(VALUES[key][1]), { lock: true }],
    ]);
    Object.assign(prop, await page.evaluate((js) => {
      const o = {};
      for (const [name, id, key, v, opts] of js) o[name] = __op.prop(id, key, v, opts);
      return o;
    }, lockedJobs));

    console.log(`  時間: placeItem ${types.length}種類×6 ${Math.round(tPlace / 1000)}秒 / updateSelectedProp ${Math.round(tProp / 1000)}秒`);
    data = {
      meta: { counts: Object.assign({ types: types.length, keys: keys.length }, counts), keys, ids, fixedNow: FIXED_NOW, nextIdBase: NEXT_ID },
      place, placeShift, placeStair, del, prop,
    };
    assert.equal(errors.length, 0, 'ページで例外: ' + errors.slice(0, 5).join(' / '));
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

// どのケースも例外で落ちていないこと(落ちたまま記録すると、何も見張らない)
const thrown = [];
for (const s of ['place', 'placeShift', 'placeStair', 'del', 'prop']) {
  for (const [k, v] of Object.entries(data[s])) if (v && v.error) thrown.push(`${s}.${k}: ${v.error}`);
}
assert.deepEqual(thrown, [], '操作の途中で例外が出たケースがある');
// placeItem は、置けたときは nextId を 1 だけ進め、置けなかったときは進めない
for (const [k, v] of Object.entries(data.place)) {
  assert.equal(v.nextIdDelta, v.item ? 1 : 0, `${k}: nextId の進み方`);
}

const text = serialize(data);
if (UPDATE) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(GOLDEN, text);
  const n = (s) => Object.keys(data[s]).length;
  console.log(`正解を書き出した: ${GOLDEN} (${(Buffer.byteLength(text) / 1e6).toFixed(2)}MB; place ${n('place')}・placeShift ${n('placeShift')}・placeStair ${n('placeStair')}・del ${n('del')}・prop ${n('prop')})`);
} else {
  assert.ok(existsSync(GOLDEN), 'golden.json が無い');
  const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const diff = describeDiff(want, data);
  assert.equal(diff.length, 0, `今の結果が正解と違う (${diff.length}件):\n    ` + diff.slice(0, 15).join('\n    '));
  const n = (s) => Object.keys(want[s]).length;
  console.log(`placeItem ${n('place')}+${n('placeShift')}+${n('placeStair')}・delSel ${n('del')}・updateSelectedProp ${n('prop')} ケースが、記録と一致した`);
  const sk = describeDiff.skipped;
  const extra = Object.entries(sk).filter(([, v]) => v.added || v.removed);
  if (extra.length) console.log('  (記録に無い・今は無いので比べていないケース: ' + extra.map(([s, v]) => `${s} +${v.added}/-${v.removed}`).join(', ') + ')');
}
