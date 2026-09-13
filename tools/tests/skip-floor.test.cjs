// スキップフロア(同じ階の中の段差)の検査。
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
  'roomFloorOffsetMm', 'roomFloorTopY', 'roomStoreyFloorTopY', 'roomFloorAt', 'roomStoreyFloorAt',
  'itemIsUnderPlatform', 'item3DBaseY',
  'roomAtPointOnFloor', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove', 'roomDeclaresSlopedCeiling',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomExplicitCeilingMm', 'roomCeilingCapM', 'roomCeilingHeightM', 'roomRenderedCeilingMm',
  'roomLevelLabel',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM', 'wallStackedAboveCapM',
  'wallFullHeightM', 'wallHeightMm', 'wallDisplayHeightM',
  'isStairPartType', 'stairBounds2D', 'stairPartsTouch', 'getConnectedStairParts',
  'isLevelStairPart', 'stairGroupIsLevel', 'stairLevelSpanM', 'stairGroupRiseM',
  'stairFloorBuildupM', 'stairGroupTotalRiseM', 'stairRiseInfo',
  'stairStepCount', 'getStairStepCount',
  'stairQuadOf', 'levelStairQuadsForFloor', 'stairwellQuadsForFloor', 'stairUnderFilled',
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
    roomRenderedCeilingLabel: () => 'CH 2400'
  });
  vm.runInContext([
    topLevelVar('WALL_H'), topLevelVar('FLOOR_H'), topLevelVar('FLOOR_SLAB_H'), topLevelVar('U'),
    topLevelVar('SKIP_LEVEL_MAX_MM'), topLevelVar('SKIP_CAVITY_MIN_MM'),
    topLevelVar('SHELF_BOARD_T_MM'),
    topLevelVar('_ceilingClampWarned'), topLevelVar('ROOM_OVERLAP_EPS_MM')
  ].concat(FNS.map(sliceFunction)).join('\n'), ctx);
  return ctx;
}

// ── 試験用の家 ────────────────────────────────────────────────────────────
// 1階に「低い側」と「段差の上」の2部屋。段差の上には壁を1本立てられる。
function skipHouse(opts) {
  const o = opts || {};
  const rooms = [
    { id: 'low', n: 'LDK', floor: 1, x: 0, y: 0, w: 4000, d: 4000 },
    { id: 'up', n: '書斎', floor: 1, x: 4000, y: 0, w: 3000, d: 4000 }
  ];
  if (o.skip !== undefined) rooms[1].skipLevelMm = o.skip;
  if (o.raise !== undefined) rooms[1].floorRaiseMm = o.raise;
  if (o.ceilingMm !== undefined) rooms[1].ceiling = { type: 'flat', heightMm: o.ceilingMm };
  if (o.upperRoom) rooms.push({ id: 'f2', n: '2階', floor: 2, x: 4000, y: 0, w: 3000, d: 4000 });
  const walls = [
    // 段差の境界に立つ壁。両側が部屋なので wallCeilingHeightM は天井高を採る。
    { id: 'wsep', floor: 1, x1: 4000, y1: 0, x2: 4000, y2: 4000, thick: 120 }
  ];
  if (o.wallOnPlatform !== undefined) {
    // 段差の上だけを通る壁(両端とも「段差の上」の部屋の中)。
    walls.push({ id: 'wup', floor: 1, x1: 4500, y1: 500, x2: 6500, y2: 500,
                 thick: 120, wallHeight: o.wallOnPlatform });
  }
  if (o.wallHalfOn !== undefined) {
    // 低い側と段差の上にまたがる壁。
    walls.push({ id: 'whalf', floor: 1, x1: 1000, y1: 2000, x2: 6000, y2: 2000,
                 thick: 120, wallHeight: o.wallHalfOn });
  }
  return { floors: {}, rooms: rooms, walls: walls, items: (o.items || []) };
}

