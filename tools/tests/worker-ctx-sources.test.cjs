// Worker 用の ctx(worker/plan-ctx-factory.mjs)が式を書き写した、画面の関数・定数の見張り。
//
// なぜ在るのか
// ------------
// plan-ctx-factory.mjs は、画面の関数(DATA を見る)を読んで、同じ答えになる式を書き写している。
// 書き写しが画面と同じかは画面テスト tools/tests/worker-ctx-parity.browser.mjs が照らし合わせるが、
// 画面テストは CI(sh tools/run_tests.sh)では走らない。画面の関数を直したのに Worker の式が古いまま、
// という食い違いに気づけるように、書き写し元の本文の SHA-256 を記録と比べる。
//
// 本文が変わったら(コメント・空白の違いも含めて)落ちる。落ちたら:
//   1. worker/plan-ctx-factory.mjs の対応する式(下の表の右の欄)を、画面の新しい本文に合わせて見直す
//   2. 画面テストを走らせて通す:
//      PLAYWRIGHT_MODULE=… sh tools/run_browser_tests.sh worker-ctx-parity
//   3. 記録を作り直す: node tools/tests/worker-ctx-sources.test.cjs --write
//
// 書き写しを足したら、下の表にも足して記録を作り直す。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { appSource } = require('./app-source.cjs');
const { topLevelFunction } = require('./ops-vm.cjs');

const RECORD = path.join(__dirname, 'fixtures', 'worker-ctx-sources.json');
const WRITE = 'node tools/tests/worker-ctx-sources.test.cjs --write';

