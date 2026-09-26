// 階段の部材どうしの接続(出入り口の辺どうしが向き合うときだけつながる)と、
// 踊り場の2つの使い方(階段の一部 / 高さを指定した床)。
//
// 利用者の指摘: 「階段の一部として使う場合の接続条件はシビアで、まともな判定で
// 動いていないかもしれない。これまでも使い勝手が良くなかった」。
// 以前は外接矩形が 220mm 以内に並べばつながったので、U字の2本の脚の横腹や、
// 横に並べた踊り場までつながった。回転も外接矩形では見られなかった。
//
// 読み込みは stair-landing-chain.test.cjs と同じ作り(関数を切り出して node:vm で走らせる)。
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
  'isStairPartType', 'stairBounds2D', 'stairPartsTouch', 'stairPartEdgesMm', 'stairPartShapeKey', 'stairPartEdgesRaw', 'stairPartsLinkRaw', 'hasStairOrder', 'stairTouchingUnlinked', 'walkFloorLandingGroundAt', 'walkFlatGroundAt', 'walkUnderDeckAt', 'stairEdgesFace', 'stairPartsLink', 'stairPartsLinked', 'stairGroupChainInfo', 'stairChainFreeEnds', 'getConnectedStairParts', 'stairLandingIsLevel', 'stairLandingTopY',
  'isLevelStairPart', 'isFloorLanding', 'landingFloorLevelMm', 'landingFloorTopY', 'floorLandingBaseY', 'floorLandingAtMm', 'stairFloorAtMm', 'stairGroupTargetFloor', 'stairChainParts', 'stairTargetCandidates', 'skipRoomsOnFloor', 'baseRoomLabel', 'stairGroupIsLevel', 'stairLevelSpanM', 'stairGroupRiseM',
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
    topLevelVar('SKIP_LEVEL_MAX_MM'), topLevelVar('LANDING_LEVEL_MAX_MM'), topLevelVar('STAIR_LINK_GAP_MM'), topLevelVar('_stairEdgeCache'), topLevelVar('_stairLinkCache'), topLevelVar('_stairLinkCacheSize'), topLevelVar('STAIR_LINK_OVERLAP_MM'), topLevelVar('STAIR_LINK_MIN_SPAN_MM'), topLevelVar('SKIP_CAVITY_MIN_MM'),
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



// 中心で置く。rot: 0 は南(+y)へ上る、180 は北、-90 は東、90 は西。
function P(id, type, cx, cy, w, d, rot, extra) {
  return Object.assign({ id, type, floor: 1, x: cx - w / 2, y: cy - d / 2, w, d, rot }, extra || {});
}
function house(items, rooms) {
  return { floors: {}, walls: [], items,
    rooms: (rooms || [{ id: 'hall', n: 'ホール', floor: 1, x: -5000, y: -5000, w: 20000, d: 20000 }])
      .concat([{ id: 'f2', n: '2階', floor: 2, x: -5000, y: -5000, w: 20000, d: 20000 }]) };
}
// 全体を原点まわりに deg 度回す(部材の向きも一緒に)。
function rotateAll(items, deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return items.map((p) => {
    const cx = p.x + p.w / 2, cy = p.y + p.d / 2, nx = cx * c - cy * s, ny = cx * s + cy * c;
    return Object.assign({}, p, { x: nx - p.w / 2, y: ny - p.d / 2, rot: (p.rot || 0) + deg });
  });
}
const ids = (list) => list.map((o) => o.id).join('>');
function mmOf(g, it) {
  const fl = g.floorTopY(it.floor || 1), ri = g.stairRiseInfo(it), b = g.item3DBaseY(it);
  return [Math.round((b + ri.base - fl) / g.U), Math.round((b + ri.base + ri.rise - fl) / g.U)];
}

// L字: 北へ上る直階段 → 踊り場 → 東へ上る直階段(上の階へ)
function lShape(extra) {
  return [P('r1', 'stair', 0, 2000, 910, 2000, 180), P('L', 'stair-landing', 0, 545, 910, 910, 0),
    P('r2', 'stair', 455 + 1000, 545, 910, 2000, -90)].map((o) => Object.assign(o, extra || {}));
}

