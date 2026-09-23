// 読み取った階だけを差し替える。図面に写っていない階には触らない。
//
// 2階の平面図を1枚だけ読み取ると、1階の間取りが丸ごと消えていた。
// 取り込みが DATA をまるごと差し替えていたためで、図面に写っていない階
// (1階)も、図面とは関係のない設定(階ごとの階高・方位・外壁の仕様)も、
// まとめて失われていた。
//
// 取り込みが置き換えてよいのは、**その図面に写っている階だけ**である。
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

// いま開いている間取り: 1階と2階、基礎と屋根つき。階ごとの設定も持っている。
function currentPlan() {
  return {
    walls: [].concat(
      wallsOf(1, 0, 0, 7280, 4095).map(function (w, i) { return Object.assign({ id: 'a' + i }, w); }),
      wallsOf(2, 0, 0, 7280, 4095).map(function (w, i) { return Object.assign({ id: 'b' + i }, w); })
    ),
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
      { id: 'i6', type: 'road', floor: 1, x: -2000, y: 8000, w: 12000, d: 4000 },
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

// ── 2階を読み取っても、1階はそのまま ──────────────────────────────
global.DATA = currentPlan();
global.PlanImport.state.result = { plan: readSecondFloor() };
global.applyPlanImport();

const f1walls = DATA.walls.filter(function (w) { return w.floor === 1; });
assert.equal(f1walls.length, 4, '2階を取り込んだのに、1階の壁が消えた');
assert.deepEqual(DATA.rooms.filter(function (r) { return r.floor === 1; }).map(function (r) { return r.n; }),
  ['LDK'], '2階を取り込んだのに、1階の部屋が消えた');
assert.ok(DATA.items.some(function (i) { return i.id === 'i1'; }), '2階を取り込んだのに、1階の建具が消えた');

// 2階のほうは、読み取った下書きに入れ替わっている
const f2rooms = DATA.rooms.filter(function (r) { return r.floor === 2; });
assert.deepEqual(f2rooms.map(function (r) { return r.n; }), ['子供室'], '2階が読み取った下書きに入れ替わっていない');
assert.equal(DATA.walls.filter(function (w) { return w.floor === 2; }).length, 4, '2階の壁が入れ替わっていない');
assert.ok(!DATA.items.some(function (i) { return i.id === 'i2'; }), '2階の古い建具が残っている');

// ── 図面と関係のない設定は残る ────────────────────────────────────
assert.deepEqual(DATA.floors, { 1: { wallHeight: 2600 }, 2: { wallHeight: 2400 } }, '階ごとの高さ設定が消えた');
assert.deepEqual(DATA.floorMetadata, { 1: { use: 'residential' } }, '階の用途が消えた');
assert.deepEqual(DATA.heightDefaults, { modelVersion: 2, floorThickness: 180 }, '高さの既定値が消えた');
assert.deepEqual(DATA.exteriorWallSettings, { texture: 'siding' }, '外壁の設定が消えた');
assert.equal(DATA.northDeg, 30, '方位が消えた');

// ── 基礎は1階のもの。2階を読み取ったときに作り直さない ────────────
const foundations = DATA.items.filter(function (i) { return i.type === 'foundation'; });
assert.equal(foundations.length, 1, '基礎が増えた・消えた: ' + foundations.length);
assert.equal(foundations[0].id, 'i3', '1階を読み取っていないのに、基礎を置き直した');

// ── 屋根は最上階から決まるので、その階を読んだら作り直す ──────────
const roofs = DATA.items.filter(function (i) { return i.type === 'roof'; });
assert.equal(roofs.length, 1, '屋根が増えた・消えた: ' + roofs.length);
assert.equal(roofs[0].w, 5460 + 900, '屋根が読み取った2階の外形に合っていない');
assert.ok(roofs[0].id !== 'i4', '最上階を読み取ったのに、古い屋根が残っている');

// ── 何も無いところへの取り込みは、これまでどおり基礎も屋根も付く ──
global.DATA = { walls: [], rooms: [], items: [] };
global.PlanImport.state.result = { plan: { walls: wallsOf(1, 0, 0, 7280, 4095), rooms: [], items: [] } };
global.applyPlanImport();
assert.equal(DATA.items.filter(function (i) { return i.type === 'foundation'; }).length, 1,
  '空の間取りへの取り込みで、基礎が付かなくなった');
assert.equal(DATA.items.filter(function (i) { return i.type === 'roof'; }).length, 1,
  '空の間取りへの取り込みで、屋根が付かなくなった');

// ── 1階だけを読み直したときは、基礎が作り直され、屋根は触らない ──
global.DATA = currentPlan();
global.PlanImport.state.result = { plan: { walls: wallsOf(1, 0, 0, 5460, 3640), rooms: [], items: [] } };
global.applyPlanImport();
const again = DATA.items.filter(function (i) { return i.type === 'foundation'; });
assert.equal(again.length, 1, '1階を読み直したら基礎が増えた・消えた');
assert.equal(again[0].w, 5460, '1階を読み直したのに、基礎が古い外形のまま');
const keptRoof = DATA.items.filter(function (i) { return i.type === 'roof'; });
assert.equal(keptRoof.length, 1, '1階を読み直したら屋根が増えた・消えた');
assert.equal(keptRoof[0].id, 'i4', '最上階(2階)を読んでいないのに、屋根を置き直した');

// ── 敷地と周辺は、平面図に描かれていないので消さない ──────────────
//
// 読み取りは敷地も道路も作らない（図面に無いものを推測で置かないため）。
// 作らないものを消すと、二度と戻せない。1階は読み直した直後である。
assert.ok(DATA.items.some(function (i) { return i.id === 'i5'; }), '1階を読み直したら敷地が消えた');
assert.ok(DATA.items.some(function (i) { return i.id === 'i6'; }), '1階を読み直したら道路が消えた');

// ── 起動直後の既定プランは、下敷きにしない ────────────────────────
//
// 起動ダイアログの「間取り図の画像から下書きを作る」で入っても、裏では
// 既定プランが読み込まれている。図面から作りはじめるつもりの人に、
// 既定プランの別の階が残ってはいけない。
global.DATA = currentPlan();
global.HISTORY = [];                 // まだ一度も触っていない
global._defaultPlanPending = true;   // 既定プランのまま
global.PlanImport.state.result = { plan: readSecondFloor() };
global.applyPlanImport();
assert.equal(DATA.walls.filter(function (w) { return w.floor === 1; }).length, 0,
  '図面から作りはじめたのに、既定プランの1階が残っている');
assert.deepEqual(DATA.rooms.map(function (r) { return r.n; }), ['子供室'],
  '図面から作りはじめたのに、既定プランの部屋が残っている');

// 既定プランを手で直してきた人にとっては、それは自分の間取りである
global.DATA = currentPlan();
global.HISTORY = ['{}'];             // 触った跡がある
global._defaultPlanPending = true;
global.PlanImport.state.result = { plan: readSecondFloor() };
global.applyPlanImport();
assert.equal(DATA.walls.filter(function (w) { return w.floor === 1; }).length, 4,
  '手で直してきた1階が、既定プラン扱いで消された');

console.log('plan-import-floors: ok');
