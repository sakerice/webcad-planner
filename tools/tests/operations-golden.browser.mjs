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
//      ロックした物がある1階・全部ロックした3階)・何も選んでいない・再生中の歩く道(WALKTHROUGH の分岐。3D が無いので
//      stopWalkthrough はカメラに触らずに済む)。記録は消えた id の並び、残った数と id の並び、DATA.exteriorWallSettings、
//      対象以外で変わった物と設定、取り消しの履歴の増え方。
//   1b. placeOpening: 開口のツール種類(opening-door-model:… / opening-window-model:…)。default・small・
//      bath-clear-swing・bath-clear-fold・window の default・fix・window-door と、カタログの扉・玄関扉・窓のモデル全部を、
//      上の 6 通り(3 点 × 回転)で置く。placeColumn: 1階の洋室に段差(skipLevelMm 600 / 300 / 無し)を付けて column・column-round を置く。
//      place 系はどれも、呼んだあとの ST.tool・選択の id・placingRot、対象以外で変わった物と設定、取り消しの履歴の増え方も記録する。
//   3. updateSelectedProp: 設定欄が updateSelectedProp に渡しているキーをソースから全部拾い(plan-settable と
//      同じ拾い方に、'+q+' で組み立てている呼び出しと関数から直接呼んでいるものを足す)、さらに updateSelectedProp の
//      中で特別に扱うキー(windowTop・stairTarget・baseLevel)を足す。
//      対象は壁・部屋・窓・扉・階段・照明・普通の家具・外構の物の 8 つ。値はキーごとに「通常の値」と「偽の値」。
//      ロックした家具に locked・hidden3D・vis3D・w。色のキーには noSave=true と、色の入力欄に焦点がある状態
//      (keepColorPickerOpen の分岐)も。記録は呼んだあとに id で引き直した対象の JSON と、対象以外で変わった物・設定、
//      取り消しの履歴の増え方。exteriorColor・exteriorTexture は別の関数から呼ぶので、拾う一覧に手で足している。
//
// 比べ方: meta.counts(種類・キー・開口の種類・ケースの数)とケースの集合が完全に一致し、各ケースの中身が同じこと。
// 違ったときは、ケース名と、違った欄ごとの「正解 / 実際」を先頭 20 ケースまで出す。
// 「対象以外で変わった物」は、キーが無いのと undefined を区別して比べる。
// OPS_REVERSE=1 で、ケースを逆順に流す(順番への依存が無いかを見るため。常設の検査ではない)。
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
import { watch3dSkips, assertNo3dSkips, read3dSkips } from './build3d-skips.mjs';

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
  // 外壁の色・テクスチャ(壁の外壁設定へも書く分岐)。欄は別の関数から呼ぶので上の拾い方に掛からない
  for (const k of ['exteriorColor', 'exteriorTexture']) out.add(k);
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
  exteriorColor: ['#8899aa', ''],
  exteriorTexture: ['tex-exterior-test', null],
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

