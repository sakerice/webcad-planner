// 階段の踊り場・コーナー階段と、スキップフロアとの接続。
//
// 利用者の報告: 階段の踊り場やコーナー階段を使うと、スキップフロアとの接続が壊れる。
//   ・部材の並び(下から上)を外接矩形の長い軸の位置で決めていたので、L字・U字に
//     曲がる階段で歩く順と合わず、踊り場やコーナー階段の高さが入れ替わった。
//     しかも種にした部材によって並びが変わった。
//   ・踊り場を「段差へ上る階段」と「上の階へ上がる階段」の両方のグループに入れていて、
//     高さがデータの並び順で変わった。
//   ・ウォークスルーで、段差へ上る階段の踊り場に乗ると上の階へ移ってしまった。
// 下の各パターンを、4方向に回し、鏡に映した8通りで確かめる(自己検査)。
//
// 以下の読み込みは skip-floor.test.cjs と同じ作り(関数を切り出して node:vm で走らせる)。
//
// 測り方は height-wiring.test.cjs と同じで、index.html / assets/js から高さの
// 関数を波括弧の対応で切り出し、node:vm の上で**実際に走らせて**値を見る。
// grep のアサーションは書き方を変えただけで素通りするので、数値で押さえる。
//
// この検査でいちばん大事なのは 1 番目 --「段差を持たないプランが1mmも動かない」
// である。スキップフロアは既存の高さモデル(床上げ・天井高・階高・壁高)の全部に
// 手を入れるので、そこが保てているかを他の何より先に見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
const PlanSchema = require(join(ROOT, 'assets', 'js', 'plan-schema.js'));
const PLAN = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));

// 名前で関数を1つ切り出す。波括弧の対応で切るので、文字列・コメントの中の
// 括弧に引っかからないよう、その3つの状態だけは追う。
function sliceFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' がソースに無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, line = false, block = false, str = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  assert.fail('function ' + name + ' の閉じ括弧が見つからない');
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' がソースに無い');
  return m[0];
}

const FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'perFloorHeightsEnabled', 'planFloorHeightEntry',
  'defaultWallHeightMmForFloor', 'defaultFloorRaiseMmForFloor',
  'floorSlabMmForFloor', 'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'segmentInsideRectLengthMm', 'localSupportTopY', 'floorHasSkipLevel', 'wallBaseSupportY', 'wallLiftMm',
  'roomSkipLevelMm', 'roomSkipCavityMm', 'roomSkipEdgeNeighbors', 'roomSkipOpenSides',
  'isColumnType', 'columnHeightMm', 'wallSkipBaseMm',
  'rectMinusRect', 'subtractRectsFromRect', 'polyAsAxisRectMm',
  'roomFloorOffsetMm', 'roomFloorTopY', 'roomStoreyFloorTopY', 'roomFloorAt', 'roomStoreyFloorAt',
  'itemIsUnderPlatform', 'item3DBaseY',
  // 壁の開口の床決め。item3DBaseY から呼ぶので、外すと ReferenceError になる。
  'isWallOpeningItem', 'openingAdjacentFloorTopY',
  'baseRoomOf', 'floorRoomIgnoringSkip', 'roomsAtPointOnFloor', 'roomAtPointOnFloor', 'isPositiveNumber',
  'roomsOverlapInPlan', 'overlapStripHiddenByWall', 'segmentInsideRectLengthMm', 'roomAboveRoom', 'roomHasRoomAbove', 'roomDeclaresSlopedCeiling',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomExplicitCeilingMm', 'roomCeilingCapM', 'roomCeilingHeightM', 'roomRenderedCeilingMm',
  'roomLevelLabel', 'usesFinishedHeightModel', 'ceilingFinishThicknessM',
  'roomCeilingElevationMm', 'shiftRoomCeilingFixtures', 'followRoomCeiling',
  'ceilingFinishElevationMm', 'ceilingAttachElevationMm', 'roofTopLimitAtPlanPoint',
  'roofCoversPlanPoint', 'roofUndersideWorldYAt', 'roofBaseWorldY', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackOutlineCoversLocal', 'wallFullHeightM',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM', 'wallStackedAboveCapM',
  'wallFullHeightM', 'wallHeightMm', 'wallDisplayHeightM',
  'wallSkipLevelsMm', 'wallSkipFootMm', 'floorMaxSkipLevelMm',
  'isStairPartType', 'stairBounds2D', 'stairPartsTouch', 'stairPartEdgesMm', 'stairPartShapeKey', 'stairPartEdgesRaw', 'stairPartsLinkRaw', 'hasStairOrder', 'stairTouchingUnlinked', 'walkFloorLandingGroundAt', 'walkFlatGroundAt', 'stairEdgesFace', 'stairPartsLink', 'stairPartsLinked', 'stairGroupChainInfo', 'stairChainFreeEnds', 'getConnectedStairParts', 'stairLandingIsLevel', 'stairLandingTopY',
  'isLevelStairPart', 'isFloorLanding', 'landingFloorLevelMm', 'landingFloorTopY', 'floorLandingBaseY', 'floorLandingAtMm', 'stairFloorAtMm', 'stairGroupTargetFloor', 'stairChainParts', 'stairGroupIsLevel', 'stairLevelSpanM', 'stairGroupRiseM',
  'stairPartEndMm', 'stairLocalProgress', 'walkLevelStairGroundAt', 'walkStairSampleAt', 'stairPartPortsMm', 'stairPointOnPart', 'stairGroupChainOrder', 'stairGroupOrdered', 'stairRunEndsMm', 'stairFootY', 'stairGroupBase', 'stairExplicitFootY', 'stairUpperSpanM', 'stairRiseInfo',
  'stairStyleOf', 'stairHasRisers', 'latticePitchMm', 'latticeSlatMm', 'latticeClearMm', 'latticeHasCap',
  'stairRailSides', 'stairSideHasWall', 'stairRailMountFor', 'isStairLandingType',
  'railPolylineYAt', 'railStepYAt', 'stairBalusterSeats', 'stairRailExtendEnds', 'stairRailStationsAlong',
  'railInfillOf', 'railBarCount', 'railCapColorOf', 'railFrameColorOf',
  'stairRailFrameColorOf', 'stairRailColorOf', 'railingDesignHtml', 'canSetItemTexture',
  'stairStepCount', 'getStairStepCount',
  'stairQuadOf', 'levelStairQuadsForFloor', 'stairwellQuadsForFloor', 'stairUnderFilled',
  'levelStairHolesForRoom', 'stairwellHolesForRoom', 'clipPolyToRect', 'polyAreaAbs',
  'shelfBoardCount', 'shelfHeightMm', 'shelfIsWallSupported', 'shelfSideBoards'
];

