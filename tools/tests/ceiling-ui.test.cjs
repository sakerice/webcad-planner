// Task 13: 天井の設定UI。
//
// この計画では grep のアサーションが未修正のコードに対して何度も通っている。
// なのでここでの検査は grep ではない。index.html から UI の関数と高さの関数を
// 波括弧の対応で切り出し、node:vm で**実際に走らせ**、
//
//   - 欄を描いただけでプランに何も書かないこと（保存済みの家が動かない）
//   - 屋根が載っている部屋と載っていない部屋で、出る入力欄が本当に変わること
//   - UIから勾配を選ぶと、レンダの経路(roomCeilingSlopeM)が本当に傾き、
//     平面図のラベルが変わること
//   - 平天井の高さを入れると、レンダが置く面が本当に動くこと
//   - 階高を超える値を入れたとき、丸めたことを画面が言うこと
//   - 「平ら」へ戻すと受け口ごと消え、既存プランと同じ形へ戻ること
//
// を測る。DOM は要らない（UIはHTML文字列を組み立てるだけ）ので、
// updateSelectedProp の周辺だけを最小のスタブで支える。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

// ── index.html からの切り出し（roof-ceiling.test.cjs と同じやり方）────────
function scanBalanced(from) {
  let i = from, depth = 0, mode = null, started = false;
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
    if (c === '{' || c === '[' || c === '(') { depth++; started = true; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (started && depth === 0) return i;
      continue;
    }
    if (c === ';' && depth === 0 && started) return i;
  }
  throw new Error('閉じていない');
}
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  const brace = html.indexOf('{', html.indexOf(')', start));
  return html.slice(start, scanBalanced(brace) + 1);
}
// 単行の var も複数行の配列リテラルも同じ道で取る。
function topLevelVar(name) {
  const at = html.indexOf('\nvar ' + name + '=');
  const at2 = at === -1 ? html.indexOf('\nvar ' + name + ' =') : at;
  assert.notEqual(at2, -1, 'var ' + name + ' が index.html に無い');
  const eq = html.indexOf('=', at2);
  let i = eq + 1;
  // 値がリテラル1個で終わるなら直後の ; まで、括弧で始まるなら対応まで。
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] === '{' || html[i] === '[' || html[i] === '(') {
    return html.slice(at2 + 1, scanBalanced(i) + 1) + ';';
  }
  const end = html.indexOf(';', i);
  return html.slice(at2 + 1, end + 1);
}

const FNS = [
  'foundationHeightMm', 'foundationHeightM',
  'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'isPositiveNumber',
  'roomsOverlapInPlan', 'roomAboveRoom', 'roomHasRoomAbove',
  'roomDeclaresSlopedCeiling', 'roofCoversPlanPoint', 'setbackOutlineCoversLocal', 'roofItemOverRoom',
  'roofUndersideWorldYAt', 'roofCeilingWorldYAt', 'roofLocalPoint', 'roofSurfaceHeightAt',
  'setbackRoofsForRoom', 'roofTopLimitAtPlanPoint', 'roomSetbackCeilingNoteHtml',
  'roomCeilingProfile', 'roomCeilingWorldYAtMm', 'roomRoofCeilingExtent',
  'ceilingSlopeUnit', 'ceilingSlopeSpan',
  'roomVoidTargetFloor', 'roomIsVoidCeiling', 'roomVoidCeilingMm', 'roomVoidFloorsAreOpen',
  'roomVoidBlockReason', 'roomExplicitCeilingMm', 'roomCeilingHeightM', 'roomCeilingSlopeM',
  'roomRenderedCeilingMm', 'roomRenderedCeilingShape', 'roomRenderedCeilingLabel',
  'roofTypeOptions', 'objectIdLabel',
  // Task 13 で足したもの
  'roomCeilingTypeValue', 'roomFlatCeilingInputMm', 'roofTypeLabel',
  // Task 14 で足したもの
  'roomDisplayLabel', 'roomSlopedCeilingBlockReason',
  'selectedRoomCeilingHtml',
  'updateSelectedCeilingType', 'updateSelectedFlatCeilingMm', 'updateSelectedSlopedCeiling',
  'updateSelectedProp'
];
const VARS = ['U', 'WALL_H', 'FLOOR_H', 'FLOOR_SLAB_H', '_ceilingClampWarned',
  'CEILING_UNDER_ROOF_OFFSET_MM', '_roofCeilingExtentCache', 'ROOM_OVERLAP_EPS_MM',
  'CEILING_HEIGHT_PRESETS_MM'];