// 記録の区分
const SECTIONS = ['place', 'placeShift', 'placeStair', 'placeOpening', 'placeColumn', 'del', 'prop'];
// noSave=true と色の入力欄に焦点がある状態を見る、色のキーと対象
const COLOR_CASES = [['furniture', 'color'], ['wall', 'color'], ['wall', 'exteriorColor'], ['room', 'floorColor'], ['room', 'ceilingColor'], ['light', 'lightColor']];

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
    // 柱を置くときに段差を付ける部屋(1階の洋室。中心 1365,5460)
    skipRoom: first(plan.rooms, (r) => r.n === '洋室' && r.floor === 1 && r.x === 0 && r.y === 3640, '1階の洋室'),
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
  // 比べるための文字列。キーが無いのと値が undefined なのを区別する(mark で undefined に印を付ける)。
  const str = (o) => JSON.stringify(o === undefined ? '__undefined__' : o, mark);
  const allObjects = () => DATA.walls.map((o) => ['wall', o]).concat(DATA.rooms.map((o) => ['room', o]), DATA.items.map((o) => ['item', o]));
  const byId = (id) => DATA.walls.concat(DATA.rooms, DATA.items).find((o) => o.id === id);
  // 前からの記録の欄(settings)が見る設定。これ以外の DATA の欄は otherData に分けて記録する。
  const SETTINGS = ['exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'floorMetadata', 'heightDefaults', 'floors', 'exteriorDetail'];
  const PLAN_ARRAYS = ['walls', 'rooms', 'items'];
  const realNow = Date.now;

  function restore(floor) {
    DATA = JSON.parse(snapshot);
    normalizeLoadedPlan({ restoreView: false });
    clearEditHistory();
    ST.view = '2d'; ST.tool = 'select'; ST.floor = floor; ST.snap = 10; ST.shiftKey = false;
    ST.placingRot = 0; ST.selected = null; clearMultiSelection(); ST.selectAll = false; ST.drawing = false; ST.drawPts = [];
    ST.appearanceColorDirty = false;
    _activeAppearanceColorInput = null;
    WALKTHROUGH = null;
    nextId = nextIdBase;
  }
  function withFixedNow(fn) {
    Date.now = () => fixedNow;
    try { return fn(); } finally { Date.now = realNow; }
  }
  function run(fn) {
    try { return fn(); } catch (e) { return { error: String(e && e.message || e) }; }
  }
  // 呼ぶ前の状態を覚え、呼んだあとに「対象以外で変わった物」と設定の差分を返す
  function watch(exclude, opts) {
    const skipRemoved = !!(opts && opts.skipRemoved);
    const order = allObjects().map(([, o]) => o);
    const before = new Map(order.map((o) => [o, str(o)]));
    const settingsBefore = SETTINGS.map((k) => str(DATA[k]));
    const otherKeys = () => Object.keys(DATA).filter((k) => !PLAN_ARRAYS.includes(k) && !SETTINGS.includes(k));
    const otherBefore = new Map(otherKeys().map((k) => [k, str(DATA[k])]));
    const histBefore = HISTORY.length;
    return function diff(out) {
      const others = [];
      const alive = new Set(DATA.walls.concat(DATA.rooms, DATA.items));
      for (const o of order) {
        if (exclude && exclude(o)) continue;
        if (!alive.has(o)) { if (!skipRemoved) others.push({ id: o.id, removed: true }); continue; } // del は deleted に記録する
        if (str(o) !== before.get(o)) others.push({ id: o.id, value: clean(o) });
      }
      const added = allObjects().filter(([, o]) => !before.has(o) && !(exclude && exclude(o))).map(([kind, o]) => ({ kind, value: clean(o) }));
      if (others.length) out.others = others;
      if (added.length) out.added = added;
      const settings = {};
      SETTINGS.forEach((k, i) => { if (str(DATA[k]) !== settingsBefore[i]) settings[k] = clean(DATA[k]); });
      if (Object.keys(settings).length) out.settings = settings;
      const otherData = {};
      const keys = new Set([...otherBefore.keys(), ...otherKeys()]);
      for (const k of keys) {
        const now = k in DATA ? str(DATA[k]) : '__missing__';
        if (now !== (otherBefore.has(k) ? otherBefore.get(k) : '__missing__')) otherData[k] = k in DATA ? clean(DATA[k]) : '__missing__';
      }
      if (Object.keys(otherData).length) out.otherData = otherData;
      out.historyDelta = HISTORY.length - histBefore;
      return out;
    };
  }

  window.__op = {
    restore,
    // 1件置く。増えた物を返す
    place(type, pos, opts) {
      return withFixedNow(() => {
        restore(opts.floor);
        if (opts.skipRoom) {
          // 段差のある部屋(柱を置く分岐のため)
          const r = byId(opts.skipRoom);
          r.skipLevelMm = opts.skipLevelMm;
        }
        ST.placingRot = opts.rot; ST.shiftKey = !!opts.shift;
        const before = new Set(DATA.items);
        const beforeCounts = [DATA.walls.length, DATA.rooms.length, DATA.items.length];
        const isAdded = (o) => !before.has(o) && DATA.items.includes(o);
        const diff = watch(isAdded);
        const err = run(() => { placeItem(type, pos.x, pos.y); return null; });
        const added = DATA.items.filter((o) => !before.has(o));
        const out = { item: added.length ? clean(added[0]) : null };
        if (added.length > 1) out.more = added.slice(1).map(clean);
        if (err) out.error = err.error;
        if (DATA.walls.length !== beforeCounts[0] || DATA.rooms.length !== beforeCounts[1]) out.otherCounts = [DATA.walls.length, DATA.rooms.length];
        out.nextIdDelta = nextId - nextIdBase;
        out.after = { tool: ST.tool, selected: ST.selected ? ST.selected.id : null, placingRot: ST.placingRot };
        diff(out);
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
    placeStair(stairId, reverse) {
      const out = {};
      restore(1);
      const s = byId(stairId);
      const end = { x: s.x + s.w / 2, y: s.y + s.d };
      const jobs = [];
      for (const type of ['stair', 'stair-corner', 'stair-landing']) {
        for (const rot of [0, 180]) {
          for (const [label, dx, dy] of [['near', 40, 70], ['far', 600, 900]]) jobs.push([type, rot, label, dx, dy]);
        }
      }
      if (reverse) jobs.reverse();
      for (const [type, rot, label, dx, dy] of jobs) {
        const sz = getItemDefaultSize(type);
        const pos = { x: end.x + dx, y: end.y + sz.d / 2 + dy };
        out[`${type}|${label}|rot${rot}`] = this.place(type, pos, { floor: 1, rot });
      }
      return out;
    },
    // 開口のツール種類(opening-door-model:… / opening-window-model:…)のうち、今のカタログで置けるもの
    openingTools() {
      const fixed = ['default', 'small', 'bath-clear-swing', 'bath-clear-fold'].map((m) => OPENING_DOOR_MODEL_TOOL_PREFIX + m)
        .concat(['default', 'fix', 'window-door'].map((m) => OPENING_WINDOW_MODEL_TOOL_PREFIX + m));
      const fromCatalog = [];
      for (const id of Object.keys(FMP_ITEMS).sort()) {
        for (const pre of [OPENING_DOOR_MODEL_TOOL_PREFIX, OPENING_WINDOW_MODEL_TOOL_PREFIX]) {
          if (getOpeningModelToolPreset(pre + id)) fromCatalog.push(pre + id);
        }
      }
      return fixed.concat(fromCatalog);
    },
    // 標準以外のセット(古民家・洋館)を一時的に表示にして fn を呼ぶ。セットの扉・玄関扉は表示中のセットにしか出ないため。
    // 起動直後(localStorage が空)は標準だけが表示なので、終わったら同じ状態へ戻す。
    withAllSets(fn) {
      const sets = Array.from(new Set(Object.values(FMP_ITEMS).map((i) => i.assetSet).filter(Boolean))).sort();
      const on = sets.filter((id) => !AssetSets.isVisible({ assetSet: id }));
      on.forEach((id) => AssetSets.toggle(id, null));
      try { return fn.call(this); } finally { on.forEach((id) => AssetSets.toggle(id, null)); }
    },
    del(setup) {
      return withFixedNow(() => {
        restore(setup.floor || 1);
        (setup.lock || []).forEach((id) => setObjectLocked(byId(id), true));
        if (setup.lockFloor) allObjects().forEach(([, o]) => { if ((o.floor || 1) === setup.lockFloor) setObjectLocked(o, true); });
        if (setup.walkRoute) {
          // 再生中の歩く道を消す分岐(stopWalkthrough を通る)。歩く道を1本足して再生中の印だけ付ける。
          const r = mkItem('walk-route', 4000, 4000, 0, 1);
          DATA.items.push(r);
          WALKTHROUGH = { routeId: r.id };
          setup = Object.assign({}, setup, { selected: r.id });
        }
        const snapBefore = allObjects().map(([kind, o]) => [kind, o.id, o]);
        const diff = watch(null, { skipRemoved: true });
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
        out.remainingIds = { walls: DATA.walls.map((o) => o.id), items: DATA.items.map((o) => o.id), rooms: DATA.rooms.map((o) => o.id) };
        if (setup.walkRoute) out.walkthroughAfter = WALKTHROUGH ? clean({ routeId: WALKTHROUGH.routeId }) : null;
        diff(out);
        if (err) out.error = err.error;
        return out;
      });
    },
    prop(targetId, key, value, opts) {
      opts = opts || {};
      return withFixedNow(() => {
        restore((byId(targetId) || {}).floor || 1);
        // restore のあとで byId を引き直す
        const target = byId(targetId);
        if (opts.lock) setObjectLocked(target, true);
        const diff = watch((o) => o === target || o.id === targetId);
        ST.selected = target;
        if (opts.colorInput) _activeAppearanceColorInput = document.createElement('input');
        const v = value === '__undefined__' ? undefined : value;
        const err = run(() => { updateSelectedProp(key, v, !!opts.noSave); return null; });
        if (opts.colorInput) {
          // 色の入力欄を閉じたときの確定(commitAppearanceColorEdits)は呼ばない。予約された 3D の更新も取り消す。
          clearTimeout(ST.appearancePreviewTimer);
        }
        // 呼んだあとに id で引き直して記録する
        const out = { target: clean(byId(targetId)) };
        diff(out);
        if (opts.colorInput) out.colorDirty = !!ST.appearanceColorDirty;
        _activeAppearanceColorInput = null;
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
  // 読み込みの完了を条件で待つ: 壁と部屋の数がそろい、保存一覧の id が外れ、読み込み中の表示が消えていること
  await page.waitForFunction(({ w, r }) => DATA.walls.length === w && DATA.rooms.length === r
    && PLAN_LIBRARY_ID === null && _defaultPlanPending === false
    && (() => { const l = document.getElementById('app-loading'); return !l || getComputedStyle(l).display === 'none' || !l.classList.contains('show'); })(),
  { w: plan.walls.length, r: plan.rooms.length }, T);
  // 読み込みのあいだにカタログの件数が変わっていないこと(記録の途中で種類の一覧が変わらない)
  assert.equal(await page.evaluate(() => Object.keys(FMP_ITEMS).length), last, '間取りを開くあいだに FMP_ITEMS の件数が変わった');
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

// 1ケースの中で違う欄を「場所: 正解 / 実際」で並べる。値が同じで項目の並びだけ違うときもそう書く。
function fieldDiffs(w, g, path, out) {
  const isObj = (x) => x && typeof x === 'object';
  if (isObj(w) && isObj(g) && Array.isArray(w) === Array.isArray(g)) {
    const keys = Array.from(new Set([...Object.keys(w), ...Object.keys(g)]));
    const before = out.length;
    for (const k of keys) {
      if (!(k in w)) { out.push(`${path}.${k}: 正解に無い / 実際 ${JSON.stringify(g[k])}`); continue; }
      if (!(k in g)) { out.push(`${path}.${k}: 正解 ${JSON.stringify(w[k])} / 実際に無い`); continue; }
      fieldDiffs(w[k], g[k], `${path}.${k}`, out);
    }
    if (out.length === before && JSON.stringify(w) !== JSON.stringify(g)) {
      out.push(`${path}: 項目の並び 正解 ${JSON.stringify(Object.keys(w))} / 実際 ${JSON.stringify(Object.keys(g))}`);
    }
    return;
  }
  if (JSON.stringify(w) !== JSON.stringify(g)) out.push(`${path}: 正解 ${JSON.stringify(w)} / 実際 ${JSON.stringify(g)}`);
}

// ケースの集合が完全に一致し、各ケースの中身が同じであること。違ったケースを返す。
function describeDiff(want, got) {
  const cases = [];
  const top = [];
  fieldDiffs(want.meta.counts, got.meta.counts, 'meta.counts', top);
  if (top.length) cases.push({ name: 'meta.counts', fields: top });
  const sections = Array.from(new Set([...Object.keys(want), ...Object.keys(got)])).filter((s) => s !== 'meta');
  for (const s of sections) {
    const w = want[s] || {}, g = got[s] || {};
    if (!(s in want)) { cases.push({ name: s, fields: ['区分ごと正解に無い'] }); continue; }
    if (!(s in got)) { cases.push({ name: s, fields: ['区分ごと今の実行に無い'] }); continue; }
    for (const k of Object.keys(w)) if (!(k in g)) cases.push({ name: `${s}.${k}`, fields: ['今の実行に無い'] });
    for (const k of Object.keys(g)) if (!(k in w)) cases.push({ name: `${s}.${k}`, fields: ['正解に無い'] });
    for (const k of Object.keys(w)) {
      if (!(k in g) || JSON.stringify(w[k]) === JSON.stringify(g[k])) continue;
      const fields = [];
      fieldDiffs(w[k], g[k], '', fields);
      cases.push({ name: `${s}.${k}`, fields });
    }
  }
  return cases;
}

const REVERSE = process.env.OPS_REVERSE === '1'; // 順番への依存が無いかを見るための逆順の実行(UPDATE と同時には使わない)
assert.ok(!(REVERSE && UPDATE), 'OPS_REVERSE と UPDATE_GOLDEN を同時に使わない');
const ord = (arr) => (REVERSE ? arr.slice().reverse() : arr);

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
    const openingStd = await page.evaluate(() => __op.openingTools());
    // セットの扉・玄関扉・窓(セットを表示にしたときだけ選べる)
    const openingSets = await page.evaluate((std) => __op.withAllSets(function () { return this.openingTools().filter((t) => !std.includes(t)); }), openingStd);
    const openingTools = openingStd.concat(openingSets);
    assert.ok(openingSets.some((t) => /entrance-door/.test(t)), '玄関扉のモデルが開口の種類に無い');

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
    const typesOrd = ord(types);
    for (let i = 0; i < typesOrd.length; i += 100) {
      Object.assign(place, await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [typesOrd.slice(i, i + 100), ord(PTS)]));
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
    const placeShift = await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [ord(SHIFT_TYPES), ord(SHIFT_PTS)]);
    const placeStair = await page.evaluate(([id, rev]) => __op.placeStair(id, rev), [ids.stair, REVERSE]);
    // 開口のツール種類(開口プリセットの分岐: getOpeningModelToolPreset / applyOpeningModelToItem)
    const placeOpening = await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [ord(openingStd), ord(PTS)]);
    Object.assign(placeOpening, await page.evaluate(([ts, pts]) => __op.withAllSets(function () { return this.placeBatch(ts, pts); }), [ord(openingSets), ord(PTS)]));
    // セットを戻したあとに標準だけが表示になっていること(後のケースに持ち越さない)
    assert.deepEqual(await page.evaluate(() => __op.openingTools()), openingStd, 'セットの表示が元に戻っていない');
    // 段差のある部屋に柱を置く(roomSkipCavityMm が SKIP_CAVITY_MIN_MM 以上なら baseLevel='under')
    const COLUMN_PTS = [
      { key: 'skip600', x: 1365, y: 5460, floor: 1, rot: 0, skipRoom: ids.skipRoom, skipLevelMm: 600 },
      { key: 'skip300', x: 1365, y: 5460, floor: 1, rot: 0, skipRoom: ids.skipRoom, skipLevelMm: 300 },
      { key: 'noskip', x: 1365, y: 5460, floor: 1, rot: 0 },
    ];
    const placeColumn = await page.evaluate(([ts, pts]) => __op.placeBatch(ts, pts), [ord(['column', 'column-round']), ord(COLUMN_PTS)]);

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
      'nothing-selected': { floor: 1 },
      // 3階は屋根(id 1115)が1つだけ。それをロックして、selectAll で消せる物が無い状態にする
      'selectAll-f3-all-locked': { selectAll: true, floor: 3, lockFloor: 3 },
      'walkthrough-route': { floor: 1, walkRoute: true },
    };
    const del = {};
    for (const [k, setup] of ord(Object.entries(DEL))) del[k] = await page.evaluate(([s]) => __op.del(s), [setup]);

    // ── 3. updateSelectedProp ──
    const TARGETS = ['wall', 'room', 'window', 'door', 'stair', 'light', 'furniture', 'exterior'];
    const enc = (v) => (v === undefined ? '__undefined__' : v);
    const runJobs = (js) => page.evaluate((list) => {
      const o = {};
      for (const [name, id, key, v, opts] of list) o[name] = __op.prop(id, key, v, opts);
      return o;
    }, ord(js));
    const prop = {};
    const t1 = Date.now();
    for (const tk of ord(TARGETS)) {
      const jobs = [];
      for (const key of keys) {
        jobs.push([`${tk}|${key}|normal`, ids[tk], key, enc(VALUES[key][0]), null]);
        jobs.push([`${tk}|${key}|falsy`, ids[tk], key, enc(VALUES[key][1]), null]);
      }
      Object.assign(prop, await runJobs(jobs));
    }
    const tProp = Date.now() - t1;
    const extraJobs = ['locked', 'hidden3D', 'vis3D', 'w'].flatMap((key) => [
      [`locked-furniture|${key}|normal`, ids.furniture, key, enc(VALUES[key][0]), { lock: true }],
      [`locked-furniture|${key}|falsy`, ids.furniture, key, enc(VALUES[key][1]), { lock: true }],
    ]);
    // noSave=true と、色の入力欄に焦点がある状態(keepColorPickerOpen の分岐)
    for (const [tk, key] of COLOR_CASES) {
      for (const [mode, opts] of [['noSave', { noSave: true }], ['colorInput', { colorInput: true }], ['colorInput+noSave', { colorInput: true, noSave: true }]]) {
        extraJobs.push([`${tk}|${key}|normal|${mode}`, ids[tk], key, enc(VALUES[key][0]), opts]);
      }
    }
    Object.assign(prop, await runJobs(extraJobs));

    console.log(`  時間: placeItem ${types.length}種類×6 ${Math.round(tPlace / 1000)}秒 / updateSelectedProp ${Math.round(tProp / 1000)}秒`);
    data = {
      meta: {
        counts: Object.assign({ types: types.length, keys: keys.length, openingTools: openingTools.length }, counts),
        keys, ids, openingTools, fixedNow: FIXED_NOW, nextIdBase: NEXT_ID,
      },
      place, placeShift, placeStair, del, prop, placeOpening, placeColumn,
    };
    data.meta.counts.cases = Object.fromEntries(SECTIONS.map((s) => [s, Object.keys(data[s]).length]));
    assert.equal(errors.length, 0, 'ページで例外: ' + errors.slice(0, 5).join(' / '));
    await assertNo3dSkips(page, 'operations-golden');
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

// どのケースも例外で落ちていないこと(落ちたまま記録すると、何も見張らない)
const thrown = [];
for (const s of SECTIONS) {
  for (const [k, v] of Object.entries(data[s])) if (v && v.error) thrown.push(`${s}.${k}: ${v.error}`);
}
assert.deepEqual(thrown, [], '操作の途中で例外が出たケースがある');
// placeItem は、置けたときは nextId を 1 だけ進め、置けなかったときは進めない
for (const s of ['place', 'placeOpening', 'placeColumn']) {
  for (const [k, v] of Object.entries(data[s])) assert.equal(v.nextIdDelta, v.item ? 1 : 0, `${s}.${k}: nextId の進み方`);
}
// 書き出す順を決まった順にそろえる(逆順の実行でも同じ並びで比べられるように)
for (const s of SECTIONS) data[s] = Object.fromEntries(Object.entries(data[s]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const text = serialize(data);
const n = (d, s) => Object.keys(d[s] || {}).length;
if (UPDATE) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(GOLDEN, text);
  console.log(`正解を書き出した: ${GOLDEN} (${(Buffer.byteLength(text) / 1e6).toFixed(2)}MB; ` + SECTIONS.map((s) => `${s} ${n(data, s)}`).join('・') + ')');
} else {
  assert.ok(existsSync(GOLDEN), 'golden.json が無い');
  const want = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const cases = describeDiff(want, data);
  const show = cases.slice(0, 20).map((c) => `${c.name}\n        ` + c.fields.join('\n        ')).join('\n    ');
  assert.equal(cases.length, 0, `今の結果が正解と違う (${cases.length} ケース。先頭 20 件):\n    ` + show);
  console.log((REVERSE ? '[逆順] ' : '') + SECTIONS.map((s) => `${s} ${n(want, s)}`).join('・') + ' ケースが、記録と一致した');
}