test('L字は、どの角度に回しても1本の階段として下から並ぶ', () => {
  for (const deg of [0, 30, 45, 90, 137, 180, 270]) {
    const g = heights(house(rotateAll(lShape(), deg)));
    const it = g.DATA.items;
    for (const seed of it) assert.equal(ids(g.stairGroupOrdered(seed)), 'r1>L>r2', deg + '°');
    const h = Object.fromEntries(it.map((o) => [o.id, mmOf(g, o)]));
    assert.equal(h.r1[1], h.L[0], deg + '° 下の段と踊り場が途切れている ' + JSON.stringify(h));
    assert.equal(h.L[1], h.r2[0], deg + '° 踊り場と上の段が途切れている ' + JSON.stringify(h));
    assert.ok(h.L[0] > h.r1[0] && h.L[0] < h.r2[1], deg + '° 踊り場が途中の高さにない ' + JSON.stringify(h));
  }
});

test('直階段の横腹どうしはつながらない(U字の2本の脚)', () => {
  // 東へ上る脚と、そのすぐ北で西へ上る脚。横腹が接している。
  const a = P('a', 'stair', 0, 0, 910, 2000, -90), b = P('b', 'stair', 0, -910, 910, 2000, 90);
  const g = heights(house([a, b]));
  assert.equal(g.stairPartsLinked(g.DATA.items[0], g.DATA.items[1]), false);
  assert.equal(g.getConnectedStairParts(g.DATA.items[0]).length, 1);
});

test('U字: 2本の脚が同じ踊り場の辺へ出入りすると、1本になる', () => {
  const a = P('a', 'stair', 0, 0, 910, 2000, -90);               // 東へ、x=1000 で上端
  const L = P('L', 'stair-landing', 1455, -455, 910, 1820, 0);     // x=1000..1910
  const b = P('b', 'stair', 0, -910, 910, 2000, 90);               // 西へ、x=1000 が下端
  const g = heights(house([b, L, a]));
  for (const seed of g.DATA.items) assert.equal(ids(g.stairGroupOrdered(seed)), 'a>L>b');
  const info = g.stairGroupChainInfo(g.getConnectedStairParts(g.DATA.items[0]));
  assert.equal(info.conflicts.length + info.branches.length, 0);
});

test('直階段の横に当てただけの踊り場はつながらない', () => {
  const a = P('a', 'stair', 0, 0, 910, 2000, -90);                 // x=-1000..1000, y=-455..455
  const L = P('L', 'stair-landing', 0, 910, 910, 910, 0);          // 横腹(南側)に接する
  const g = heights(house([a, L]));
  assert.equal(g.stairPartsLinked(g.DATA.items[0], g.DATA.items[1]), false);
});

test('隙間は 220mm までつながり、それを超えると切れる。辺が少ししか重ならないときも切れる', () => {
  const at = (gap, shift) => {
    const a = P('a', 'stair', 0, 0, 910, 2000, -90);
    const L = P('L', 'stair-landing', 1000 + gap + 455, shift || 0, 910, 910, 0);
    const g = heights(house([a, L]));
    return g.stairPartsLinked(g.DATA.items[0], g.DATA.items[1]);
  };
  assert.equal(at(0), true);
  assert.equal(at(200), true);
  assert.equal(at(-150), true, '少し食い込んでもつながる');
  assert.equal(at(300), false);
  assert.equal(at(0, 700), false, '辺が 210mm しか重ならない(3割未満)');
  assert.equal(at(0, 400), true, '辺が 510mm 重なる');
});

test('上端どうしが向き合うと、並べずに食い違いとして返す', () => {
  const a = P('a', 'stair', 0, 0, 910, 2000, -90);                 // 東へ、上端 x=1000
  const b = P('b', 'stair', 2000, 0, 910, 2000, 90);               // 西へ、上端 x=1000
  const g = heights(house([a, b]));
  const info = g.stairGroupChainInfo(g.getConnectedStairParts(g.DATA.items[0]));
  assert.equal(info.order, null);
  assert.equal(info.conflicts.length, 1);
});