// ── 家 ────────────────────────────────────────────────────────────────────
// 2階の部屋2つ。切妻屋根は A の上だけに載り、B の上には無い。
const ROOF = { id: 9, type: 'roof', floor: 3, x: -500, y: 1000, w: 5500, d: 7000,
  rot: 0, elev: 0, roofType: 'gable', pitch: 30 };
function house() {
  return {
    floors: {},
    rooms: [
      { id: 'rmA', type: 'room', n: '屋根のある部屋', floor: 2, x: 0, y: 0, w: 4000, d: 6000 },
      { id: 'rmB', type: 'room', n: '屋根のない部屋', floor: 2, x: 6000, y: 0, w: 3000, d: 6000 },
      { id: 'rmG', type: 'room', n: '1階の部屋', floor: 1, x: 0, y: 0, w: 4000, d: 4000 }
    ],
    walls: [],
    items: [Object.assign({}, ROOF)]
  };
}

function makeCtx(data) {
  const log = { save: 0, draw: 0, rebuild: 0, props: 0 };
  const ctx = vm.createContext({
    console: console, HeightModel: HeightModel, DATA: data,
    Math: Math, Number: Number, isFinite: isFinite, isNaN: isNaN,
    Array: Array, Object: Object, JSON: JSON, String: String, RegExp: RegExp,
    ST: { selected: null },
    ren: true,
    __log: log,
    saveState: function () { log.save++; },
    draw2d: function () { log.draw++; },
    rebuild3D: function () { log.rebuild++; },
    updateProps: function () { log.props++; },
    isObjectLocked: function (o) { return !!(o && o.locked); },
    setObjectLocked: function (o, v) { if (v) o.locked = true; else delete o.locked; },
    syncLockBatchUi: function () {},
    isAppearanceColorInputActive: function () { return false; },
    markAppearanceColorDirty: function () {},
    scheduleAppearancePreviewUpdate: function () {},
    isLightItemType: function () { return false; },
    isWindowLikeType: function () { return false; },
    normalizeWindowVerticalProps: function () {},
    getExteriorWallSetting: function () { return {}; }
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}
function select(ctx, room) { ctx.ST.selected = room; return room; }
const clone = (o) => JSON.parse(JSON.stringify(o));
// 「入力欄が出ているか」は onchange の有無で見る（readonly の表示欄と区別する）。
const editable = (h, fn) => h.indexOf('onchange="' + fn) !== -1;

// ── 1. 描いただけでは何も書かない ────────────────────────────────────────
test('欄を描いただけでは、部屋にフィールドが1つも増えない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const before = JSON.stringify(data);
  data.rooms.forEach(function (r) {
    select(ctx, r);
    const h = ctx.selectedRoomCeilingHtml(r);
    assert.ok(h.indexOf('天井') !== -1, '天井の欄が出ていない');
  });
  assert.equal(JSON.stringify(data), before, '欄を描いただけでプランが変わった');
  data.rooms.forEach(function (r) {
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'ceiling'), false, r.id);
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'ceilingHeight'), false, r.id);
  });
  assert.equal(ctx.__log.save, 0, '描画だけで undo が積まれた');
});

