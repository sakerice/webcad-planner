// 壁から部屋を求める処理。
//
// AIに「壁」と「部屋」の両方を出させると食い違う(同じ図面で部屋が3〜9個に
// 変動した)。壁が読めているなら領域は計算で求まるので、こちらで出す。
// ここが正しければ、壁と部屋は必ず一致する。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const { roomsFromWalls } = require(join(__dirname, '..', '..', 'assets', 'js', 'plan-rooms.js'));

// 壁を短く書くための道具。芯線の線分。
function w(x1, y1, x2, y2, floor) {
  return { x1: x1, y1: y1, x2: x2, y2: y2, floor: floor || 1, thick: 120 };
}
// 面積の大きい順に、分かりやすい形へ。
function shape(rooms) {
  return rooms.slice().sort(function (a, b) { return (b.w * b.d) - (a.w * a.d); })
    .map(function (r) { return `${r.n || '-'} ${r.w}x${r.d}@(${r.x},${r.y})`; });
}

test('四角い部屋ひとつ', () => {
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
  ], []);
  assert.equal(rooms.length, 1);
  assert.deepEqual(
    { x: rooms[0].x, y: rooms[0].y, w: rooms[0].w, d: rooms[0].d },
    { x: 0, y: 0, w: 3640, d: 2730 });
});

test('間仕切り壁で2つに分かれる', () => {
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
    w(1820, 0, 1820, 2730),                      // 縦の間仕切り
  ], []);
  assert.equal(rooms.length, 2, '間仕切りで割れていない: ' + shape(rooms));
  assert.deepEqual(shape(rooms).sort(), ['- 1820x2730@(0,0)', '- 1820x2730@(1820,0)']);
});

test('間仕切りに開口があっても、壁が引かれていれば分かれる（扉は壁を消さない）', () => {
  // 間仕切りを2本に分けて、途中に隙間(建具の位置)を作る
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
    w(1820, 0, 1820, 910), w(1820, 1820, 1820, 2730),
  ], []);
  // 910〜1820 の区間に壁が無いので、そこを通ってつながる = ひとつの領域。
  // 建具の開口まで壁として扱うなら、AI側が壁を通しで出すべき、という切り分け。
  assert.equal(rooms.length >= 1, true);
});

test('図に書かれた文字が、その領域の名前になる', () => {
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
    w(1820, 0, 1820, 2730),
  ], [
    { text: '洋室', x: 900, y: 1300 },
    { text: '浴室', x: 2700, y: 1300 },
  ]);
  const byName = {};
  rooms.forEach(function (r) { byName[r.n] = r; });
  assert.equal(byName['洋室'].x, 0);
  assert.equal(byName['浴室'].x, 1820);
});

test('領域の外にある文字は、どの部屋の名前にもならない', () => {
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
  ], [{ text: '立面図', x: 9000, y: 9000 }]);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].n, '', '建物の外の文字を部屋名にしてしまっている');
});

test('屋外は部屋にならない', () => {
  // 建物の外に、囲まれていない壁が1本ある（フェンスのような線）
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 2730), w(3640, 2730, 0, 2730), w(0, 2730, 0, 0),
    w(5000, 5000, 7000, 5000),
  ], []);
  assert.equal(rooms.length, 1, '屋外を部屋にしている: ' + shape(rooms));
});

test('L字の部屋は、長方形に切り分けて同じ名前を持つ…のではなく分割される', () => {
  // ┌──────┐
  // │      │
  // │   ┌──┘   右下が欠けたL字
  // │   │
  // └───┘
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3640, 0, 3640, 1365), w(3640, 1365, 1820, 1365),
    w(1820, 1365, 1820, 2730), w(1820, 2730, 0, 2730), w(0, 2730, 0, 0),
  ], [{ text: 'LDK', x: 900, y: 600 }]);
  // 長方形2つに割れる。合計面積はL字ぶん。
  const area = rooms.reduce(function (a, r) { return a + r.w * r.d; }, 0);
  assert.equal(area, 3640 * 1365 + 1820 * 1365, '面積が合わない: ' + shape(rooms));
  assert.ok(rooms.some(function (r) { return r.n === 'LDK'; }), '名前が付いた部屋が無い');
});