// ── 床として使う踊り場 ────────────────────────────────────────────────────
function floorLandingHouse(extraUp) {
  return house([
    P('lv', 'stair', 0, 0, 910, 2000, -90, { stairTarget: 'level', stairTo: 'F' }),   // 東へ
    P('F', 'stair-landing', 1455, 0, 910, 910, 0, { landingMode: 'floor', landingLevelMm: 1200 }),
    P('up', 'stair', 1455, -1455, 910, 2000, 180, extraUp)                           // 踊り場の北辺から北へ
  ]);
}
test('床として使う踊り場: 行き先に指定した階段はその高さまで上り、次の階段はそこから上る', () => {
  const g = heights(floorLandingHouse());
  const [lv, F, up] = g.DATA.items;
  assert.deepEqual(mmOf(g, lv), [0, 1200]);
  assert.deepEqual(mmOf(g, F), [1200, 1200]);
  assert.equal(mmOf(g, up)[0], 1200, '上の階への階段が踊り場の高さから始まっていない');
  assert.equal(mmOf(g, up)[1], Math.round((g.floorTopY(2) - g.floorTopY(1)) / g.U));
  // 床の踊り場は階段の部材ではない: どの階段のグループにも入らない
  assert.equal(ids(g.getConnectedStairParts(lv)), 'lv');
  assert.equal(ids(g.getConnectedStairParts(up)), 'up');
  assert.equal(ids(g.getConnectedStairParts(F)), 'F');
  // 行き先の候補に並ぶ
  assert.equal(g.stairTargetCandidates(lv).map((c) => c.id).join(','), 'F');
});
test('床として使う踊り場は、上の階の床に穴を開けず、ウォークスルーではその高さに立つ', () => {
  const g = heights(floorLandingHouse());
  const [, F] = g.DATA.items;
  assert.equal(g.stairwellQuadsForFloor(2).length, 1, '穴は上の階への階段の1つだけ');
  assert.equal(Math.round(g.walkFloorLandingGroundAt(1455, 0, 1) / g.U), 1200);
  assert.equal(g.walkLevelStairGroundAt(1455, 0, 1, 120), null, '床の踊り場が段差用の階段として数えられている(横から乗り上がれてしまう)');
  assert.equal(Math.round(g.walkFlatGroundAt(1455, 0, 1) / g.U), 1200);
  assert.equal(Math.round(g.walkFlatGroundAt(1455, 600, 1) / g.U), 0, '踊り場の外 145mm でも持ち上がっている');
  assert.equal(g.walkStairSampleAt(1455, 0, 1, 0), null, '床の踊り場が上の階への経路になっている');
  F.landingLevelMm = 900;
  assert.deepEqual(mmOf(g, g.DATA.items[0]), [0, 900], '高さを変えると、行き先にしている階段がついてこない');
});
test('行き先を指定しなくても、床の踊り場に着く段差用の階段はその高さまで上る', () => {
  const d = floorLandingHouse();
  delete d.items[0].stairTo;
  const g = heights(d);
  assert.deepEqual(mmOf(g, g.DATA.items[0]), [0, 1200]);
});
test('階段の一部の踊り場で始まる階段は、隣の床の踊り場の高さから始まる(部屋の床より優先)', () => {
  // 床の踊り場 F(+1500) の北に、階段の一部の踊り場 L。L の西辺から西へ上の階へ。
  const g = heights(house([
    P('F', 'stair-landing', 0, 0, 910, 910, 0, { landingMode: 'floor', landingLevelMm: 1500 }),
    P('L', 'stair-landing', 0, -910, 910, 910, 0),
    P('up', 'stair', -455 - 1000, -910, 910, 2000, 90)
  ]));
  const [, L, up] = g.DATA.items;
  assert.equal(ids(g.stairGroupOrdered(up)), 'L>up');
  assert.deepEqual(mmOf(g, L), [1500, 1500]);
  assert.equal(mmOf(g, up)[0], 1500);
});