// [画面の関数名(function)か定数名(var), plan-ctx-factory.mjs のどこに書き写したか]
const FUNCTIONS = [
  // 種類
  ['planChatCtx', 'workerOpsCtx の catalog(resolveType・known・unknownMessage・suggest)と hooks.canPlace・placeFloor・afterPlace(取付の高さ)、snap'],
  ['planChatKindType', 'kindType'],
  ['planCoreSuggestTypes', 'suggestTypes'],
  ['planCoreCtx', 'workerOpsCtx の catalog(defaultSize・defaultColor・model・is・canSetElevation・applyLightDefaults・contextExteriorHeight・contextFloors・constants)と plan'],
  ['planOpsCtx', 'workerOpsCtx の snap と hooks(isLocked・canPlace・placeFloor・afterPlace・windowSill・normalizeWindow・ceilingElevation・shiftCeilingFixtures・prop・afterDelete・set.floorLevel)'],
  ['bestFmpType', 'bestFmpType'],
  ['isFmpItemType', 'isFmpItemType'],
  ['getFmpItem', 'entry・isFmpItemType'],
  ['getItemDefaultSize', 'defaultSizeOf'],
  ['canSetItemElevation', 'canSetItemElevation'],
  ['isOpeningItemType', 'canSetItemElevation'],
  ['isPlacementSurfaceItem', 'isPlacementSurfaceItem'],
  ['ensureLightDefaults', 'catalog.applyLightDefaults'],
  ['isLightItemType', 'isLightType'],
  ['isColumnType', 'isColumnType'],
  ['isStairPartType', 'isStairPartType'],
  ['isPlanAnnotationType', 'isPlanAnnotationType'],
  ['isWindowLikeType', 'isWindowLikeType'],
  ['isContextExteriorItemType', 'isContextExteriorType'],
  ['isGroundLevelItemType', 'isGroundLevelType'],
  ['isFloorAwareGroundItemType', "surfaceProblem(flag 'floorAwareGround')"],
  ['placeGroundOnly', 'isGroundOnly・hooks.canPlace'],
  ['isObjectLocked', 'hooks.isLocked'],
  ['wallThicknessMm', 'snap.wallThickness'],
  ['ensureObjectIds', 'firstNewId'],
  // 周辺の建物
  ['defaultContextExteriorHeight', 'defaultContextExteriorHeight'],
  ['contextHeightFromFloors', 'defaultContextExteriorHeight'],
  ['contextStoryHeightMm', 'contextStoryHeightMm'],
  ['defaultContextFloors', 'defaultContextFloors'],
  // 高さ
  ['copyPlanWallHeightToGlobal', 'wallHGlobal'],
  ['ensureHeightDefaults', 'wallHGlobal'],
  ['clampWallHeightMm', 'wallHGlobal'],
  ['perFloorHeightsEnabled', 'perFloorHeightsEnabled'],
  ['planFloorHeightEntry', 'planFloorHeightEntry'],
  ['defaultWallHeightMmForFloor', 'defaultWallHeightMmForFloor'],
  ['defaultFloorRaiseMmForFloor', 'defaultFloorRaiseMmForFloor'],
  ['clampFloorRaiseMm', 'clampFloorRaiseMm'],
  ['newRoomFloorRaiseMm', 'newRoomFloorRaiseMm'],
  ['foundationHeightMm', 'foundationHeightMm'],
  ['usesFinishedHeightModel', 'usesFinishedHeightModel'],
  ['defaultFloorThicknessMm', 'defaultFloorThicknessMm'],
  ['floorSlabMmForFloor', 'floorSlabMmForFloor'],
  ['floorSlabHeightMForFloor', 'floorSlabHeightMForFloor'],
  ['storyHeightMmForFloor', 'storyHeightMmForFloor'],
  ['storyHeightM', 'storyHeightM'],
  ['ceilingFinishThicknessM', 'ceilingFinishThicknessM'],
  ['wallFullHeightM', 'wallFullHeightM'],
  ['roomFloorOffsetMm', 'roomFloorOffsetMm'],
  ['roomSkipLevelMm', 'roomSkipLevelMm'],
  ['roomSkipCavityMm', 'roomSkipCavityMm'],
  ['roomsAtPointOnFloor', 'roomAtPointOnFloor'],
  ['roomAtPointOnFloor', 'roomAtPointOnFloor'],
  // 照明の高さ(天井)と、式で出せない天井の判定
  ['roomExplicitCeilingMm', 'explicitCeilingM・lightCeilingProblem'],
  ['roomCeilingHeightM', 'roomCeilingHeightM・lightCeilingProblem'],
  ['roomCeilingElevationMm', 'roomCeilingElevationMm'],
  ['ceilingFinishElevationMm', 'defaultLightElevationMm'],
  ['defaultLightElevationMm', 'defaultLightElevationMm(下限 LIGHT_MIN_ELEV_MM=1800)'],
  ['siteSetbackConfig', 'siteSetbackActive'],
  ['activeSetbackSites', 'setbackActive'],
  ['shiftRoomCeilingFixtures', 'hooks.ceilingElevation(天井に付いた器具の判定)・shiftRoomCeilingFixtures(床の上下で器具を動かす)'],
  ['setRoomFloorRaiseMm', 'hooks.set.floorLevel(床の上下の範囲と、断る条件)'],
  // 床の上下(土間・土間をやめる)で、天井に付いた器具を動かす量と、下の階の折り上げ天井で決まる下限
  ['followRoomCeiling', 'floorRaiseFixtureDelta(前後の天井高の差)'],
  ['foundationHeightM', 'foundationHeightM'],
  ['floorBaseY', 'floorBaseY'],
  ['floorHasSkipLevel', 'floorHasSkipLevel'],
  ['localSupportTopY', 'localSupportTopYIfFlat(高い壁が無いときだけ)'],
  ['roomsOverlapInPlan', 'roomsOverlapInPlanIfWide(帯が細いときは分からないとする)'],
  ['roomCeilingCapM', 'areaBaseYIfFlat(段差の無い部屋は階高)'],
  ['roomCeilingProfile', 'areaBaseYIfFlat(勾配を宣言せず斜線も無い部屋は null)'],
  ['roomDeclaresSlopedCeiling', 'areaBaseYIfFlat'],
  // 置いた物の高さ(台の上)・柱の段差・屋内の印
  ['isInsideItem', 'insideItem'],
  ['findDefaultPlacementSurface', 'surfaceProblem'],
  ['applyDefaultPlacementElevation', 'hooks.afterPlace'],
  ['item3DBaseY', 'surfaceProblem(地面を基準に立つ物か)'],
  ['itemPlacedOnFloorExplicitly', 'surfaceProblem(placedOnFloor)'],
  ['placeAfterSnap', 'hooks.afterPlace'],
  ['placeIndoorAt', 'placeIndoorAt'],
  // 外壁の設定表
  ['normalizeTextureOrientationTarget', 'normalizeTextureOrientationTarget'],
  ['defaultExteriorFloorSetting', 'defaultExteriorFloorSetting'],
  ['ensureExteriorWallSettings', 'ensureExteriorWallSettings'],
  ['wallSettingKey', 'wallSettingKey'],
  ['getExteriorWallSetting', 'getExteriorWallSetting'],
  ['syncExteriorWallSettings', 'syncExteriorWallSettings'],
  // 窓の高さ
  ['wallHeightMm', 'wallHeightMm'],
  ['windowMaxTopMm', 'windowMaxTopMm'],
  ['windowSillMm', 'windowSillMm'],
  ['normalizeWindowVerticalProps', 'normalizeWindowVerticalProps'],
  // 階段の吸着
  ['stairPartEdgesRaw', 'stairPartEdgesMm'],
  ['stairPartEdgesMm', 'stairPartEdgesMm'],
  // 家具の部位(setProps の finishColors など)
  ['planCoreFinishChannels', 'finishChannelsOf'],
  ['getItemFinishModel', 'finishChannelsOf(表 worker-furniture.json の fc)'],
  // 一括差し替え(swapAssetSet)の決め方に渡す高さと天井
  ['planAssetSwapCtx', 'workerOpsCtx の assetSwap'],
  ['getItemHeightValue', 'getItemHeightValue'],
  ['getItemH', 'getItemH'],
  ['getCustomBlockHeight', 'getItemHeightValue(getCustomBlockHeight)'],
  ['balconySlabHeightMm', 'getItemHeightValue(balconySlabHeightMm)'],
  ['shelfHeightMm', 'getItemHeightValue(shelfHeightMm)'],
  ['columnHeightMm', 'getItemHeightValue(columnHeightMm)'],
  ['getContextExteriorHeight', 'getContextExteriorHeight'],
  ['getContextFloors', 'getContextFloors'],
  ['clampContextFloors', 'clampContextFloors'],
  ['contextRoofExtraHeightMm', 'contextRoofExtraHeightMm'],
  ['nhRoofHeightM', 'nhRoofHeightM'],
];
// asset-swap.js の中(字下げした function)に在る、一括差し替えの画面の包み。
const ASSET_SWAP = 'assets/js/asset-swap.js';
const ASSET_SWAP_FUNCTIONS = [
  ['planFor', 'swapPlan・swapCatalogue・swapCeilingAt'],
];
// 画面の関数のうち、ceiling-designer.js(CeilingDesigner の中。app-source.cjs のつなぎには入っていない)に在る物。
const CEILING_DESIGNER = 'assets/js/ceiling-designer.js';
const DESIGNER_FUNCTIONS = [
  ['floorLoweringLimit', 'floorLoweringLimitMm'],
  ['areas', 'ceilingAreasOf'],
  ['roomFor', 'ceilingAreaRoomFor'],
  ['areaBaseY', 'areaBaseYIfFlat'],
];
const CONSTANTS = [
  ['U', 'U'],
  ['WALL_COLORS', 'WALL_COLORS'],
  ['SKIP_CAVITY_MIN_MM', 'SKIP_CAVITY_MIN_MM'],
  ['EDGE_SNAP_THRESH', 'EDGE_SNAP_THRESH'],
  ['STAIR_SNAP_MM', 'STAIR_SNAP_MM'],
  ['STAIR_LINK_MIN_SPAN_MM', 'STAIR_LINK_MIN_SPAN_MM'],
  ['CHAT_SKIP_KINDS', 'CHAT_SKIP_KINDS'],
  ['CHAT_KITCHEN_UNIT_MESSAGE', 'CHAT_KITCHEN_UNIT_MESSAGE'],
  ['ITEM_SURFACE_CATEGORIES', 'isPlacementSurfaceItem(種類の表の surface の印)'],
  ['ITEM_SURFACE_TYPES', 'isPlacementSurfaceItem(種類の表の surface の印)'],
  ['NH_ROOF_H', 'nhRoofHeightM(1.30)'],
  ['NH_ROOF_MAX_PITCH', 'nhRoofHeightM(0.55)'],
  ['NH_EAVE', 'nhRoofHeightM(0.200)'],
];