test('既定は「平ら」かつ天井高は空欄（既存プランは ceiling を持たない）', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  assert.equal(ctx.roomCeilingTypeValue(room), 'flat');
  assert.equal(ctx.roomFlatCeilingInputMm(room), '');
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('<option value="flat" selected>') !== -1, '平ら が選ばれていない');
  assert.ok(h.indexOf('placeholder="空欄=指定なし" value=""') !== -1, '天井高の欄が空欄で出ていない');
  assert.ok(h.indexOf('指定なしです。') !== -1, '「指定なし」の説明が出ていない');
  // 空欄のとき、今どこに天井が置かれているかを数字で言う（2階=階高2700-スラブ180）
  assert.equal(ctx.roomRenderedCeilingMm(room), 2520);
  assert.ok(h.indexOf('現在 2520mm') !== -1, '現在の天井高を言っていない');
});

// ── 2. 屋根のある部屋・ない部屋で欄が変わる ──────────────────────────────
test('屋根が載っている部屋とそうでない部屋を、UIは取り違えない', () => {
  const data = house();
  const ctx = makeCtx(data);
  assert.notEqual(ctx.roofItemOverRoom(data.rooms[0]), null, 'A の上に屋根が無い');
  assert.equal(ctx.roofItemOverRoom(data.rooms[1]), null, 'B の上に屋根がある');
});

test('屋根のある部屋で勾配を選ぶと、数値入力は出ず、屋根が決めた値が読み取り専用で出る', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[0]);
  ctx.updateSelectedCeilingType('sloped');
  const h = ctx.selectedRoomCeilingHtml(room);

  assert.equal(editable(h, 'updateSelectedSlopedCeiling'), false,
    '屋根が決めるのに、手で書ける欄を出している');
  assert.ok(h.indexOf('屋根から自動') !== -1, '「屋根から自動」と言っていない');
  assert.ok(h.indexOf('切妻屋根') !== -1, '屋根の種類を出していない');
  assert.ok(h.indexOf('>屋根の勾配 (°)</div><input class="pi" type="text" value="30" readonly>') !== -1,
    '屋根の勾配を読み取り専用で出していない');

  // 低い側・高い側は「レンダが実際に置いた面」の値であること
  const shape = ctx.roomRenderedCeilingShape(room);
  assert.equal(shape.type, 'sloped');
  assert.equal(shape.source, 'roof');
  assert.ok(shape.highMm > shape.lowMm, '屋根から導いた天井が傾いていない');
  assert.ok(h.indexOf('value="' + shape.lowMm + '" readonly') !== -1, '低い側 ' + shape.lowMm);
  assert.ok(h.indexOf('value="' + shape.highMm + '" readonly') !== -1, '高い側 ' + shape.highMm);
});

test('屋根のない部屋で勾配を選ぶと、低い側・高い側・向きが手で書ける', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  ctx.updateSelectedCeilingType('sloped');
  const h = ctx.selectedRoomCeilingHtml(room);

  assert.ok(editable(h, 'updateSelectedSlopedCeiling'), '手で書ける欄が出ていない');
  assert.equal(h.indexOf('屋根から自動'), -1, '屋根が無いのに「屋根から自動」と言っている');
  // 既定は 2200 / 3600 / 0
  assert.deepEqual(clone(room.ceiling), { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 });
  assert.ok(h.indexOf('value="2200" onchange="updateSelectedSlopedCeiling(\'lowMm\'') !== -1);
  assert.ok(h.indexOf('value="3600" onchange="updateSelectedSlopedCeiling(\'highMm\'') !== -1);
  assert.ok(h.indexOf('value="0" onchange="updateSelectedSlopedCeiling(\'direction\'') !== -1);
});