// ── レビューで挙がった形 ──────────────────────────────────────────────────
test('旧来の組み方: 高さ順を指定して横腹で並べた2本は、これまでどおり1本として割る', () => {
  const g = heights(house([
    P('a', 'stair', 455, 0, 910, 2000, 180, { stairOrder: 1 }),
    P('b', 'stair', 1365, 0, 910, 2000, 0, { stairOrder: 2 })
  ]));
  const [a, b] = g.DATA.items;
  assert.equal(ids(g.stairGroupOrdered(a)), 'a>b');
  const ha = mmOf(g, a), hb = mmOf(g, b);
  assert.equal(ha[1], hb[0], JSON.stringify([ha, hb]));
  assert.ok(ha[1] > 0 && hb[1] > ha[1]);
});
test('踊り場が階段の上端に 400mm 食い込んでいても、1本につながる', () => {
  const g = heights(house([
    P('s', 'stair', 0, 0, 910, 2000, -90),                        // 上端 x=1000
    P('L', 'stair-landing', 1000 - 400 + 455, 0, 910, 910, 0),
    P('t', 'stair', 1000 - 400 + 455, -455 - 1000, 910, 2000, 180)
  ]));
  assert.equal(ids(g.stairGroupOrdered(g.DATA.items[0])), 's>L>t');
});
test('横腹に当てた部材は、つながっていない部材として知らせる', () => {
  const g = heights(house([P('a', 'stair', 0, 0, 910, 2000, -90), P('L', 'stair-landing', 0, 910, 910, 910, 0)]));
  assert.equal(ids(g.stairTouchingUnlinked(g.DATA.items[0])), 'L');
  // つながっている L字では何も出ない
  const h = heights(house(lShape()));
  assert.equal(h.stairTouchingUnlinked(h.DATA.items[0]).length, 0);
});
test('反転(flipY)した直階段は、上端と下端が入れ替わる', () => {
  const a = P('a', 'stair', 0, 0, 910, 2000, -90, { flipY: true });   // 西へ上る(x=-1000 が上端)
  const L = P('L', 'stair-landing', -1455, 0, 910, 910, 0);
  const b = P('b', 'stair', -1455, -1455, 910, 2000, 180);
  const g = heights(house([b, L, a]));
  assert.equal(ids(g.stairGroupOrdered(g.DATA.items[0])), 'a>L>b');
});
test('踊り場どうしだけのグループでは並びを決めず、位置の順に戻る(止まる)', () => {
  const g = heights(house([P('L1', 'stair-landing', 0, 0, 910, 910, 0), P('L2', 'stair-landing', 910, 0, 910, 910, 0)]));
  const info = g.stairGroupChainInfo(g.getConnectedStairParts(g.DATA.items[0]));
  assert.equal(info.order, null);
  assert.equal(info.undirected.length, 1);
  assert.equal(g.stairGroupOrdered(g.DATA.items[0]).length, 2);
});
test('行き先に指した床の踊り場から階段を離すと、指定は効かなくなる(欄の表示と一致)', () => {
  const d = floorLandingHouse();
  d.items[0].x -= 1000;                                                    // 踊り場から 1000mm 離す
  const g = heights(d);
  assert.equal(g.stairGroupTargetFloor(g.getConnectedStairParts(g.DATA.items[0])), null);
  assert.equal(g.stairTargetCandidates(g.DATA.items[0]).length, 0);
});
test('床の踊り場の上から上の階へ上がる階段は、実際の上り高さから段数を出す(蹴上げがそろう)', () => {
  const g = heights(floorLandingHouse());
  const up = g.DATA.items[2], rise = mmOf(g, up)[1] - mmOf(g, up)[0];
  const steps = g.getStairStepCount(up);
  assert.ok(rise / steps >= 150 && rise / steps <= 230, '蹴上げ ' + (rise / steps) + 'mm(' + steps + '段)');
});
test('普通の床から上る階段の段数は、従来どおり階高から出す', () => {
  const g = heights(house(lShape()));
  const r1 = g.DATA.items[0];
  assert.equal(g.getStairStepCount(r1), g.stairStepCount(g.FLOOR_H, r1.d));
});
test('段差の部屋から上の階へ上がる既存の階段の段数は変わらない(階高から出す)', () => {
  const g = heights(house([P('up', 'stair', 0, 1000, 910, 2000, 180)],
    [{ id: 'hall', n: 'ホール', floor: 1, x: -5000, y: -5000, w: 20000, d: 20000 },
     { id: 'deck', n: 'スキップ', floor: 1, x: -2000, y: 2000, w: 4000, d: 3000, skipLevelMm: 700 }]));
  const up = g.DATA.items[0];
  assert.equal(mmOf(g, up)[0], 700, '前提: 段差の上から上る');
  assert.equal(g.getStairStepCount(up), g.stairStepCount(g.FLOOR_H, up.d));
});
test('床の踊り場で折り返す2本には、つながっていない警告を出さない', () => {
  // 北へ上る段差用の階段 lv → 床の踊り場 F(1820 幅) → lv の真横を南へ上る up
  const g = heights(house([
    P('lv', 'stair', 0, 0, 910, 2000, 180, { stairTarget: 'level', stairTo: 'F' }),       // 上端 y=-1000
    P('F', 'stair-landing', 455, -1455, 1820, 910, 0, { landingMode: 'floor', landingLevelMm: 1200 }),
    P('up', 'stair', 910, 0, 910, 2000, 0)                                               // 下端 y=-1000
  ]));
  const [lv, F, up] = g.DATA.items;
  assert.deepEqual(mmOf(g, lv), [0, 1200]);
  assert.equal(mmOf(g, up)[0], 1200);
  assert.equal(g.stairTouchingUnlinked(lv).length, 0);
  assert.equal(g.stairTouchingUnlinked(up).length, 0);
});
test('部材を動かす・高さ順を変える・使い方を切り替えると、つながりの結果も変わる(古い結果を返さない)', () => {
  const g = heights(house(lShape()));
  const [r1, L, r2] = g.DATA.items;
  assert.equal(g.stairPartsLinked(L, r2), true);
  r2.x += 600;                                         // 踊り場から離す
  assert.equal(g.stairPartsLinked(L, r2), false);
  r2.x -= 600;
  assert.equal(g.stairPartsLinked(L, r2), true);
  L.landingMode = 'floor'; L.landingLevelMm = 1000;
  assert.equal(g.getConnectedStairParts(r1).length, 1, '床にした踊り場を越えてつながっている');
  delete L.landingMode; delete L.landingLevelMm;
  assert.equal(g.getConnectedStairParts(r1).length, 3);
});

