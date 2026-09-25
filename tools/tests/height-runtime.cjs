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
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
// 間取りは凍結フィクスチャを読む。出荷する assets/default_plan.json を
// 直接読むと、既定間取りを良くするたびにここが落ちる(役割は tools/tests/fixtures/README.md)。

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
  'usesFinishedHeightModel','defaultFloorThicknessMm','roomFloorTopY',
  'buildRoomFloorMeshes','makeFloorSlabMaterial','clipPolyToRect',
  'roomFloorOffsetMm', 'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'perFloorHeightsEnabled', 'planFloorHeightEntry', 'defaultWallHeightMmForFloor', 'defaultFloorRaiseMmForFloor',
  'floorSlabMmForFloor', 'localSupportTopY', 'segmentInsideRectLengthMm',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'setbackClipsCoverPlan', 'roofCoversPlanPoint',
  'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roofsOverRoom', 'roomCeilingWorldYAtMm', 'roofCeilingOffsetMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomsAtPointOnFloor', 'roomAtPointOnFloor', 'ceilingFinishThicknessM', 'roomCeilingElevationMm',
  'roomSkipLevelMm', 'roomSkipCavityMm', 'roomStoreyFloorTopY', 'roomCeilingCapM',
  'itemIsUnderPlatform', 'ceilingFinishElevationMm', 'defaultLightElevationMm',
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

module.exports={makeCtx,topLevelFunction,topLevelVar};