test('屋根の下では、屋根が上書きする値（高い側・向き）をそもそも書き込まない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const withRoof = select(ctx, data.rooms[0]);
  ctx.updateSelectedCeilingType('sloped');
  assert.deepEqual(clone(withRoof.ceiling), { type: 'sloped', lowMm: 2200 },
    '屋根が決める値まで書き込んでいる（屋根を消した日に身に覚えのない数字が効く）');

  const noRoof = select(ctx, data.rooms[1]);
  ctx.updateSelectedCeilingType('sloped');
  assert.equal(noRoof.ceiling.highMm, 3600);
  assert.equal(noRoof.ceiling.direction, 0);
});

// ── 3. UIから勾配を設定すると、レンダとラベルが本当に動く ────────────────
test('UIから勾配を選ぶと、レンダの経路が傾き、平面図のラベルが変わる（屋根あり）', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[0]);

  const labelBefore = ctx.roomRenderedCeilingLabel(room);
  assert.equal(ctx.roomCeilingSlopeM(room), null, '触る前から傾いている');
  assert.equal(labelBefore, 'CH 2520');

  ctx.updateSelectedCeilingType('sloped');

  const slope = ctx.roomCeilingSlopeM(room);
  assert.notEqual(slope, null, 'UIから勾配にしたのにレンダが傾いていない');
  assert.equal(slope.source, 'roof');
  assert.ok(slope.highY - slope.lowY > 0.3, '傾きが 300mm 未満（実質平ら）');
  const labelAfter = ctx.roomRenderedCeilingLabel(room);
  assert.notEqual(labelAfter, labelBefore, 'ラベルが変わっていない');
  assert.match(labelAfter, /^CH \d+-\d+ [↑↗→↘↓↙←↖]$/, 'ラベル=' + labelAfter);
  // 画面が新しい配線を通ったこと（2D と 3D の両方を描き直す）
  assert.equal(ctx.__log.draw, 1);
  assert.equal(ctx.__log.rebuild, 1);
  assert.equal(ctx.__log.save, 1);
});

test('UIから低い側・高い側・向きを変えると、レンダの傾きがその通りになる（屋根なし）', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  ctx.updateSelectedCeilingType('sloped');
  ctx.updateSelectedSlopedCeiling('lowMm', '2000');
  ctx.updateSelectedSlopedCeiling('direction', '90');
  assert.deepEqual(clone(room.ceiling), { type: 'sloped', lowMm: 2000, highMm: 3600, direction: 90 });

  const slope = ctx.roomCeilingSlopeM(room);
  assert.equal(slope.source, 'manual');
  assert.equal(slope.direction, 90);
  // 低い側は入力どおり(2000mm + スラブ180mm)。高い側は 3600 のまま
  // ── rmB の上には部屋が無いので階高で丸めない (Task 14-2)。
  assert.ok(Math.abs(slope.lowY - (2000 * ctx.U + ctx.floorSlabHeightMForFloor(2))) < 1e-9);
  assert.ok(Math.abs(slope.highY - (3600 * ctx.U + ctx.floorSlabHeightMForFloor(2))) < 1e-9);
  assert.equal(ctx.roomRenderedCeilingLabel(room), 'CH 2000-3600 →');
});

test('向きに 0（北）を入れても既定へ落ちない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  ctx.updateSelectedCeilingType('sloped');
  ctx.updateSelectedSlopedCeiling('direction', '270');
  assert.equal(room.ceiling.direction, 270);
  ctx.updateSelectedSlopedCeiling('direction', '0');
  assert.equal(room.ceiling.direction, 0, '0 が捨てられた');
  assert.equal(ctx.roomCeilingSlopeM(room).direction, 0);
});

test('勾配を選んだら、外観3Dでしか見えないことと壁の上辺は内観でも従うことを言う', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  ctx.updateSelectedCeilingType('sloped');
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('外観3D') !== -1, '外観3Dでしか見えないことを言っていない');
  assert.ok(h.indexOf('内観3Dは天井を作りません') !== -1);
  assert.ok(h.indexOf('壁の上辺は内観3Dでも勾配に沿って切れます') !== -1);
  // 平らのときは出さない（無関係な注意書きで埋めない）
  ctx.updateSelectedCeilingType('flat');
  assert.equal(ctx.selectedRoomCeilingHtml(room).indexOf('外観3D'), -1);
});