// ── 段差の下の部屋(ハーフ収納)へ歩いて入る ──────────────────────────────
// 利用者の報告: 1F のウォークスルーでハーフ収納に入れない。足元の床を、上に
// 重なった段差の部屋の天端(+1800)で見ていたので、1.8m の段差として止められていた。
function underDeckHouse(withStorage) {
  const rooms = [{ id: 'ldk', n: 'LDK', floor: 1, x: 0, y: 3000, w: 6000, d: 3000 },
    { id: 'deck', n: 'スキップ', floor: 1, x: 0, y: 0, w: 3000, d: 3000, skipLevelMm: 1800 }];
  if (withStorage) rooms.push({ id: 'st', n: 'ハーフ収納', floor: 1, x: 0, y: 0, w: 3050, d: 3000 });
  return house([], rooms);
}
test('段差の下に部屋があれば、下に居る間はその床に立ち、上に居れば段差の天端に立つ', () => {
  const g = heights(underDeckHouse(true));
  const mmOff = (v) => Math.round(v / g.U);
  assert.equal(mmOff(g.walkFlatGroundAt(1500, 1500, 1, 0)), 0, '下から入ると収納の床');
  assert.equal(mmOff(g.walkFlatGroundAt(1500, 1500, 1, 1.8)), 1800, '段差の上では天端');
  assert.equal(mmOff(g.walkFlatGroundAt(1500, 1500, 1)), 1800, '高さを渡さなければ従来どおり天端');
  const u = g.walkUnderDeckAt(1500, 1500, 1);
  assert.ok(u && u.deckBottomOff > 1.5 && u.deckBottomOff < 1.8, JSON.stringify(u));
});
test('段差の下に部屋が無ければ、これまでどおり入れない(段差の天端として扱う)', () => {
  const g = heights(underDeckHouse(false));
  assert.equal(g.walkUnderDeckAt(1500, 1500, 1), null);
  assert.equal(Math.round(g.walkFlatGroundAt(1500, 1500, 1, 0) / g.U), 1800);
});