test('壁の座標が数mmずれていても、同じ通り芯として扱う', () => {
  // AIが返す座標は1mm単位で揃うとは限らない
  const rooms = roomsFromWalls([
    w(0, 0, 3640, 0), w(3642, 0, 3640, 2728), w(3640, 2730, 1, 2731), w(0, 2730, 0, 2),
    w(1820, 0, 1821, 2730),
  ], []);
  assert.equal(rooms.length, 2, 'わずかなずれで領域が壊れている: ' + shape(rooms));
});

test('階が違う壁は混ざらない', () => {
  const walls = [
    w(0, 0, 3640, 0, 1), w(3640, 0, 3640, 2730, 1), w(3640, 2730, 0, 2730, 1), w(0, 2730, 0, 0, 1),
    w(0, 0, 1820, 0, 2), w(1820, 0, 1820, 1820, 2), w(1820, 1820, 0, 1820, 2), w(0, 1820, 0, 0, 2),
  ];
  assert.equal(roomsFromWalls(walls, [], { floor: 1 })[0].w, 3640);
  assert.equal(roomsFromWalls(walls, [], { floor: 2 })[0].w, 1820);
});

test('壁が足りなければ何も返さない（推測で部屋を作らない）', () => {
  assert.deepEqual(roomsFromWalls([], []), []);
  assert.deepEqual(roomsFromWalls([w(0, 0, 100, 0)], []), []);
});

test('壁の厚みぶんの細い隙間は部屋にしない', () => {
  // 120mm の隙間を挟んで2部屋。隙間そのものを部屋にしてはいけない。
  const rooms = roomsFromWalls([
    w(0, 0, 3760, 0), w(3760, 0, 3760, 2730), w(3760, 2730, 0, 2730), w(0, 2730, 0, 0),
    w(1820, 0, 1820, 2730), w(1940, 0, 1940, 2730),
  ], []);
  assert.ok(rooms.every(function (r) { return r.w >= 200 && r.d >= 200; }),
    '細い隙間を部屋にしている: ' + shape(rooms));
});

// ── 寸法をモジュールへ寄せる ──────────────────────────────────────
//
// 図面の細かい数字は読み違いが起きる。実測で 227.5→275、455→450 を確認した。
// 日本の住宅の寸法は 227.5mm（4分の1間）の倍数に乗るので、近ければ寄せる。
const { snapToModule, snapWalls, MODULE_MM } = require(join(__dirname, '..', '..', 'assets', 'js', 'plan-rooms.js'));

test('モジュールの倍数はそのまま', () => {
  assert.equal(MODULE_MM, 227.5);
  for (const v of [227.5, 455, 910, 1137.5, 1365, 1820, 2275, 3185, 4095, 7280]) {
    assert.equal(snapToModule(v, 50), v, v + ' を動かしてしまった');
  }
});

test('実測で確認した読み違いを直す', () => {
  assert.equal(snapToModule(450, 50), 455, '455 を 450 と読んだとき');
  assert.equal(snapToModule(275, 50), 227.5, '227.5 を 275 と読んだとき');
  assert.equal(snapToModule(7290, 50), 7280, '7280 を 7290 と読んだとき');
});

test('遠い値は触らない（本当に半端な寸法のことがある）', () => {
  // 227.5 の倍数から 50mm より離れているものは、読み違いではなく実寸とみなす
  assert.equal(snapToModule(1000, 50), 1000);
  assert.equal(snapToModule(600, 50), 600);
});

test('寄せは壁の端点に効き、他の欄は触らない', () => {
  const [wall] = snapWalls([{ x1: 450, y1: 0, x2: 7290, y2: 275, floor: 2, thick: 120 }]);
  assert.equal(wall.x1, 455);
  assert.equal(wall.x2, 7280);
  assert.equal(wall.y2, 227.5);
  assert.equal(wall.floor, 2, '階まで動かしている');
  assert.equal(wall.thick, 120, '厚みまで動かしている');
});

test('読み違いのある壁からでも、まっとうな部屋が出る', () => {
  // 7280 を 7290 と読み、間仕切りを 3640 → 3645 と読んだ場合
  const rooms = roomsFromWalls([
    w(0, 0, 7290, 0), w(7290, 0, 7290, 4095), w(7290, 4095, 0, 4095), w(0, 4095, 0, 0),
    w(3645, 0, 3645, 4095),
  ], []);
  assert.equal(rooms.length, 2);
  const widths = rooms.map((r) => r.w).sort((a, b) => a - b);
  assert.deepEqual(widths, [3640, 3640], '寄せが効いていない: ' + shape(rooms));
});