// ── 4. 平らの天井高 ──────────────────────────────────────────────────────
test('UIから平らな天井高を入れると、レンダが置く面とラベルが本当に動く', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  assert.equal(ctx.roomRenderedCeilingMm(room), 2520);

  ctx.updateSelectedFlatCeilingMm('2400');
  assert.deepEqual(clone(room.ceiling), { type: 'flat', heightMm: 2400 });
  assert.equal(ctx.roomRenderedCeilingMm(room), 2400);
  assert.equal(ctx.roomRenderedCeilingLabel(room), 'CH 2400');

  ctx.updateSelectedFlatCeilingMm('2100');
  assert.equal(ctx.roomRenderedCeilingMm(room), 2100);
  assert.equal(ctx.roomRenderedCeilingLabel(room), 'CH 2100');
});

test('実務値のプリセットが選べ、選んだ値が欄に出る', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  assert.deepEqual(clone(ctx.CEILING_HEIGHT_PRESETS_MM).map(function (p) { return p[0]; }),
    [2400, 2500, 2200, 2100]);
  ctx.updateSelectedFlatCeilingMm('2200');
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('<option value="2200" selected>') !== -1, 'プリセットが選択状態にならない');
  assert.ok(h.indexOf('value="2200" onchange="updateSelectedFlatCeilingMm') !== -1,
    '自由入力欄に値が入っていない');
});

test('階高を超える値は入力できるが、丸めたことをその場で言う', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);   // 2階: 階高2700 / スラブ180
  ctx.updateSelectedFlatCeilingMm('3000');
  assert.equal(room.ceiling.heightMm, 3000, '入力値まで書き換えている');
  assert.equal(ctx.roomRenderedCeilingMm(room), 2520, '既存のクランプが効いていない');

  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('3000mm は階高 2700mm を超えるため、2520mm に丸めて描いています') !== -1,
    '丸めたことを黙っている: ' + h);

  // 丸めが起きない値では言わない（毎回出る注意書きは読まれなくなる）
  ctx.updateSelectedFlatCeilingMm('2400');
  assert.equal(ctx.selectedRoomCeilingHtml(room).indexOf('丸めて描いています'), -1);
});

test('1階（スラブなし）でも丸めの境目を正しく言う', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[2]); // 1階
  ctx.updateSelectedFlatCeilingMm('2700');
  assert.equal(ctx.roomRenderedCeilingMm(room), 2700);
  assert.equal(ctx.selectedRoomCeilingHtml(room).indexOf('丸めて描いています'), -1);
  ctx.updateSelectedFlatCeilingMm('2900');
  assert.equal(ctx.roomRenderedCeilingMm(room), 2700);
  assert.ok(ctx.selectedRoomCeilingHtml(room)
    .indexOf('2900mm は階高 2700mm を超えるため、2700mm に丸めて描いています') !== -1);
});

// Task 14-2: 丸めが起きるのは「上に部屋がある階」だけになった。
// rmG(1階) の上には rmA(2階) が載っているので、そこでは従来どおり丸め、
// 丸めたことを画面で言う。宣言そのものはUIからは作れない(=14-3で止まる)ので、
// 昔コンソールから書かれたプランを開いた状況として直接置く。
test('上に部屋がある階では、手書きの勾配は従来どおり丸められ、丸めたことを言う', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[2]);   // 1階。上に rmA が載っている
  room.ceiling = { type: 'sloped', lowMm: 2200, highMm: 3600, direction: 0 };
  assert.equal(ctx.roomRenderedCeilingMm(room), 2700, '1階の階高で丸められていない');
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('高い側 3600mm は階高 2700mm を超えるため、2700mm に丸めて描いています') !== -1,
    '黙って丸めている: ' + h);
  assert.ok(h.indexOf('上に部屋がある階なので、階高より上へは伸ばせません') !== -1,
    'なぜ丸まったのか(上に部屋がある)を言っていない: ' + h);
  assert.ok(h.indexOf('この部屋の上には2階の「屋根のある部屋」が載っています') !== -1,
    '上に何が載っているかを言っていない: ' + h);
});