// ══ 1. 段差を持たないプランが1mmも動かない ══════════════════════════════
test('段差を持たない部屋では、床天端は従来の式(基礎+スラブ+床上げ)のまま', () => {
  const g = heights(PLAN);
  g.DATA.rooms.forEach((r) => {
    assert.equal(g.roomSkipLevelMm(r), 0, '保存済みプランに段差が現れている');
    const expected = g.floorBaseY(r.floor) + g.floorSlabHeightMForFloor(r.floor)
      + g.roomFloorOffsetMm(r) * g.U;
    assert.ok(Math.abs(g.roomFloorTopY(r) - expected) < 1e-9,
      r.id + ' の床天端が従来の式とずれている');
  });
});

test('段差を持たない家では、天井の上限は階高と完全に同値', () => {
  const g = heights(PLAN);
  g.DATA.rooms.forEach((r) => {
    assert.ok(Math.abs(g.roomCeilingCapM(r) - g.storyHeightM(r.floor)) < 1e-9,
      r.id + ' の天井の上限が階高からずれている');
  });
});

test('段差を持たない家では、壁の足元も持ち上がりも 0 のまま', () => {
  const g = heights(PLAN);
  g.DATA.walls.forEach((w) => {
    assert.ok(Math.abs(g.wallBaseSupportY(w) - g.floorBaseY(w.floor)) < 1e-9,
      w.id + ' の壁の足元が floorBaseY からずれている');
    assert.equal(g.wallLiftMm(w), 0, w.id + ' の壁が持ち上がっている');
  });
});

// ══ 2. 段差そのもの ═════════════════════════════════════════════════════
test('段差 1200mm の部屋の床は、その階の床から 1200mm 上がる', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  const low = g.DATA.rooms[0], up = g.DATA.rooms[1];
  assert.equal(Math.round((g.roomFloorTopY(up) - g.roomFloorTopY(low)) / g.U), 1200);
});

test('段差と床上げは足し算になる(構造の段差の上に仕上げの段差が乗る)', () => {
  const g = heights(skipHouse({ skip: 400, raise: 150 }));
  const up = g.DATA.rooms[1];
  assert.equal(Math.round((g.roomFloorTopY(up) - g.floorBaseY(1)) / g.U), 550);
  // 段差の下(構造床)は段差も床上げも含まない。
  assert.equal(Math.round((g.roomStoreyFloorTopY(up) - g.floorBaseY(1)) / g.U), 0);
});

test('上限 2400mm を超える段差は丸めて読む(それ以上は別の階)', () => {
  const g = heights(skipHouse({ skip: 9000 }));
  assert.equal(g.roomSkipLevelMm(g.DATA.rooms[1]), 2400);
});

// ══ 3-4. 天井 ═══════════════════════════════════════════════════════════
test('天井高を明示した段差部屋では、天井も段差ぶん一緒に上がる', () => {
  const g = heights(skipHouse({ skip: 1200, ceilingMm: 2200, wallOnPlatform: 2400 }));
  const up = g.DATA.rooms[1];
  // 天井面は floorBaseY 基準。1階はスラブ 0 なので 1200+2200。
  assert.equal(Math.round(g.roomCeilingHeightM(up) / g.U), 3400);
  // 室内で測れる高さ(その部屋の床から)は、指定した 2200 のまま。
  assert.equal(g.roomRenderedCeilingMm(up), 2200);
});

test('天井高を明示しない段差部屋では、天井は動かない(頭上がその分低くなる)', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  const up = g.DATA.rooms[1];
  assert.equal(Math.round(g.roomCeilingHeightM(up) / g.U), 2700, '天井が勝手に上がっている');
  assert.equal(g.roomRenderedCeilingMm(up), 1500, '頭上の実寸が 階高-段差 になっていない');
});

test('段差の上に高い壁が立つと、天井の上限もその壁の天端まで伸びる', () => {
  const g = heights(skipHouse({ skip: 1200, wallOnPlatform: 2400 }));
  const up = g.DATA.rooms[1];
  // 壁の天端 = 段差 1200 + 壁高 2400 = 3600。階高 2700 より高いので上限が伸びる。
  assert.equal(Math.round(g.roomCeilingCapM(up) / g.U), 3600);
  // 低い側の部屋の上には高い壁が無いので、上限は階高のまま。
  assert.equal(Math.round(g.roomCeilingCapM(g.DATA.rooms[0]) / g.U), 2700);
});

