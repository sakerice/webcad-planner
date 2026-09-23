// 取り込みは、利用者が作ったものを消さない。
//
// 2階の平面図を1枚読み取ると、1階の間取りが丸ごと消えていた。取り込みが
// 間取りをまるごと差し替えていたためで、図面に写っていない階も、図面とは
// 関係のない設定(方位・外壁の仕様・階ごとの階高)も、敷地も失われていた。
//
// 読み取りが言えるのは「この図面にはこう描いてある」ことだけである。
// 空いている階にはそのまま入れ、**既に間取りがある階なら、消さずに隣へ
// 建てる**。どちらを残すかは利用者が決める。
const assert = require('assert');
const path = require('path');

global.self = global;
// 読み込む時点では document を持たせない（画面への配線を走らせないため）。
global.document = undefined;
global.PlanStructure = require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-structure.js'));
require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-import.js'));
global.document = {
  getElementById: () => ({
    textContent: '', style: {}, disabled: false,
    classList: { add() {}, remove() {} },
  }),
};
global.confirm = () => true;

// アプリ側の生成関数の、検査に要る最小限。色やテクスチャの既定値は
// ここでの関心事ではないので、目印を1つ入れるだけにする。
global.nextId = 1000;
global.mkWall = function (x1, y1, x2, y2, floor, thick) {
  return { id: global.nextId++, x1: x1, y1: y1, x2: x2, y2: y2, floor: floor || 1, thick: thick || 120, color: '#888' };
};
global.mkItem = function (type, x, y, rot, floor, w, d) {
  return { id: global.nextId++, type: type, x: x, y: y, rot: rot || 0, floor: floor || 1, w: w || 0, d: d || 0 };
};
global.getItemDefaultSize = function () { return { w: 800, d: 120 }; };
global.newRoomFloorRaiseMm = function () { return 0; };
global.isContextExteriorItemType = function (t) {
  return t === 'road' || t === 'neighbor-house' || t === 'neighbor-building' || t === 'utility-pole';
};

function wallsOf(floor, x0, y0, x1, y1) {
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0, floor: floor, thick: 120 },
    { x1: x1, y1: y0, x2: x1, y2: y1, floor: floor, thick: 120 },
    { x1: x1, y1: y1, x2: x0, y2: y1, floor: floor, thick: 120 },
    { x1: x0, y1: y1, x2: x0, y2: y0, floor: floor, thick: 120 },
  ];
}
function tagged(floor, tag, x0, y0, x1, y1) {
  return wallsOf(floor, x0, y0, x1, y1).map(function (w, i) { return Object.assign({ id: tag + i }, w); });
}
function has(list, id) { return list.some(function (o) { return o.id === id; }); }
function byType(items, type) { return items.filter(function (i) { return i.type === type; }); }

// いま開いている間取り: 1階と2階、基礎と屋根つき。敷地と階ごとの設定も持つ。
function currentPlan() {
  return {
    walls: [].concat(tagged(1, 'a', 0, 0, 7280, 4095), tagged(2, 'b', 0, 0, 7280, 4095)),
    rooms: [
      { id: 'r1', floor: 1, x: 0, y: 0, w: 7280, d: 4095, n: 'LDK' },
      { id: 'r2', floor: 2, x: 0, y: 0, w: 7280, d: 4095, n: '寝室' },
    ],
    items: [
      { id: 'i1', type: 'door', floor: 1, x: 100, y: 0, w: 800, d: 120 },
      { id: 'i2', type: 'window', floor: 2, x: 100, y: 0, w: 1690, d: 120 },
      { id: 'i3', type: 'foundation', floor: 1, x: 0, y: 0, w: 7280, d: 4095, foundationHeight: 450 },
      { id: 'i4', type: 'roof', floor: 3, x: -450, y: -450, w: 8180, d: 4995, roofType: 'gable', pitch: 45 },
      { id: 'i5', type: 'site-rect', floor: 1, x: -2000, y: -2000, w: 12000, d: 9000 },
      { id: 'i6', type: 'tree', floor: 1, x: 9000, y: 2000, w: 900, d: 900 },
    ],
    floors: { 1: { wallHeight: 2600 }, 2: { wallHeight: 2400 } },
    floorMetadata: { 1: { use: 'residential' } },
    heightDefaults: { modelVersion: 2, floorThickness: 180 },
    exteriorWallSettings: { texture: 'siding' },
    northDeg: 30,
  };
}

