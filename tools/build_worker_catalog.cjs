#!/usr/bin/env node
// Worker(画面の無い所)で間取りの操作を当てるための、種類ごとの表を作る。
//
//   node tools/build_worker_catalog.cjs          表 assets/data/worker-catalog.json を書き直す
//   node tools/build_worker_catalog.cjs --check  今のファイルと一致するかだけ見る(違えば 1 で終わる)
//
// 表は手で書かない。画面のコード(assets/js/app-constants.js・app-state.js を丸ごと、index.html と
// draw-2d.js の判定の関数を名前で切り出して)を node:vm で評価し、標準のカタログのマニフェスト3つを
// 画面と同じ取り込みの関数(mergeFurnitureMegaManifest)に渡したうえで、全種類について画面の関数を
// 実際に呼んだ結果を書き出す。追加のセット(assets/models/packs/ の洋館・古民家)は入れない。
//
// 表の形と、各欄がどの画面の関数の結果かは .superpowers/sdd/2026-11-18-stage5-mcp/task-1-report.md と
// 下の buildCatalog の中に書いてある。表は 100KB 以内に収めるため、欄の名前を短くし、無い・偽の欄は省く。
'use strict';
const vm = require('node:vm');
const crypto = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { appSource, ROOT } = require('./tests/app-source.cjs');
const { topLevelFunction } = require('./tests/ops-vm.cjs');

const OUT = join(ROOT, 'assets', 'data', 'worker-catalog.json');

// index.html・draw-2d.js などから切り出す、判定の関数(app-constants.js・app-state.js に無いもの)。
const FUNCTIONS = [
  'canSetItemElevation', 'isWindowLikeType', 'isDoorLikeOpeningType', 'isSwingDoorType', 'isDoorPanelType',
  'isOpeningItemType', 'isPlacementSurfaceItem', 'placeGroundOnly', 'isStairPartType', 'nhRoofHeightM',
];
// 同じく切り出す、トップレベルの var(表や定数)。
const VARS = ['ITEM_SURFACE_CATEGORIES', 'ITEM_SURFACE_TYPES', 'CEILING_FIXTURE_TOP_MM', 'NH_ROOF_H', 'NH_ROOF_MAX_PITCH', 'NH_EAVE'];

// `var NAME = ...;` の文を、ソース(index.html + 切り出した JS)から1つ切り出す。
// 文字列・コメントの中の ; や括弧は数えない。
function topLevelVar(name) {
  const src = appSource();
  const re = new RegExp('\\nvar ' + name + '\\s*=');
  const m = re.exec(src);
  if (!m) throw new Error('var ' + name + ' がソースに無い');
  const start = m.index + 1;
  let depth = 0, mode = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('var ' + name + ' の文が閉じていない');
}