// ══ 5-6. 上に載るものだけが上がる ═══════════════════════════════════════
test('段差の上に立つ壁の天端は 段差+壁高 になり、その上に載る床だけが上がる', () => {
  const g = heights(skipHouse({ skip: 1200, wallOnPlatform: 2400, upperRoom: true }));
  const f2 = g.DATA.rooms[2];
  // 2階の床は、段差の上の壁の天端 3600 + 2階の床スラブ 180。
  assert.equal(Math.round(g.roomFloorTopY(f2) / g.U), 3600 + 180);
  // 段差の外(低い側の真上)は従来どおり階高のまま。
  assert.equal(Math.round(g.localSupportTopY(2, 0, 0, 3000, 3000) / g.U), 2700);
});

test('一部しか高い支持に載っていない壁は、足元が floorBaseY のまま', () => {
  const g = heights(skipHouse({ skip: 1200, wallOnPlatform: 2400, upperRoom: true }));
  // 低い側と段差の上にまたがる2階の壁。
  g.DATA.walls.push({ id: 'w2half', floor: 2, x1: 1000, y1: 1000, x2: 6000, y2: 1000, thick: 120 });
  const w = g.DATA.walls[g.DATA.walls.length - 1];
  assert.ok(Math.abs(g.wallBaseSupportY(w) - g.floorBaseY(2)) < 1e-9,
    'またがった壁を持ち上げると、載っていない側に穴が開く');
});

test('全体が高い支持に載っている壁だけが、持ち上がった床から立つ', () => {
  const g = heights(skipHouse({ skip: 1200, wallOnPlatform: 2400, upperRoom: true }));
  g.DATA.walls.push({ id: 'w2on', floor: 2, x1: 4500, y1: 1000, x2: 6500, y2: 1000, thick: 120 });
  const w = g.DATA.walls[g.DATA.walls.length - 1];
  assert.equal(Math.round(g.wallBaseSupportY(w) / g.U), 3600);
  assert.equal(g.wallLiftMm(w), 3600 - 2700);
});

// ══ 7. 段差の縁の腰壁 ═══════════════════════════════════════════════════
test('段差の縁の腰壁 1100mm は、持ち上がった床から 1100mm になる', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  // 段差の境界の壁に 1100 を入れる(手すり壁)。
  g.DATA.walls[0].wallHeight = 1100;
  const top = Math.round(g.wallDisplayHeightM(g.DATA.walls[0]) / g.U);
  assert.equal(top, 1200 + 1100, '低い側の床から測ると、持ち上がった床では手すりが埋まる');
});

test('段差の無い家では、壁ごとの高さ指定は従来どおり床から測る', () => {
  const g = heights(skipHouse({}));
  g.DATA.walls[0].wallHeight = 1100;
  assert.equal(Math.round(g.wallDisplayHeightM(g.DATA.walls[0]) / g.U), 1100);
});

// ══ 8-9. 同じ階の段差を上る階段 ═════════════════════════════════════════
function stairHouse(target) {
  const h = skipHouse({ skip: 1200 });
  h.items.push({
    id: 'st1', type: 'stair', floor: 1, x: 2400, y: 500, w: 910, d: 1600, rot: 0,
    stairTarget: target
  });
  return h;
}

test("行き先を宣言しない階段は、従来どおり上の階へ上がる", () => {
  const g = heights(stairHouse(undefined));
  const st = g.DATA.items[0];
  assert.equal(g.stairGroupIsLevel(st), false);
  // 上階が無いので従来どおり階高ぶん。
  assert.equal(Math.round(g.stairGroupRiseM(st) / g.U), 2700);
});