test('最上階では、手書きの高い側 3600 は丸められず、丸めたとも言わない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);   // 2階・屋根なし・上に部屋なし
  ctx.updateSelectedCeilingType('sloped');   // 既定 2200/3600
  assert.equal(ctx.roomRenderedCeilingMm(room), 3600,
    '既定値のままで平天井になっている(=手動経路が使えない): ' + ctx.roomRenderedCeilingMm(room));
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.equal(h.indexOf('丸めて描いています'), -1, '丸めていないのに丸めたと言っている');
  assert.ok(h.indexOf('丸めずにそのまま描いています') !== -1,
    '階高を超えていることを伝えていない: ' + h);
});

// ── 5. 空欄へ戻すと、既存プランと同じ形に戻る ────────────────────────────
test('天井高を空欄にすると受け口ごと消え、プランが元と1バイトも変わらない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const before = JSON.stringify(data);
  const room = select(ctx, data.rooms[1]);

  ctx.updateSelectedFlatCeilingMm('2400');
  assert.notEqual(JSON.stringify(data), before);

  ctx.updateSelectedFlatCeilingMm('');
  assert.equal(Object.prototype.hasOwnProperty.call(room, 'ceiling'), false,
    '空欄に戻したのに ceiling キーが残っている');
  assert.equal(JSON.stringify(data), before, 'プランが元に戻っていない');
  assert.equal(ctx.roomRenderedCeilingMm(room), 2520, '天井が階高に戻っていない');
});

test('「平ら」を選び直すと勾配の指定が消え、既存プランと同じ形に戻る', () => {
  const data = house();
  const ctx = makeCtx(data);
  const before = JSON.stringify(data);
  const room = select(ctx, data.rooms[0]);

  ctx.updateSelectedCeilingType('sloped');
  assert.notEqual(ctx.roomCeilingSlopeM(room), null);

  ctx.updateSelectedCeilingType('flat');
  assert.equal(Object.prototype.hasOwnProperty.call(room, 'ceiling'), false);
  assert.equal(ctx.roomCeilingSlopeM(room), null, '勾配が残っている');
  assert.equal(JSON.stringify(data), before, 'プランが元に戻っていない');
});

test('0 や負数や文字は「指定なし」として扱い、0mm の天井を作らない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  ['0', '-100', 'あ', ''].forEach(function (v) {
    ctx.updateSelectedFlatCeilingMm('2400');
    ctx.updateSelectedFlatCeilingMm(v);
    assert.equal(Object.prototype.hasOwnProperty.call(room, 'ceiling'), false, 'v=' + v);
    assert.equal(ctx.roomRenderedCeilingMm(room), 2520, 'v=' + v);
  });
});

// ── 6. 旧フィールドと、ロック中の扱い ────────────────────────────────────
test('旧フィールド ceilingHeight を持つ部屋でも、欄はその値を出す', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  room.ceilingHeight = 2200;
  assert.equal(ctx.roomFlatCeilingInputMm(room), 2200);
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('value="2200" onchange="updateSelectedFlatCeilingMm') !== -1);
  assert.ok(h.indexOf('<option value="2200" selected>') !== -1);
  // 書き換えると旧フィールドは残さない（効かない古い値が居座らない）
  ctx.updateSelectedFlatCeilingMm('2500');
  assert.equal(Object.prototype.hasOwnProperty.call(room, 'ceilingHeight'), false);
  assert.equal(ctx.roomRenderedCeilingMm(room), 2500);
});

