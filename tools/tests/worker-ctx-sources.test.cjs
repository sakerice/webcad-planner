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
  ['planOpsCtx', 'workerOpsCtx の snap と hooks(isLocked・canPlace・placeFloor・afterPlace・windowSill・normalizeWindow・ceilingElevation・shiftCeilingFixtures・prop・afterDelete)'],
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
  ['shiftRoomCeilingFixtures', 'hooks.ceilingElevation(天井に付いた器具の判定)'],
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
function current() {
  const out = { functions: {}, constants: {} };
  for (const [name] of FUNCTIONS) out.functions[name] = sha(topLevelFunction(name));
  for (const [name] of CONSTANTS) out.constants[name] = sha(topLevelDecl(name));
  return out;
}

if (process.argv.includes('--write')) {
  const body = Object.assign({
    _note: 'worker/plan-ctx-factory.mjs が書き写した画面の関数・定数の本文の SHA-256。tools/tests/worker-ctx-sources.test.cjs が比べる。作り直し: ' + WRITE,
  }, current());
  fs.writeFileSync(RECORD, JSON.stringify(body, null, 2) + '\n');
  console.log('書いた: ' + path.relative(process.cwd(), RECORD) + '(関数 ' + FUNCTIONS.length + '・定数 ' + CONSTANTS.length + ')');
} else {
  const where = new Map(FUNCTIONS.concat(CONSTANTS));
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

  test('plan-ctx-factory.mjs に、書き写し元の関数名が注釈で書いてある', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'worker', 'plan-ctx-factory.mjs'), 'utf8');
    const missing = FUNCTIONS.concat(CONSTANTS).map(([name]) => name).filter((name) => !new RegExp('\\b' + name + '\\b').test(src));
    assert.deepEqual(missing, [], '注釈に無い: ' + missing.join(', '));
  });
}