test("行き先を『同じ階の段差』にすると、上り高さが段差と一致する", () => {
  const g = heights(stairHouse('level'));
  const st = g.DATA.items[0];
  assert.equal(g.stairGroupIsLevel(st), true);
  assert.equal(Math.round(g.stairGroupRiseM(st) / g.U), 1200);
});

test('レベル階段の段数は、上り高さに追従する(階高からは出さない)', () => {
  const g = heights(stairHouse('level'));
  const st = g.DATA.items[0];
  // 1200mm を蹴上げ 200mm 目標で割ると 6段。踏面の制約(奥行1600/150=10)には収まる。
  assert.equal(g.getStairStepCount(st), 6);
  const g2 = heights(stairHouse(undefined));
  assert.equal(g2.getStairStepCount(g2.DATA.items[0]), g2.stairStepCount(2700, 1600));
});

test('レベル階段は低い側の床から立ち上がる(段差の上に浮かない)', () => {
  const g = heights(stairHouse('level'));
  const st = g.DATA.items[0];
  assert.equal(Math.round(g.item3DBaseY(st) / g.U), 0);
});

test('レベル階段は上階の床に穴を開けない', () => {
  const g = heights(stairHouse('level'));
  assert.deepEqual(g.stairwellQuadsForFloor(2), [], '同じ階の段差を上る階段が上階を抜いている');
  // 代わりに、同じ階の持ち上がった床に開ける穴として数えられる。
  assert.equal(g.levelStairQuadsForFloor(1).length, 1);
});

test('上の階へ上がる階段は、従来どおり上階の床に穴を開ける', () => {
  const g = heights(stairHouse(undefined));
  assert.equal(g.stairwellQuadsForFloor(2).length, 1);
  assert.deepEqual(g.levelStairQuadsForFloor(1), []);
});

// ══ 10. 段差の下に置く ══════════════════════════════════════════════════
test('段差の下に置くと宣言したアイテムは、その階の構造床に置かれる', () => {
  const h = skipHouse({ skip: 1200 });
  h.items.push({ id: 'sh1', type: 'shelf-built-in', floor: 1, x: 4200, y: 200,
                 w: 1800, d: 350, rot: 0, baseLevel: 'under' });
  h.items.push({ id: 'sh2', type: 'shelf-built-in', floor: 1, x: 4200, y: 2200,
                 w: 1800, d: 350, rot: 0 });
  const g = heights(h);
  assert.equal(Math.round(g.item3DBaseY(g.DATA.items[0]) / g.U), 0, '段差の下に入っていない');
  assert.equal(Math.round(g.item3DBaseY(g.DATA.items[1]) / g.U), 1200, '段差の上に乗っていない');
});

test('段差が 400mm 以上あるときだけ、床下が空間として扱われる', () => {
  assert.equal(heights(skipHouse({ skip: 1200 })).roomSkipCavityMm(
    heights(skipHouse({ skip: 1200 })).DATA.rooms[1]), 1200);
  const small = heights(skipHouse({ skip: 300 }));
  assert.equal(small.roomSkipCavityMm(small.DATA.rooms[1]), 0);
  const none = heights(skipHouse({}));
  assert.equal(none.roomSkipCavityMm(none.DATA.rooms[1]), 0);
});

test('床下が開くのは、低いレベルに面した辺だけ', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  const sides = g.roomSkipOpenSides(g.DATA.rooms[1]);
  assert.equal(sides.w, true, '低い側(西)に面した辺が開いていない');
  assert.equal(sides.e, false, '部屋の無い側(外)まで開いている');
  assert.equal(sides.n, false);
  assert.equal(sides.s, false);
});