function heights(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    HeightModel: HeightModel,
    DATA: data,
    ISIZES: { stair: { w: 910, d: 2730 }, 'stair-corner': { w: 910, d: 910 } },
    // item3DBaseY の外構まわりの枝はこの検査の対象外なので、通らないように固定する。
    isGroundLevelItemType: () => false,
    isContextExteriorItemType: () => false,
    isFloorAwareGroundItemType: () => false,
    groundYForItem: () => 0,
    itemOnFoundation: () => true,
    roomDisplayLabel: () => '部屋',
    roomRoofCeilingExtent: () => null,
    roomCeilingProfile: () => null,
    roomRenderedCeilingLabel: () => 'CH 2400',
    // canSetItemTexture が見る種類の判定。階段以外はこの検査の対象外。
    isCustomBlockType: () => false,
    isDoorItemType: () => false
  });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'), topLevelVar('U'),
    topLevelVar('SKIP_LEVEL_MAX_MM'), topLevelVar('LANDING_LEVEL_MAX_MM'), topLevelVar('STAIR_LINK_GAP_MM'), topLevelVar('_stairEdgeCache'), topLevelVar('_stairLinkCache'), topLevelVar('_stairLinkCacheSize'), topLevelVar('_stairStepDepth'), topLevelVar('STAIR_LINK_OVERLAP_MM'), topLevelVar('STAIR_LINK_MIN_SPAN_MM'), topLevelVar('SKIP_CAVITY_MIN_MM'),
    topLevelVar('SHELF_BOARD_T_MM'),
    topLevelVar('STAIR_BALUSTER_GAP_MAX_M'), topLevelVar('STAIR_BALUSTER_MM'),
    topLevelVar('STAIR_NEWEL_MM'), topLevelVar('STAIR_RAIL_END_EXT_M'),
    topLevelVar('STAIR_RAIL_BRACKET_PITCH_M'), topLevelVar('RAIL_INFILL_VALUES'),
    topLevelVar('STAIR_RAIL_HEIGHT_MM'),
    topLevelVar('_ceilingClampWarned'), topLevelVar('ROOM_OVERLAP_EPS_MM'), topLevelVar('ROOM_OVERLAP_WALL_TOL_MM'),
    topLevelVar('CEILING_FINISH_M'), topLevelVar('CEILING_FIXTURE_TOP_MM')
  ].concat(FNS.map(sliceFunction)).join('\n'), ctx);
  return ctx;
}


// ── 部材と家 ──────────────────────────────────────────────────────────────
// 中心で置く。rot: 0 は南(+y)へ上る、180 は北、-90 は東、90 は西。
function P(id, type, cx, cy, w, d, rot, extra) {
  return Object.assign({ id, type, floor: 1, x: cx - w / 2, y: cy - d / 2, w, d, rot, stairTarget: 'level' }, extra || {});
}
const HALL_DECK = [
  { id: 'hall', n: 'ホール', floor: 1, x: 0, y: 0, w: 4000, d: 6000 },
  { id: 'deck', n: 'スキップ', floor: 1, x: 4000, y: 0, w: 3000, d: 6000, skipLevelMm: 1800 }
];
// 全体を (5000,5000) まわりに q×90° 回し、mirror なら左右に映す。
function xform(parts, rooms, q, mirror) {
  const C = 5000;
  function pt(x, y) { let dx = x - C, dy = y - C; if (mirror) dx = -dx; for (let i = 0; i < q; i++) { const t = dx; dx = -dy; dy = t; } return [C + dx, C + dy]; }
  const ps = parts.map((p) => {
    const [nx, ny] = pt(p.x + p.w / 2, p.y + p.d / 2);
    const o = Object.assign({}, p, { x: nx - p.w / 2, y: ny - p.d / 2, rot: (mirror ? -p.rot : p.rot) + 90 * q });
    if (mirror && p.type === 'stair-corner') o.flipX = !p.flipX;
    return o;
  });
  const rs = rooms.map((r) => { const a = pt(r.x, r.y), b = pt(r.x + r.w, r.y + r.d);
    return Object.assign({}, r, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), d: Math.abs(a[1] - b[1]) }); });
  return { ps, rs };
}
// 各部材の [下端, 上端](階の床からの mm)。
function partHeights(g, items) {
  const fl = g.floorTopY(1), mm = (v) => Math.round((v - fl) / g.U), out = {};
  items.forEach((it) => {
    const ri = g.stairRiseInfo(it);
    const sp = g.stairGroupIsLevel(it) ? g.stairLevelSpanM(it) : g.stairUpperSpanM(it);
    out[it.id] = [mm(sp.baseY + ri.base), mm(sp.baseY + ri.base + ri.rise)];
  });
  return out;
}
// 下から上への順 chain で、床(0)から段差(+1800)まで途切れずに上ること。
function assertClimb(name, parts, rooms, chain, top) {
  for (const mirror of [false, true]) for (let q = 0; q < 4; q++) {
    const { ps, rs } = xform(parts, rooms, q, mirror);
    const g = heights({ floors: {}, walls: [], items: ps, rooms: rs });
    const h = partHeights(g, ps), where = name + ' ' + (mirror ? '鏡' : '') + q * 90 + '°: ' + JSON.stringify(h);
    // どの部材を種にしても同じ並び
    const orders = ps.map((p) => g.stairGroupOrdered(p).map((o) => o.id).join('>'));
    assert.ok(orders.every((o) => o === chain.join('>')), where + ' 並び ' + JSON.stringify(orders));
    assert.equal(h[chain[0]][0], 0, where + ' 床から始まっていない');
    assert.equal(h[chain[chain.length - 1]][1], top, where + ' 段差に着いていない');
    for (let i = 1; i < chain.length; i++)
      assert.ok(Math.abs(h[chain[i]][0] - h[chain[i - 1]][1]) <= 1, where + ' ' + chain[i - 1] + '→' + chain[i] + ' が途切れている');
    chain.forEach((id) => {
      const p = ps.find((o) => o.id === id);
      if (p.type === 'stair-landing') assert.equal(h[id][0], h[id][1], where + ' 踊り場が平らでない');
      else assert.ok(h[id][1] > h[id][0], where + ' ' + id + ' が上っていない');
    });
  }
}