test('ロック中の部屋では天井を変えられない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[1]);
  room.locked = true;
  const before = JSON.stringify(room);
  ctx.updateSelectedCeilingType('sloped');
  ctx.updateSelectedFlatCeilingMm('2400');
  assert.equal(JSON.stringify(room), before, 'ロック中に天井が書き換わった');
});

test('部屋以外を選んでいるときは、天井の欄を出さない', () => {
  const data = house();
  const ctx = makeCtx(data);
  const wall = { id: 1, x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120, floor: 1 };
  assert.equal(ctx.selectedRoomCeilingHtml(wall), '');
  select(ctx, wall);
  ctx.updateSelectedCeilingType('sloped');
  assert.equal(Object.prototype.hasOwnProperty.call(wall, 'ceiling'), false);
});

// ── 6.5 Task 14-3: 作れない部屋には、理由を添えて作らせない ───────────────
// 黙って平天井になるのが最悪。rmG(1階) の上には rmA(2階) が載っている。
test('14-3: 上に部屋がある階では、勾配の選択肢が無効になり、理由が出る', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[2]);        // 1階。上に rmA
  assert.equal(ctx.roomHasRoomAbove(room), true, '前提が崩れている');
  const h = ctx.selectedRoomCeilingHtml(room);
  assert.ok(h.indexOf('<option value="sloped" disabled>') !== -1,
    '勾配が選べてしまう: ' + h);
  assert.ok(h.indexOf('この部屋の上には2階の「屋根のある部屋」が載っています') !== -1,
    '上に何が載っているかを言っていない: ' + h);
  assert.ok(h.indexOf('勾配天井は天井を張らずに屋根裏側へ抜ける形なので') !== -1,
    'なぜ作れないのかを言っていない: ' + h);
});

test('14-3: 最上階の部屋では、勾配の選択肢は無効にならないし理由も出ない', () => {
  const data = house();
  const ctx = makeCtx(data);
  [data.rooms[0], data.rooms[1]].forEach(function (room) {
    select(ctx, room);
    const h = ctx.selectedRoomCeilingHtml(room);
    assert.equal(h.indexOf('disabled'), -1, room.id + ' で勾配が塞がれた: ' + h);
    assert.equal(h.indexOf('作れません'), -1, room.id + ' で作れないと言っている');
  });
});

test('14-3: 上に部屋がある階では、勾配を選んでも書き込まれない（黙って平らにしない）', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[2]);
  const before = JSON.stringify(data);
  ctx.updateSelectedCeilingType('sloped');
  assert.equal(Object.prototype.hasOwnProperty.call(room, 'ceiling'), false,
    '作れない部屋に勾配が書き込まれた');
  assert.equal(JSON.stringify(data), before, 'プランが変わった');
  assert.equal(ctx.__log.save, 0, 'undo が積まれた');
  assert.equal(ctx.roomCeilingSlopeM(room), null);
});

test('14-3: 上階の部屋が消えれば、その日から勾配が選べるようになる', () => {
  const data = house();
  const ctx = makeCtx(data);
  const room = select(ctx, data.rooms[2]);
  assert.ok(ctx.selectedRoomCeilingHtml(room).indexOf('disabled') !== -1);
  data.rooms.splice(0, 1);                       // rmA を消す = 1階の上が空く
  assert.equal(ctx.roomHasRoomAbove(room), false);
  assert.equal(ctx.selectedRoomCeilingHtml(room).indexOf('disabled'), -1);
  ctx.updateSelectedCeilingType('sloped');
  assert.notEqual(ctx.roomCeilingSlopeM(room), null, '勾配が効いていない');
});

// ── 7. 配線（欄が updateProps の部屋の枝から呼ばれていること）────────────
test('部屋のプロパティ欄から天井の欄が呼ばれている', () => {
  assert.ok(html.indexOf('html += selectedRoomCeilingHtml(it);') !== -1,
    'updateProps の部屋の枝に繋がっていない');
});