// 読み取り結果: 2階の平面図1枚。1階のことは何も言っていない。
function readSecondFloor() {
  return {
    walls: wallsOf(2, 0, 0, 5460, 3640),
    rooms: [{ floor: 2, x: 0, y: 0, w: 5460, d: 3640, n: '子供室' }],
    items: [{ type: 'window', floor: 2, x: 2730, y: 0, w: 1690, d: 120 }],
  };
}

function importInto(plan, read) {
  global.DATA = plan;
  global.PlanImport.state.result = { plan: read };
  global.applyPlanImport();
  return global.DATA;
}

// ── 既に間取りがある階を読んだら、消さずに隣へ建てる ──────────────
global.HISTORY = ['{}'];              // 既定プランのままではない
global._defaultPlanPending = false;
importInto(currentPlan(), readSecondFloor());

// 元の間取りは、1つも欠けていない
['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2', 'b3'].forEach(function (id) {
  assert.ok(has(DATA.walls, id), '元の壁 ' + id + ' が消えた');
});
assert.deepEqual(DATA.rooms.filter(function (r) { return r.id === 'r1' || r.id === 'r2'; })
  .map(function (r) { return r.n; }), ['LDK', '寝室'], '元の部屋が消えた');
['i1', 'i2', 'i3', 'i4', 'i5', 'i6'].forEach(function (id) {
  assert.ok(has(DATA.items, id), '元の ' + id + ' が消えた');
});

// 読み取った下書きは、元の間取りの右隣に建っている。
// いまの間取りが載っている右端は 10000（敷地の右辺）。そこから 3000mm 空ける。
// 敷地まで数えるのは、庭木や塀の上に下書きが重ならないようにするため。
const DRAFT_X = 10000 + 3000;
const drafted = DATA.rooms.filter(function (r) { return r.n === '子供室'; });
assert.equal(drafted.length, 1, '読み取った部屋が入っていない');
assert.equal(drafted[0].x, DRAFT_X, '下書きが隣に建っていない: x=' + drafted[0].x);
assert.equal(drafted[0].floor, 2, '下書きの階が変わっている');
// 元の壁は 'a0'…'b3'、下書きの壁は mkWall が振る番号で見分ける
const draftWalls = DATA.walls.filter(function (w) { return typeof w.id === 'number'; });
assert.equal(draftWalls.length, 4, '下書きの壁が4本入っていない');
assert.ok(draftWalls.every(function (w) { return w.x1 >= DRAFT_X && w.x2 >= DRAFT_X; }),
  '下書きの壁が隣へずれていない');
const draftWindow = DATA.items.filter(function (i) { return i.type === 'window' && i.id !== 'i2'; });
assert.equal(draftWindow.length, 1, '下書きの窓が入っていない');
assert.ok(draftWindow[0].x >= DRAFT_X, '下書きの窓だけ元の位置に残っている');

// 下書きの基礎と屋根は、**下書きの壁だけ**から作る。元の間取りの壁とまとめて
// 外形を取ると、2棟をまたぐ1枚の基礎と1枚の屋根になる。
const foundations = byType(DATA.items, 'foundation');
assert.equal(foundations.length, 2, '基礎の数が合わない: ' + foundations.length);
const newFoundation = foundations.filter(function (i) { return i.id !== 'i3'; })[0];
assert.equal(newFoundation.w, 5460, '下書きの基礎が2棟をまたいでいる: w=' + newFoundation.w);
assert.equal(newFoundation.x, DRAFT_X, '下書きの基礎が下書きの位置にない');
const roofs = byType(DATA.items, 'roof');
assert.equal(roofs.length, 2, '屋根の数が合わない: ' + roofs.length);
const newRoof = roofs.filter(function (i) { return i.id !== 'i4'; })[0];
assert.equal(newRoof.w, 5460 + 900, '下書きの屋根が2棟をまたいでいる: w=' + newRoof.w);

// ── 図面と関係のない設定は残る ────────────────────────────────────
assert.deepEqual(DATA.floors, { 1: { wallHeight: 2600 }, 2: { wallHeight: 2400 } }, '階ごとの高さ設定が消えた');
assert.deepEqual(DATA.floorMetadata, { 1: { use: 'residential' } }, '階の用途が消えた');
assert.deepEqual(DATA.heightDefaults, { modelVersion: 2, floorThickness: 180 }, '高さの既定値が消えた');
assert.deepEqual(DATA.exteriorWallSettings, { texture: 'siding' }, '外壁の設定が消えた');
assert.equal(DATA.northDeg, 30, '方位が消えた');

