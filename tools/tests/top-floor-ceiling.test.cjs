// Task 14: 勾配天井が成立する条件。
//
// 事実は一つ。**勾配天井は屋根裏側へ抜ける形なので、上に部屋(=床)がある階では
// 成立しない。** 14-1 も 14-2 もこの一つの取りこぼしだった。
//
// この計画では grep のアサーションが未修正のコードに対して何度も通っている。
// なのでここでの検査は grep ではない。index.html から関数を波括弧の対応で切り出し、
// node:vm で**実際に走らせ**、天井面を座標で測る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));
const PLAN = JSON.parse(readFileSync(join(ROOT, 'assets', 'default_plan.json'), 'utf8'));

// ── index.html からの切り出し（roof-ceiling.test.cjs と同じやり方）───────────
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
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'setbackClipsCoverPlan', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomRenderedCeilingMm', 'roomRenderedCeilingShape', 'roomRenderedCeilingLabel'
];
const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM'];

function makeCtx(data) {
  const warns = [];
  const ctx = vm.createContext({
    console: { warn: function (m) { warns.push(String(m)); }, log: console.log,
               error: console.error },
    HeightModel: HeightModel, DATA: data,
    Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN,
    Array: Array, Object: Object, JSON: JSON,
    __warns: warns
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// 部屋の天井面をグリッドで実測し、床面からの最低/最高(mm)を返す。
// 「レンダの経路」= roomCeilingProfile → roomCeilingWorldYAtMm、3D が使う式そのもの。
function measureCeilingMm(ctx, room) {
  const p = ctx.roomCeilingProfile(room);
  const base = ctx.floorBaseY(room.floor) + ctx.floorSlabHeightMForFloor(room.floor);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const y = ctx.roomCeilingWorldYAtMm(room, p, room.x + room.w * i / 10,
      room.y + room.d * j / 10) - base;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return { lowMm: Math.round(lo / ctx.U), highMm: Math.round(hi / ctx.U),
           source: p && p.source };
}

// ── 14-1: 屋根が「上にある」判定が階を見ていなかった ──────────────────────

test('14-1: 既定プラン1階の部屋は、2階分上の屋根から天井をもらわない', () => {
  const data = clone(PLAN);
  const ctx = makeCtx(data);
  const room = data.rooms.filter((r) => r.floor === 1)[0];
  assert.equal(room.floor, 1);
  // 上に載っているのは屋根ではなく2階の部屋である。それを名指しできること。
  const above = ctx.roomAboveRoom(room);
  assert.notEqual(above, null, room.id + ' の上に部屋が見つからない(前提が崩れている)');
  assert.ok((above.floor || 1) > 1, '上の部屋の階が上でない');

  room.ceiling = { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 };
  assert.equal(ctx.roofItemOverRoom(room), null,
    '1階の部屋が屋根を「上にある」と判定している');
  assert.equal(ctx.roomRoofCeilingExtent(room), null,
    '1階の部屋が屋根由来の天井を持った');
  const m = measureCeilingMm(ctx, room);
  assert.equal(m.source, 'manual', '屋根の枝を通っている: ' + m.source);
  // 修正前はこの部屋の天井が 5204-5299mm（3階の屋根の下面）に置かれていた。
  assert.ok(m.highMm < 4000,
    '天井が屋根の高さ(3階相当)まで持ち上がっている: ' + m.highMm + 'mm');
});

test('14-1: 既定プラン最上階の部屋は、いまも屋根から天井をもらい、実際に傾く', () => {
  // 現行の既定プランはフラットルーフなので、勾配の検証は同じ屋根アイテムを
  // 切妻に差し替えたクローンで行う（「最上階の部屋が屋根を見つける」経路は実データのまま）。
  const data = clone(PLAN);
  const ctx = makeCtx(data);
  const topFloor = Math.max.apply(null, data.rooms.map((r) => r.floor || 1));
  const room = data.rooms.filter((r) => r.floor === topFloor)[0];
  assert.equal(ctx.roomAboveRoom(room), null, '最上階の部屋の上に部屋がある(前提が崩れている)');
  room.ceiling = { type: 'sloped', lowMm: 2200 };
  const roof = ctx.roofItemOverRoom(room);
  assert.notEqual(roof, null, '最上階の部屋が屋根を失った');

  const sloped = clone(PLAN);
  sloped.items.forEach((it) => {
    if (it.type === 'roof' && it.floor === topFloor + 1) {
      it.roofType = 'gable'; it.pitch = 30;
    }
  });
  const ctx2 = makeCtx(sloped);
  const room2 = sloped.rooms.filter((r) => r.floor === topFloor)[0];
  room2.ceiling = { type: 'sloped', lowMm: 2200 };
  const m = measureCeilingMm(ctx2, room2);
  assert.equal(m.source, 'roof');
  assert.ok(m.highMm - m.lowMm > 300,
    '屋根から導いた天井が傾いていない（高低差 ' + (m.highMm - m.lowMm) + 'mm）');
});

test('14-1: 平屋の下屋(上に部屋が無い1階)では、階番号が最大でなくても勾配が成立する', () => {
  // 2階建て + 東に張り出した1階だけの下屋。「最上階=階番号の最大」で判定すると
  // この下屋が落ちる。判定は「その部屋の真上に部屋があるか」でなければならない。
  const data = {
    floors: {}, walls: [],
    rooms: [
      { id: 'main1', type: 'room', floor: 1, x: 0, y: 0, w: 4000, d: 4000 },
      { id: 'main2', type: 'room', floor: 2, x: 0, y: 0, w: 4000, d: 4000 },
      { id: 'wing', type: 'room', floor: 1, x: 4200, y: 0, w: 3000, d: 4000,
        ceiling: { type: 'sloped', lowMm: 2200 } }
    ],
    items: [{ id: 9, type: 'roof', floor: 2, x: 4000, y: -500, w: 3400, d: 5000,
              rot: 0, elev: 0, roofType: 'gable', pitch: 30 }]
  };
  const ctx = makeCtx(data);
  const wing = data.rooms[2];
  assert.equal(ctx.roomAboveRoom(wing), null, '下屋の上に部屋があると誤判定した');
  assert.notEqual(ctx.roofItemOverRoom(wing), null, '下屋が屋根を失った');
  const m = measureCeilingMm(ctx, wing);
  assert.equal(m.source, 'roof');
  assert.ok(m.highMm - m.lowMm > 300, '下屋の天井が傾いていない');
  // 同じ家の1階の主室は、上に2階があるので勾配にならない
  assert.notEqual(ctx.roomAboveRoom(data.rooms[0]), null);
});

test('14-1: 一部でも覆われていれば「上に部屋がある」。辺が接するだけなら覆われていない', () => {
  function houseWith(above) {
    return { floors: {}, walls: [], items: [],
      rooms: [{ id: 'r', type: 'room', floor: 1, x: 0, y: 0, w: 4000, d: 4000 }, above] };
  }
  // 4分の1だけ重なる上階の部屋 → 覆われている（覆われた側で床を突き抜けるため）
  let ctx = makeCtx(houseWith({ id: 'up', floor: 2, x: 2000, y: 2000, w: 4000, d: 4000 }));
  assert.equal(ctx.roomHasRoomAbove(ctx.DATA.rooms[0]), true, '部分的な重なりを見逃した');
  // 辺で接するだけ（面積ゼロ） → 覆われていない
  ctx = makeCtx(houseWith({ id: 'up', floor: 2, x: 4000, y: 0, w: 4000, d: 4000 }));
  assert.equal(ctx.roomHasRoomAbove(ctx.DATA.rooms[0]), false, '辺が接しただけで覆われた扱いになった');
  // 同じ階の部屋は上ではない
  ctx = makeCtx(houseWith({ id: 'same', floor: 1, x: 0, y: 0, w: 4000, d: 4000 }));
  assert.equal(ctx.roomHasRoomAbove(ctx.DATA.rooms[0]), false, '同じ階の部屋を上と数えた');
  // 3D非表示の部屋は建っていないので上ではない
  ctx = makeCtx(houseWith({ id: 'up', floor: 2, x: 0, y: 0, w: 4000, d: 4000, hidden3D: true }));
  assert.equal(ctx.roomHasRoomAbove(ctx.DATA.rooms[0]), false, '非表示の部屋を上と数えた');
});

// ── 14-2: 手動の勾配が階高で丸められて必ず平らになっていた ────────────────

function manualHouse(floor, withRoomAbove) {
  const rooms = [{ id: 'm', type: 'room', floor: floor, x: 0, y: 0, w: 4000, d: 4000,
                   ceiling: { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 } }];
  if (withRoomAbove) rooms.push({ id: 'up', type: 'room', floor: floor + 1,
                                  x: 0, y: 0, w: 4000, d: 4000 });
  return { floors: {}, walls: [], items: [], rooms: rooms };
}

test('14-2: 最上階では既定の 2200/3600 がそのまま出る（丸められて平らにならない）', () => {
  const data = manualHouse(1, false);
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  assert.equal(ctx.storyHeightMmForFloor(1), 2700, '前提: 階高は 2700');
  const m = measureCeilingMm(ctx, room);
  assert.equal(m.source, 'manual');
  assert.equal(m.lowMm, 2200);
  assert.equal(m.highMm, 3600, '高い側が階高で丸められた: ' + m.highMm);
  assert.equal(m.highMm - m.lowMm, 1400, '傾きが 1400mm でない = 平らになっている');
  assert.equal(ctx.roomRenderedCeilingMm(room), 3600);
  assert.equal(ctx.roomRenderedCeilingLabel(room), 'CH 2200-3600 ↑');
  assert.deepEqual(ctx.__warns, [], '丸めていないのに警告を出している');
});

test('14-2: 上に部屋がある階では従来どおり階高で丸め、丸めたことを警告に残す', () => {
  const data = manualHouse(1, true);
  const ctx = makeCtx(data);
  const room = data.rooms[0];
  const m = measureCeilingMm(ctx, room);
  assert.equal(m.highMm, 2700, '階高 2700 を超えて描かれた: ' + m.highMm);
  assert.equal(ctx.roomRenderedCeilingMm(room), 2700);
  assert.equal(ctx.__warns.length, 1, '黙って丸めた: ' + JSON.stringify(ctx.__warns));
  assert.match(ctx.__warns[0], /clamped to the storey height/);
});

test('14-2: 緩めたのは勾配だけ。最上階でも平天井は従来どおり階高で丸める', () => {
  // 平天井を階高より上へ置くと、壁は階高までしか建たないので天井が宙に浮く。
  const data = { floors: {}, walls: [], items: [],
    rooms: [{ id: 'f', type: 'room', floor: 1, x: 0, y: 0, w: 4000, d: 4000,
              ceiling: { type: 'flat', heightMm: 3600 } }] };
  const ctx = makeCtx(data);
  assert.equal(ctx.roomHasRoomAbove(data.rooms[0]), false, '前提: 最上階');
  assert.equal(ctx.roomRenderedCeilingMm(data.rooms[0]), 2700,
    '平天井が階高を超えて置かれた');
  assert.equal(ctx.__warns.length, 1, '平天井の丸めを黙るようになった');
});

test('14-2: 屋根から導いた天井は、いままでどおり階高を超えてよい', () => {
  const data = {
    floors: {}, walls: [],
    rooms: [{ id: 'a', type: 'room', floor: 1, x: 0, y: 0, w: 4000, d: 4000,
              ceiling: { type: 'sloped', lowMm: 2200 } }],
    items: [{ id: 9, type: 'roof', floor: 2, x: -500, y: -500, w: 5000, d: 5000,
              rot: 0, elev: 0, roofType: 'gable', pitch: 35 }]
  };
  const ctx = makeCtx(data);
  const m = measureCeilingMm(ctx, data.rooms[0]);
  assert.equal(m.source, 'roof');
  assert.ok(m.highMm > 2700, '屋根の棟が階高で切られた: ' + m.highMm);
});

// ── 既存プランは1mmも動かない ─────────────────────────────────────────────

test('14(最重要): 既定プランの全部屋は、天井の高さも出どころも変わらない', () => {
  const data = clone(PLAN);
  const ctx = makeCtx(data);
  const byFloor = {};
  // 既定プランは吹き抜けを1室持つ。そこだけ天井高を明示しているので外す。
  const declares = (r) => !!((r.ceiling && r.ceiling.heightMm) || r.ceilingHeight);
  const voids = data.rooms.filter(declares);
  assert.ok(voids.length > 0, '既定プランに吹き抜けが無い(前提が崩れている)');
  voids.forEach((r) => assert.ok(ctx.roomCeilingHeightM(r) > ctx.storyHeightM(r.floor),
    r.id + ' の吹き抜けが階高で丸められた'));
  data.rooms.filter((r) => !declares(r)).forEach((r) => {
    assert.equal(ctx.roomCeilingProfile(r), null, r.id + ' が勾配の枝に入った');
    assert.equal(ctx.roomRoofCeilingExtent(r), null, r.id + ' が屋根由来の天井を持った');
    assert.equal(ctx.roomCeilingHeightM(r), ctx.storyHeightM(r.floor), r.id + ' の天井高が動いた');
    (byFloor[r.floor] = byFloor[r.floor] || new Set()).add(ctx.roomRenderedCeilingMm(r));
  });
  // Task 2 以来の既知の実測値。ここが動けば保存済みの家が動いている。
  // (1階は階高そのまま 2700、2階以上は床スラブ 180 を引いた 2520)
  assert.deepEqual(byFloor[1], new Set([2700]));
  Object.keys(byFloor).map(Number).filter((f) => f > 1).forEach((f) => {
    assert.deepEqual(byFloor[f], new Set([2520]), f + '階の実寸が 2520 でない');
  });
  assert.ok(Object.keys(byFloor).length >= 2, '既定プランに2階以上の部屋が無い(前提が崩れている)');
  assert.deepEqual(ctx.__warns, [], '既定プランで丸めの警告が出た');
});