// 画面がほかのファイルで ILABELS に足している名前(ceiling-designer.js の天井範囲など)。
// `ILABELS['x']='y';` の1行の文だけを拾って、そのまま評価する。
function extraLabelStatements() {
  const out = [];
  for (const rel of ['assets/js/ceiling-designer.js']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const re = /^ILABELS\[(['"])[^'"\n]+\1\]\s*=\s*(['"])[^'"\n]*\2;\s*$/gm;
    let m;
    while ((m = re.exec(src))) out.push(m[0]);
  }
  return out;
}

function readJson(rel) { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }

// 画面のグローバルを持つ vm の文脈を作る(マニフェストを読み終えた状態)。
function screenContext() {
  const ctx = vm.createContext({ console });
  for (const rel of ['assets/js/app-constants.js', 'assets/js/app-state.js']) {
    vm.runInContext(readFileSync(join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  vm.runInContext(VARS.map(topLevelVar).join('\n') + '\n' + FUNCTIONS.map(topLevelFunction).join('\n') + '\n' + extraLabelStatements().join('\n'), ctx);
  // 画面の loadFurnitureMegaLibrary と同じ順: 分類・仕上げの表を先に入れ、標準のマニフェストを順に取り込む。
  ctx.CATALOGUE_TAGS = readJson('assets/models/tags.json');
  ctx.CATALOGUE_FINISHES = readJson('assets/models/finishes.json');
  ctx.FMP_ITEMS = {};
  const sources = vm.runInContext('FMP_MANIFEST_SOURCES.map(function(s){ return s.url; })', ctx);
  for (const url of sources) {
    ctx.__manifest = readJson(url);
    vm.runInContext('mergeFurnitureMegaManifest(__manifest)', ctx);
  }
  delete ctx.__manifest;
  return ctx;
}

function sortedObject(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

// 判定の名前 → 画面の関数。種類だけで決まる物は { type } の物を作って渡す。
const FLAG_SOURCES = [
  // factories.js が ctx.catalog.is(kind, type) で聞く5つ(名前は kind と同じ)
  ['light', 'isLightItemType(t)'],
  ['contextExterior', 'isContextExteriorItemType(t)'],
  ['windowLike', 'isWindowLikeType(t)'],
  ['doorLikeOpening', 'isDoorLikeOpeningType(t)'],
  ['doorPanel', 'isDoorPanelType(t)'],
  // ほかに Worker の ctx が要る判定
  ['opening', 'isOpeningItemType(t)'],
  ['elev', 'canSetItemElevation({type:t})'],
  ['groundOnly', 'placeGroundOnly(t)'],
  ['groundLevel', 'isGroundLevelItemType(t)'],
  ['floorAwareGround', 'isFloorAwareGroundItemType(t)'],
  ['surface', 'isPlacementSurfaceItem({type:t})'],
  ['ceilingFixture', "CEILING_FIXTURE_TOP_MM[t]!==undefined || t==='original-laundry-rail'"],
  ['column', 'isColumnType(t)'],
  ['stairPart', 'isStairPartType(t)'],
  ['annotation', 'isPlanAnnotationType(t)'],
  ['swingDoor', 'isSwingDoorType(t)'],
];

function entryFor(ctx, t, placeable) {
  ctx.__t = t;
  const call = (expr) => vm.runInContext('(function(t){ return ' + expr + '; })(__t)', ctx);
  const e = {};
  if (placeable) {
    // 既定の寸法: getItemDefaultSize(t)。カタログの物は h も返る。古い種類名はカタログの寸法になる。
    // ただし古い種類名(legacy の鍵)は ISIZES の値をそのまま書く(検査 PlanCheck が ISIZES を見るため)。
    const legacy = call('LEGACY_FMP_TYPE_MAP[t]');
    const sz = legacy ? call('ISIZES[t]') : call('getItemDefaultSize(t)');
    e.w = sz.w; e.d = sz.d;
    if (sz.h !== undefined) e.h = sz.h;
  }
  const color = call('ICOLORS[t]');
  if (color !== undefined) e.c = color;
  const model = call('getFmpItem(t)');
  if (model) {
    e.m = 1;
    if (model.defaultElevation) e.de = model.defaultElevation;
    if (model.groundLevel) e.gl = 1;
  }
  const label = call('itemTypeLabel(t)');
  if (label !== t) e.n = label;
  const flags = FLAG_SOURCES.filter(([, expr]) => !!call(expr)).map(([name]) => name);
  if (flags.length) e.f = flags;
  // 照明の既定の欄: makeItem が作る形の物(色は既定の色、無ければ #ddd)に ensureLightDefaults を当てた差分。
  // elev は入れない(makeItem のあと canSetElevation で 0 に戻り、置いたあとに部屋の天井から決め直されるため)。
  // elev を数で渡しておくのは、天井の高さを探す計算(DATA と部屋が要る)を通らないようにするため。
  if (call('isLightItemType(t)')) {
    const before = { type: t, color: color || '#ddd', elev: 0 };
    ctx.__it = Object.assign({}, before);
    vm.runInContext('ensureLightDefaults(__it)', ctx);
    const after = JSON.parse(JSON.stringify(ctx.__it));
    delete ctx.__it;
    const lt = {};
    for (const k of Object.keys(after)) if (k !== 'elev' && after[k] !== before[k]) lt[k] = after[k];
    e.lt = lt;
  }
  // 周辺の建物などの高さ: defaultContextExteriorHeight(t)(壁の高さが既定の 2400 のとき)。
  // 隣家・周辺ビルは階数 × 階高 + 屋根で、階高はプランの壁の高さで変わるので、階数と屋根も書く。
  if (call('isContextExteriorItemType(t)')) {
    const cx = { h: call('defaultContextExteriorHeight(t)') };
    if (t === 'neighbor-building' || t === 'neighbor-house') {
      cx.f = call('defaultContextFloors(t)');
      cx.roof = call('contextRoofExtraHeightMm(t)');
    }
    e.cx = cx;
  }
  delete ctx.__t;
  return e;
}

function buildCatalog() {
  const ctx = screenContext();
  // 置ける種類 = 画面の planCoreCtx の known が真になる種類 = ISIZES の鍵とカタログの鍵。並びは画面の候補の並びと同じ。
  const placeable = vm.runInContext('Object.keys(ISIZES).concat(Object.keys(FMP_ITEMS))', ctx);
  const types = {};
  for (const t of placeable) {
    if (Object.prototype.hasOwnProperty.call(types, t)) throw new Error('種類 ' + t + ' が ISIZES とカタログの両方にある');
    types[t] = entryFor(ctx, t, true);
  }
  // 置けないが、画面が名前・色・判定を持つ種類(メモ・定規・ウォークルート・天井範囲など)。要約と既存の物の扱いに使う。
  const otherKeys = vm.runInContext('Object.keys(ILABELS).concat(Object.keys(ICOLORS))', ctx)
    .filter((t) => !Object.prototype.hasOwnProperty.call(types, t));
  const others = {};
  for (const t of [...new Set(otherKeys)].sort()) others[t] = entryFor(ctx, t, false);
  const legacy = sortedObject(JSON.parse(JSON.stringify(vm.runInContext('LEGACY_FMP_TYPE_MAP', ctx))));
  const constants = vm.runInContext(`({
    rulerThickness: RULER_THICKNESS_MM,
    walkRouteThickness: WALK_ROUTE_THICKNESS_MM,
    walkDefaultSpeed: WALK_DEFAULT_SPEED_MPS,
    defaultWallHeight: DEFAULT_WALL_H_MM,
    wallHeightMin: WALL_H_MIN,
    wallHeightMax: WALL_H_MAX,
    floorHeight: FLOOR_H,
    floorSlabHeight: FLOOR_SLAB_H,
    ceilingFinishM: CEILING_FINISH_M,
    ceilingFixtureTop: CEILING_FIXTURE_TOP_MM
  })`, ctx);
  const body = { types, others, legacy, constants: JSON.parse(JSON.stringify(constants)) };
  const version = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return Object.assign({ version }, body);
}

// ── 家具の一括差し替えと、家具の部位の表(assets/data/worker-furniture.json)──────────────
// worker-catalog.json は 100KB に収めるため追加のセットを入れない。一括差し替え(asset-swap.js)と家具の色・素材・艶
// (setProps の finishColors など)に要る分は、こちらの表に分けて書く。どれも画面の関数を vm で呼んだ結果:
//   sets   … 差し替えの設定(swap)を持つセット [{id, name, swap}](asset-sets.json の並び)
//   types  … 追加のセットのモデルの種類(worker-catalog.json の types と同じ形。entryFor)。Worker は標準の後ろに足す
//            (画面の FMP_ITEMS も、標準のマニフェストの後にセットのマニフェストを足す)
//   fmp    … カタログのモデル全部(標準とセット)の、差し替えが引く欄: k=分類(kind)、mt=取付(mount)、h=高さ、
//            de=既定の高さ(defaultElevation)、set=セット、r=引退。セットの物だけ nm=名前・w・d(差し替え先の候補の欄)
//   fc     … 色を変えられる部位の名前の並び(getItemFinishModel(t).finishChannels の key)。部位の無い種類は書かない
//   ih     … 寸法の表(ISIZES)の種類の getItemH(t)(モデルでない種類の既定の高さ)
const FURNITURE_OUT = join(ROOT, 'assets', 'data', 'worker-furniture.json');
const FURNITURE_FUNCTIONS = ['getItemH', 'balconySlabHeightMm'];

function buildFurniture() {
  const ctx = screenContext();
  vm.runInContext(FURNITURE_FUNCTIONS.map(topLevelFunction).join('\n'), ctx);
  const isizes = vm.runInContext('Object.keys(ISIZES)', ctx);
  const standard = new Set(vm.runInContext('Object.keys(FMP_ITEMS)', ctx));
  // 画面の AssetSets.load と同じ: 一覧の順に、manifest を持つセットの物へ assetSet を付けて、標準の後に取り込む。
  const registry = readJson('assets/models/asset-sets.json').sets.filter((s) => s && s.id && s.name);
  for (const s of registry) {
    if (!s.manifest) continue;
    const m = readJson(s.manifest);
    (m.items || []).forEach((item) => { item.assetSet = s.id; });
    ctx.__manifest = m;
    vm.runInContext('mergeFurnitureMegaManifest(__manifest)', ctx);
  }
  delete ctx.__manifest;
  const all = vm.runInContext('Object.keys(FMP_ITEMS)', ctx);
  const types = {};
  for (const t of all) if (!standard.has(t)) types[t] = entryFor(ctx, t, true);
  const fmp = {};
  for (const t of all) {
    ctx.__t = t;
    const it = vm.runInContext('FMP_ITEMS[__t]', ctx);
    const e = {};
    if (it.kind) e.k = it.kind;
    if (it.mount) e.mt = it.mount;
    if (it.h !== undefined) e.h = it.h;
    if (it.defaultElevation) e.de = it.defaultElevation;
    if (it.assetSet) { e.set = it.assetSet; e.nm = it.name; e.w = it.w; e.d = it.d; }
    if (it.retired) e.r = 1;
    fmp[t] = e;
  }
  const fc = {};
  for (const t of isizes.concat(all)) {
    ctx.__t = t;
    const keys = vm.runInContext('(function(m){ return m&&Array.isArray(m.finishChannels)?m.finishChannels.map(function(c){return c.key;}):[]; })(getItemFinishModel(__t))', ctx);
    if (keys.length) fc[t] = JSON.parse(JSON.stringify(keys));
  }
  const ih = {};
  for (const t of isizes) { ctx.__t = t; ih[t] = vm.runInContext('getItemH(__t)', ctx); }
  delete ctx.__t;
  const sets = registry.filter((s) => s.swap).map((s) => ({ id: s.id, name: s.name, swap: s.swap }));
  const body = { sets: JSON.parse(JSON.stringify(sets)), types, fmp, fc, ih };
  const version = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return Object.assign({ version }, body);
}

function serializeFurniture(cat) {
  const lines = ['{', '"version":' + JSON.stringify(cat.version) + ',', '"sets":' + JSON.stringify(cat.sets) + ','];
  const names = ['types', 'fmp', 'fc', 'ih'];
  names.forEach((name, n) => {
    const obj = cat[name], keys = Object.keys(obj);
    lines.push(JSON.stringify(name) + ':{');
    keys.forEach((k, i) => lines.push(JSON.stringify(k) + ':' + JSON.stringify(obj[k]) + (i < keys.length - 1 ? ',' : '')));
    lines.push('}' + (n < names.length - 1 ? ',' : ''));
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

// 1種類1行。差分が読めて、大きさも抑えられる形。
function serialize(cat) {
  const lines = ['{', '"version":' + JSON.stringify(cat.version) + ','];
  const block = (name, obj, last) => {
    const keys = Object.keys(obj);
    lines.push(JSON.stringify(name) + ':{');
    keys.forEach((k, i) => lines.push(JSON.stringify(k) + ':' + JSON.stringify(obj[k]) + (i < keys.length - 1 ? ',' : '')));
    lines.push('}' + (last ? '' : ','));
  };
  block('types', cat.types);
  block('others', cat.others);
  block('legacy', cat.legacy);
  block('constants', cat.constants, true);
  lines.push('}');
  return lines.join('\n') + '\n';
}

function main(argv) {
  const text = serialize(buildCatalog());
  const furniture = serializeFurniture(buildFurniture());
  if (argv.includes('--check')) {
    let bad = 0;
    for (const [file, want] of [[OUT, text], [FURNITURE_OUT, furniture]]) {
      let now = null;
      try { now = readFileSync(file, 'utf8'); } catch (e) { /* 無ければ不一致 */ }
      const rel = file.slice(ROOT.length + 1);
      if (now !== want) { console.error(rel + ' が画面のコードと食い違っています。node tools/build_worker_catalog.cjs で作り直してください'); bad = 1; }
      else console.log(rel + ' は最新です');
    }
    return bad;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  writeFileSync(FURNITURE_OUT, furniture);
  const cat = JSON.parse(text);
  console.log('書きました: assets/data/worker-catalog.json(種類 ' + Object.keys(cat.types).length + '、ほか ' + Object.keys(cat.others).length + '、' + Buffer.byteLength(text) + ' バイト、version ' + cat.version + ')');
  const fur = JSON.parse(furniture);
  console.log('書きました: assets/data/worker-furniture.json(セット ' + fur.sets.length + '、セットの種類 ' + Object.keys(fur.types).length + '、モデル ' + Object.keys(fur.fmp).length + '、' + Buffer.byteLength(furniture) + ' バイト、version ' + fur.version + ')');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildCatalog, serialize, OUT, buildFurniture, serializeFurniture, FURNITURE_OUT };