// ══ 10-b. 段差の下は、アプリが塞がない ══════════════════════════════════
// 「奥に壁ができる」の再発防止。段差の立ち上がりを自動で作っていたため、
// 引いた覚えのない板が現れていた。床下を囲うのは設計そのものなので置くのは利用者。
test('アプリは段差の立ち上がり(蹴上げ面)を作らない', () => {
  assert.doesNotMatch(html, /function buildSkipPlatformSkirts\(/,
    '段差の下を自動で塞ぐと、引いた覚えのない壁が現れる');
  const body = sliceFunction('buildRooms3D');
  assert.doesNotMatch(body, /Skirt/, '床の生成から立ち上がりを作っている');
});

test('段差の辺の向こうに何があるかは、平面図の段差線のために残っている', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  const up = g.DATA.rooms[1];
  assert.equal(g.roomSkipEdgeNeighbors(up).w, 'lower');
  assert.equal(g.roomSkipEdgeNeighbors(up).e, 'none');
  assert.equal(g.roomSkipOpenSides(up).w, true);
  assert.equal(g.roomSkipOpenSides(up).e, false);
});

test('同じレベルの部屋に続く辺は lower ではない(段差線を引かない)', () => {
  const h = skipHouse({ skip: 1200 });
  h.rooms.push({ id: 'up2', n: '書斎2', floor: 1, x: 7000, y: 0, w: 2000, d: 4000, skipLevelMm: 1200 });
  const g = heights(h);
  assert.equal(g.roomSkipEdgeNeighbors(g.DATA.rooms[1]).e, 'same');
  assert.equal(g.roomSkipOpenSides(g.DATA.rooms[1]).e, false);
});

// ══ 8-c. 階段の下 ══════════════════════════════════════════════════════
test('階段の下は、省略すれば従来どおり素通し', () => {
  const g = heights(stairHouse(undefined));
  assert.equal(g.stairUnderFilled(g.DATA.items[0]), false);
  assert.equal(g.stairUnderFilled({ stairUnder: 'open' }), false);
  assert.equal(g.stairUnderFilled({ stairUnder: 'filled' }), true);
});