test('直階段(基準)', () => {
  assertClimb('直階段', [P('r1', 'stair', 4000 - 1365, 3000, 910, 2730, -90)], HALL_DECK, ['r1'], 1800);
});
test('L字: 直階段 → 踊り場 → 直階段', () => {
  assertClimb('L字踊り場', [P('r1', 'stair', 2000, 4000, 910, 1800, 180), P('L', 'stair-landing', 2000, 2645, 910, 910, 0),
    P('r2', 'stair', 3227.5, 2645, 910, 1545, -90)], HALL_DECK, ['r1', 'L', 'r2'], 1800);
});
test('L字: 直階段 → コーナー階段 → 直階段', () => {
  assertClimb('L字コーナー', [P('r1', 'stair', 2000, 4000, 910, 1800, 180), P('C', 'stair-corner', 2000, 2645, 910, 910, 0),
    P('r2', 'stair', 3227.5, 2645, 910, 1545, -90)], HALL_DECK, ['r1', 'C', 'r2'], 1800);
});
test('U字: 直階段 → 踊り場(折り返し) → 直階段', () => {
  assertClimb('U字', [P('r1', 'stair', 2500, 4000, 910, 2000, -90), P('L', 'stair-landing', 3955, 3545, 910, 1820, 0),
    P('r2', 'stair', 2500, 3090, 910, 2000, 90)],
  [{ id: 'hall', n: 'ホール', floor: 1, x: 0, y: 3545, w: 5000, d: 3000 },
   { id: 'deck', n: 'スキップ', floor: 1, x: 0, y: 0, w: 5000, d: 3545, skipLevelMm: 1800 }], ['r1', 'L', 'r2'], 1800);
});
test('踊り場で終わる(踊り場からスキップフロアへ)', () => {
  assertClimb('踊り場で終わる', [P('r1', 'stair', 3090 - 1200, 3000, 910, 2400, -90), P('L', 'stair-landing', 3545, 3000, 910, 910, 0)],
    HALL_DECK, ['r1', 'L'], 1800);
});
test('コーナー階段で終わる(出口がスキップフロア)', () => {
  assertClimb('コーナーで終わる', [P('r1', 'stair', 2000, 4000, 910, 1800, 180), P('C', 'stair-corner', 2000, 2645, 910, 910, 0)],
    [{ id: 'hall', n: 'ホール', floor: 1, x: 0, y: 0, w: 2455, d: 6000 },
     { id: 'deck', n: 'スキップ', floor: 1, x: 2455, y: 0, w: 3000, d: 6000, skipLevelMm: 1800 }], ['r1', 'C'], 1800);
});
test('踊り場から始まる / コーナー階段から始まる', () => {
  assertClimb('踊り場で始まる', [P('L', 'stair-landing', 1500, 3000, 910, 910, 0), P('r1', 'stair', 1955 + 1022.5, 3000, 910, 2045, -90)],
    HALL_DECK, ['L', 'r1'], 1800);
  assertClimb('コーナーで始まる', [P('C', 'stair-corner', 2000, 4000, 910, 910, 0), P('r2', 'stair', 2455 + 772.5, 4000, 910, 1545, -90)],
    HALL_DECK, ['C', 'r2'], 1800);
});
test('踊り場が2枚続く(広いL字の踊り場)', () => {
  assertClimb('踊り場2枚', [P('r1', 'stair', 1500, 4200, 910, 1600, 180), P('L1', 'stair-landing', 1500, 2945, 910, 910, 0),
    P('L2', 'stair-landing', 2410, 2945, 910, 910, 0), P('r2', 'stair', 2865 + 567.5, 2945, 910, 1135, -90)],
  HALL_DECK, ['r1', 'L1', 'L2', 'r2'], 1800);
});