// ── 空いている階は、隣ではなく上に載せる ──────────────────────────
//
// 1階を読んだあとに2階を読む、という一番ふつうの流れ。ここで隣に建てて
// しまっては使えない。屋根は最上階から決まるので、2階が載ったら作り直す。
const oneFloor = {
  walls: tagged(1, 'a', 0, 0, 7280, 4095),
  rooms: [{ id: 'r1', floor: 1, x: 0, y: 0, w: 7280, d: 4095, n: 'LDK' }],
  items: [
    { id: 'i1', type: 'door', floor: 1, x: 100, y: 0, w: 800, d: 120 },
    { id: 'i3', type: 'foundation', floor: 1, x: 0, y: 0, w: 7280, d: 4095 },
    { id: 'i4', type: 'roof', floor: 2, x: -450, y: -450, w: 8180, d: 4995 },
  ],
};
importInto(oneFloor, readSecondFloor());
const stacked = DATA.rooms.filter(function (r) { return r.n === '子供室'; })[0];
assert.equal(stacked.x, 0, '空いている2階なのに、隣へずらした');
assert.equal(DATA.walls.filter(function (w) { return w.floor === 1; }).length, 4, '1階の壁が変わった');
assert.ok(has(DATA.items, 'i1'), '1階の建具が消えた');
// 基礎は最下階(1階)から決まる。2階を読んだだけでは作り直さない。
const keptFoundation = byType(DATA.items, 'foundation');
assert.equal(keptFoundation.length, 1, '基礎の数が合わない');
assert.equal(keptFoundation[0].id, 'i3', '1階を読んでいないのに、基礎を置き直した');
// 屋根は最上階から決まる。1階建てのときの屋根は、2階が載ったら要らない。
const stackedRoofs = byType(DATA.items, 'roof');
assert.equal(stackedRoofs.length, 1, '屋根が2枚になった（1階建てのときの屋根が残っている）');
assert.equal(stackedRoofs[0].floor, 3, '屋根が2階の上に載っていない');
assert.equal(stackedRoofs[0].w, 5460 + 900, '屋根が読み取った2階の外形に合っていない');

// ── 何も無いところへの取り込みは、基礎も屋根も付く ────────────────
importInto({ walls: [], rooms: [], items: [] },
  { walls: wallsOf(1, 0, 0, 7280, 4095), rooms: [], items: [] });
assert.equal(byType(DATA.items, 'foundation').length, 1, '空の間取りへの取り込みで、基礎が付かなくなった');
assert.equal(byType(DATA.items, 'roof').length, 1, '空の間取りへの取り込みで、屋根が付かなくなった');
assert.equal(DATA.walls[0].x1, 0, '空の間取りなのに、隣へずらした');

// ── 起動直後の既定プランは、下敷きにしない ────────────────────────
//
// 起動ダイアログの「間取り図の画像から下書きを作る」で入っても、裏では
// 既定プランが読み込まれている。図面から作りはじめるつもりの人の隣に、
// 見たこともない既定プランが建っていてはいけない。既定プランは利用者が
// 作ったものではないので、これだけは外す。
global.HISTORY = [];                 // まだ一度も触っていない
global._defaultPlanPending = true;
importInto(currentPlan(), readSecondFloor());
assert.equal(DATA.walls.filter(function (w) { return w.floor === 1; }).length, 0,
  '図面から作りはじめたのに、既定プランの1階が残っている');
assert.deepEqual(DATA.rooms.map(function (r) { return r.n; }), ['子供室'],
  '図面から作りはじめたのに、既定プランの部屋が残っている');
assert.equal(DATA.rooms[0].x, 0, '下敷きが無いのに、隣へずらした');

// 既定プランを手で直してきた人にとっては、それはもう自分の間取りである
global.HISTORY = ['{}'];             // 触った跡がある
global._defaultPlanPending = true;
importInto(currentPlan(), readSecondFloor());
assert.equal(DATA.walls.filter(function (w) { return w.floor === 1; }).length, 4,
  '手で直してきた1階が、既定プラン扱いで消された');

console.log('plan-import-floors: ok');