// 行頭の var/let/const NAME = … ; を、文字列・コメント・括弧を読み飛ばして切り出す。
function topLevelDecl(name, src) {
  src = src || appSource();
  const re = new RegExp('\\n(?:var|let|const)\\s+' + name.replace(/[$]/g, '\\$') + '\\s*=');
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
  throw new Error('var ' + name + ' の終わりが見つからない');
}

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
// ファイルの行頭の function NAME(…){…} を切り出す(topLevelFunction と同じ読み飛ばし)。
// indent を渡すと、その字下げの function を探す(asset-swap.js は全体を1つの関数で包んでいる)。
function fileFunction(file, name, indent) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
  const at = src.indexOf('\n' + (indent || '') + 'function ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' が ' + file + ' に無い');
  const start = at + 1;
  let depth = 0, mode = null;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
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
  throw new Error(name + ' の本体が閉じていない');
}

function current() {
  const out = { functions: {}, constants: {} };
  for (const [name] of FUNCTIONS) out.functions[name] = sha(topLevelFunction(name));
  for (const [name] of DESIGNER_FUNCTIONS) out.functions['CeilingDesigner.' + name] = sha(fileFunction(CEILING_DESIGNER, name));
  for (const [name] of ASSET_SWAP_FUNCTIONS) out.functions['AssetSwap.' + name] = sha(fileFunction(ASSET_SWAP, name, '  '));
  for (const [name] of CONSTANTS) out.constants[name] = sha(topLevelDecl(name));
  return out;
}