// ── 段差へ上って踊り場に着き、そこから上の階へ上がる(利用者のプランの形) ──
// ホール(0) → 段差へ上る階段(東) → 踊り場A → 踊り場B(スキップ +1800 に接する)
//           → 上の階へ上がる階段(西へ) → 2階
function mixedHouse(reverse) {
  const items = [
    P('lv', 'stair', 2000, 4500, 910, 2000, -90),
    P('LA', 'stair-landing', 3455, 4500, 910, 910, 0),
    P('LB', 'stair-landing', 3455, 3590, 910, 910, 0),
    P('up', 'stair', 2000, 3590, 910, 2000, 90, { stairTarget: undefined })
  ];
  const d = {
    floors: {}, walls: [],
    rooms: [
      { id: 'hall', n: 'ホール', floor: 1, x: 0, y: 0, w: 3000, d: 6000 },
      { id: 'deck', n: 'スキップ', floor: 1, x: 3910, y: 0, w: 3000, d: 6000, skipLevelMm: 1800 },
      { id: 'f2', n: '2階', floor: 2, x: 0, y: 0, w: 7000, d: 6000 }
    ],
    items: reverse ? items.slice().reverse() : items
  };
  return d;
}
test('段差へ上る階段の踊り場から、上の階へ上がる階段を出せる(データの並び順に依らない)', () => {
  for (const rev of [false, true]) {
    const g = heights(mixedHouse(rev));
    const h = partHeights(g, g.DATA.items), fl2 = Math.round((g.floorTopY(2) - g.floorTopY(1)) / g.U);
    const where = (rev ? '逆順 ' : '') + JSON.stringify(h);
    assert.deepEqual(h.lv, [0, 1800], where);
    assert.deepEqual(h.LA, [1800, 1800], where);
    assert.deepEqual(h.LB, [1800, 1800], where);
    assert.deepEqual(h.up, [1800, fl2], where + ' 上の階へ上がる階段が踊り場から始まっていない');
    const byId = (id) => g.DATA.items.find((o) => o.id === id);
    assert.equal(g.stairGroupIsLevel(byId('LB')), true, '踊り場が段差へ上る階段のグループに入っていない');
    assert.equal(g.getConnectedStairParts(byId('up')).length, 1, '上の階へ上がる階段のグループに踊り場が入っている');
  }
});
test('ウォークスルー: 段差へ上る階段の踊り場では上の階へ移らず、踊り場の高さに立つ', () => {
  const g = heights(mixedHouse(false));
  // 踊り場Bの中心
  assert.equal(Math.round(g.walkLevelStairGroundAt(3455, 3590, 1) / g.U), 1800);
  assert.equal(g.walkStairSampleAt(3455, 3590, 1, 0), null, '踊り場が上の階への経路として数えられている');
  // 上の階へ上がる階段は、踊り場の高さから上り始める
  const s = g.walkStairSampleAt(2900, 3590, 1, 0);
  assert.ok(s && Math.round(s.offM / g.U) >= 1800, '上の階への階段の下端が踊り場より低い: ' + JSON.stringify(s));
});