test('階段の下を埋めると、直階段も廻り階段も塞ぐ', () => {
  const straight = sliceFunction('build3DOpenStraightStair');
  assert.match(straight, /filled/, '直階段が階段下の指定を受け取っていない');
  assert.match(straight, /stairUnderFillMaterial\(/);
  const winder = sliceFunction('build3DWinderCorner');
  assert.match(winder, /filled/, '廻り階段が階段下の指定を受け取っていない');
  assert.match(winder, /stairUnderFillMaterial\(/);
  const caller = sliceFunction('buildItem3D');
  assert.match(caller, /stairUnderFilled\(it\)/, '階段下の指定を3Dの生成へ渡していない');
});

test('階段のプロパティ欄から階段の下を選べる', () => {
  assert.match(html, /stairUnder/);
  assert.match(html, /埋める（箱型）/);
});

// ══ 10-c. 柱 ═══════════════════════════════════════════════════════════
test('柱は角柱と円柱の2種類あり、高さは範囲に丸めて読む', () => {
  const g = heights(skipHouse({}));
  assert.equal(g.isColumnType('column'), true);
  assert.equal(g.isColumnType('column-round'), true);
  assert.equal(g.isColumnType('shelf-built-in'), false);
  assert.equal(g.columnHeightMm({}), 2400);
  assert.equal(g.columnHeightMm({ columnHeight: 99999 }), 6000);
  assert.equal(g.columnHeightMm({ columnHeight: 1170 }), 1170);
});

test('柱が部屋・壁メニューから置ける', () => {
  assert.match(html, /data-tool="column"/);
  assert.match(html, /data-tool="column-round"/);
  assert.match(html, /column:'角柱','column-round':'円柱'/);
});

test('段差の上に置いた柱は、足元が段差の下へ下り、高さが段差に合う', () => {
  const body = sliceFunction('placeItem');
  assert.match(body, /isColumnType\(it\.type\)/, '柱を置いたときの段差の扱いが無い');
  assert.match(body, /roomSkipCavityMm\(/);
  assert.match(body, /baseLevel='under'/);
});

test('柱は3Dで角柱と円柱に描き分ける', () => {
  const body = sliceFunction('buildItem3D');
  assert.match(body, /CylinderGeometry/, '円柱が箱で描かれている');
  assert.match(body, /isColumnType\(it\.type\)/);
});

// ══ 8-b. レベル階段の向き ═══════════════════════════════════════════════
// 「横板から始まる」の再発防止。階段自身がどちら向きに上るかを見ずに
// 両端の min/max だけを採っていたため、逆向きに置くと最上段から始まっていた。
test('レベル階段は、低い側から段差へ向かって上る(置き方によらず)', () => {
  // rot 0: ローカル下端は -y 側。低い側(西の部屋)は x<4000 なので、
  // この向きでは下端も上端も低い側に居る → bbox の走行軸で決まる。
  // 向きの判定そのものは、下端が高い側に来る置き方で測る。
  const h = skipHouse({ skip: 1200 });
  // rot 90 だと ローカル下端(0,-d/2) は +x 側 = 段差の上を向く。
  // 走行軸が段差の境(x=4000)をまたぐ位置に置く。
  h.items.push({ id: 'st_rev', type: 'stair', floor: 1,
                 x: 3545, y: 500, w: 910, d: 1400, rot: 90, stairTarget: 'level' });
  const g = heights(h);
  const span = g.stairLevelSpanM(g.DATA.items[0]);
  assert.equal(span.reversed, true, '下端が段差の上を向いていることを検出できていない');
  assert.equal(Math.round(span.baseY / g.U), 0, '足元は低い側のまま');
  assert.equal(Math.round(span.riseM / g.U), 1200);
});

test('正しい向きに置いたレベル階段は反転しない', () => {
  const h = skipHouse({ skip: 1200 });
  // rot -90(=270) なら ローカル下端は -x 側 = 低い側を向く。
  h.items.push({ id: 'st_fwd', type: 'stair', floor: 1,
                 x: 3545, y: 500, w: 910, d: 1400, rot: -90, stairTarget: 'level' });
  const g = heights(h);
  assert.equal(g.stairLevelSpanM(g.DATA.items[0]).reversed, false);
});

test('3Dの段は、反転した階段では逆向きに積む', () => {
  const body = sliceFunction('build3DOpenStraightStair');
  assert.match(body, /reverse/, '反転を受け取っていない');
  const caller = sliceFunction('buildItem3D');
  assert.match(caller, /stairLevelReversed\(/, '反転を3Dの生成へ渡していない');
});

test('歩行の坂面も、反転した階段では逆向きに上る', () => {
  const body = sliceFunction('walkLevelStairGroundAt');
  assert.match(body, /reversed/, '足元の坂面が反転を見ていない');
});

// ══ 11. 造作棚 ══════════════════════════════════════════════════════════
test('背面が壁に接した造作棚は、壁が支えるので縦板を持たない', () => {
  const h = skipHouse({});
  // 壁 wsep は x=4000 の垂直線。棚を左に寄せ、背面(ローカル -y 側)を壁へ向ける。
  // 中心 (3825,1175)、rot 90 なので背面は +x 側 = (4000,1175) で壁の芯に接する。
  h.items.push({ id: 'sh', type: 'shelf-built-in', floor: 1, rot: 90,
                 x: 2925, y: 1000, w: 1800, d: 350 });
  const g = heights(h);
  assert.equal(g.shelfIsWallSupported(g.DATA.items[0]), true);
});

test('壁から離れた造作棚は、両端に縦板を立てる', () => {
  const h = skipHouse({});
  h.items.push({ id: 'sh', type: 'shelf-built-in', floor: 1, rot: 0,
                 x: 1000, y: 1500, w: 1800, d: 350 });
  const g = heights(h);
  assert.equal(g.shelfIsWallSupported(g.DATA.items[0]), false);
});

test('造作棚の縦板は、明示があれば自動判定より優先する', () => {
  const h = skipHouse({});
  // 壁から離れた棚。自動なら縦板あり。
  h.items.push({ id: 'sh', type: 'shelf-built-in', floor: 1, rot: 0,
                 x: 1000, y: 1500, w: 1800, d: 350 });
  const g = heights(h);
  const sh = g.DATA.items[0];
  assert.equal(g.shelfSideBoards(sh), 'both', '自動の既定が変わっている');
  sh.shelfSides = 'none';
  assert.equal(g.shelfSideBoards(sh), 'none', '「縦板なし」を選んでも効いていない');
  sh.shelfSides = 'both';
  assert.equal(g.shelfSideBoards(sh), 'both');
  delete sh.shelfSides;
  assert.equal(g.shelfSideBoards(sh), 'both', '明示を外したら自動へ戻る');
});

test('3Dの造作棚は、縦板の有無をこの1か所から読む', () => {
  const body = sliceFunction('build3DShelfBuiltIn');
  assert.match(body, /shelfSideBoards\(it\)/, '自動判定を直接呼んでいる(明示が効かない)');
});

test('造作棚の棚板の枚数と高さは、範囲に丸めて読む', () => {
  const g = heights(skipHouse({}));
  assert.equal(g.shelfBoardCount({}), 3);
  assert.equal(g.shelfBoardCount({ shelfCount: 99 }), 8);
  assert.equal(g.shelfHeightMm({}), 900);
  assert.equal(g.shelfHeightMm({ shelfHeight: 99999 }), 2700);
});

// ══ 12. 平面図の表記・取り込みの検査 ════════════════════════════════════
test('段差のある部屋だけが FL+ の表記を持つ', () => {
  const g = heights(skipHouse({ skip: 1200 }));
  assert.equal(g.roomLevelLabel(g.DATA.rooms[1]), 'FL+1200');
  assert.equal(g.roomLevelLabel(g.DATA.rooms[0]), '');
});

test('取り込みの検査は、範囲外の段差と見慣れない行き先を警告に挙げる', () => {
  const res = PlanSchema.validatePlan({
    walls: [{ x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120 }],
    rooms: [{ x: 0, y: 0, w: 1000, d: 1000, skipLevelMm: 9000 }],
    items: [{ type: 'stair', x: 0, y: 0, stairTarget: 'sideways' },
            { type: 'shelf-built-in', x: 0, y: 0, baseLevel: 'ceiling' }]
  });
  assert.equal(res.ok, true, '読み込めなくしてはいけない(警告にとどめる)');
  assert.ok(res.warnings.some((w) => /段差 9000mm/.test(w)));
  assert.ok(res.warnings.some((w) => /行き先 "sideways"/.test(w)));
  assert.ok(res.warnings.some((w) => /基準 "ceiling"/.test(w)));
});

// ══ 配線の検査(値では測れないもの) ══════════════════════════════════════
test('段差が 400mm 以上ある部屋は、床下を空間として作る(塊のままにしない)', () => {
  const body = sliceFunction('buildRooms3D');
  assert.match(body, /roomSkipCavityMm\(r\)/, '床下を空けるかどうかを見ていない');
  assert.match(body, /roomStoreyFloorTopY\(r\)/, '床下の底(その階の構造床)を作っていない');
});

test('歩行では、階段を使わずに登れる段差に上限がある', () => {
  assert.match(html, /var WALK_MAX_STEP_UP_M\s*=/);
  const body = sliceFunction('walkUpdateGround');
  assert.match(body, /WALK_MAX_STEP_UP_M/, '段差を無条件に登れると壁を抜けたように上がる');
  assert.match(body, /walkLevelStairGroundAt\(/, 'レベル階段の坂面が歩行に効いていない');
});

test('部屋のプロパティ欄からスキップフロアを設定できる', () => {
  assert.match(html, /function selectedRoomSkipHtml\(/);
  assert.match(html, /function updateSelectedRoomSkipLevel\(/);
  assert.match(html, /selectedRoomSkipHtml\(it\)/);
});

test('階段のプロパティ欄から行き先を選べる', () => {
  assert.match(html, /stairTarget/);
  assert.match(html, /同じ階の段差/);
});

test('造作棚がツールとして置ける', () => {
  assert.match(html, /data-tool="shelf-built-in"/);
  assert.match(html, /'shelf-built-in':'造作棚'/);
});