if (process.argv.includes('--write')) {
  const body = Object.assign({
    _note: 'worker/plan-ctx-factory.mjs が書き写した画面の関数・定数の本文の SHA-256。tools/tests/worker-ctx-sources.test.cjs が比べる。作り直し: ' + WRITE,
  }, current());
  fs.writeFileSync(RECORD, JSON.stringify(body, null, 2) + '\n');
  console.log('書いた: ' + path.relative(process.cwd(), RECORD) + '(関数 ' + (FUNCTIONS.length + DESIGNER_FUNCTIONS.length + ASSET_SWAP_FUNCTIONS.length) + '・定数 ' + CONSTANTS.length + ')');
} else {
  const where = new Map(FUNCTIONS.concat(CONSTANTS, DESIGNER_FUNCTIONS.map(([n, w]) => ['CeilingDesigner.' + n, w]), ASSET_SWAP_FUNCTIONS.map(([n, w]) => ['AssetSwap.' + n, w])));
  const advice = (name) => '画面の ' + name + ' が変わりました。worker/plan-ctx-factory.mjs の対応する式(' + where.get(name)
    + ')を見直し、画面テスト worker-ctx-parity を走らせて通してから、' + WRITE + ' で記録を更新してください';

  test('書き写し元の画面の関数・定数の本文が、記録と同じ', () => {
    const rec = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    const now = current();
    const changed = [];
    for (const kind of ['functions', 'constants']) {
      for (const name of Object.keys(now[kind])) {
        if (rec[kind][name] === undefined) changed.push('記録に無い ' + name + '(表に足したら ' + WRITE + ' で記録を作り直してください)');
        else if (rec[kind][name] !== now[kind][name]) changed.push(advice(name));
      }
      for (const name of Object.keys(rec[kind])) if (now[kind][name] === undefined) changed.push('記録にだけある ' + name + '(表から外したら ' + WRITE + ' で記録を作り直してください)');
    }
    assert.deepEqual(changed, [], '\n' + changed.join('\n'));
  });

  test('切り出しが本文を取れている(関数は閉じ括弧まで、定数は ; まで)', () => {
    assert.match(topLevelFunction('placeAfterSnap'), /^function placeAfterSnap\(it\)\{[\s\S]*\n\}$/);
    assert.equal(topLevelDecl('CHAT_SKIP_KINDS'), 'var CHAT_SKIP_KINDS={fence:true,other:true};');
    assert.match(topLevelDecl('WALL_COLORS'), /^var WALL_COLORS = \{[^}]*\};$/);
    const decl = topLevelDecl('X', "\nvar X = {a: 'x;y', b: [1, 2], c: function(){ return 1; }}; var Y = 2;");
    assert.equal(decl, "var X = {a: 'x;y', b: [1, 2], c: function(){ return 1; }};");
  });

  // Worker は床の上下を変えたときに動かす器具の量を、天井高を測らずに「床の上下の差」で出している
  // (plan-ctx-factory.mjs の floorRaiseFixtureDelta)。それが画面と同じになる前提は、画面の roomCeilingHeightM
  // (天井高の項)から届く関数が、部屋の床の上下(floorRaiseMm・roomFloorOffsetMm・roomFloorTopY)を読まないこと。
  // 本文の見張り(上)は書き写した関数しか見ないので、届く関数をすべて名前でたどって確かめる。
  // 落ちたら: 天井高が床の上下で変わるようになった。その種類の部屋では Worker の floorRaiseFixtureDelta で断る。
  test('画面の天井高の計算から届く関数は、部屋の床の上下を読まない', () => {
    const root = path.join(__dirname, '..', '..');
    const files = ['index.html'].concat(fs.readdirSync(path.join(root, 'assets', 'js')).filter((f) => f.endsWith('.js')).map((f) => 'assets/js/' + f));
    const bodies = {};
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const re = /^function ([A-Za-z0-9_$]+)\s*\(/mg;
      const starts = [];
      let m;
      while ((m = re.exec(src))) starts.push([m[1], m.index]);
      starts.forEach(([n, i], k) => {
        const body = src.slice(i, k + 1 < starts.length ? starts[k + 1][1] : src.length).replace(/\/\/[^\n]*/g, '');
        (bodies[n] = bodies[n] || []).push(body);
      });
    }
    const names = Object.keys(bodies);
    const calls = (body) => names.filter((c) => body.indexOf(c + '(') >= 0 && new RegExp('\\b' + c.replace(/\$/g, '\\$') + '\\s*\\(').test(body));
    const roots = ['roomCeilingHeightM', 'floorSlabHeightMForFloor', 'ceilingFinishThicknessM', 'roomSkipLevelMm'];
    const seen = new Set(), from = {}, queue = roots.slice();
    while (queue.length) {
      const n = queue.shift();
      if (seen.has(n) || !bodies[n]) continue;
      seen.add(n);
      bodies[n].forEach((b) => calls(b).forEach((c) => { if (!seen.has(c)) { if (!from[c]) from[c] = n; queue.push(c); } }));
    }
    assert.ok(seen.size > 50 && seen.has('roomRoofCeilingExtent') && seen.has('setbackRoofsOverRoom') && seen.has('roomVoidCeilingMm'), '呼び出しをたどれていない: ' + seen.size);
    const READ = /\bfloorRaiseMm\b|\broomFloorOffsetMm\b|\broomFloorTopY\b/;
    const reads = [...seen].filter((n) => bodies[n].some((b) => READ.test(b))).map((n) => {
      const chain = [];
      for (let x = n; x; x = from[x]) chain.unshift(x);
      return chain.join(' → ');
    });
    assert.deepEqual(reads, [], '天井高の計算が床の上下を読むようになった:\n' + reads.join('\n'));
  });

  test('plan-ctx-factory.mjs に、書き写し元の関数名が注釈で書いてある', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'worker', 'plan-ctx-factory.mjs'), 'utf8');
    const missing = FUNCTIONS.concat(CONSTANTS, DESIGNER_FUNCTIONS).map(([name]) => name).filter((name) => !new RegExp('\\b' + name + '\\b').test(src));
    assert.deepEqual(missing, [], '注釈に無い: ' + missing.join(', '));
  });
}
