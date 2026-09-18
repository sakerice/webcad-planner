// 見直しで何が変わったかを、利用者の言葉にできるか。
//
// 黙って直すと、直ったことも直し損ねたことも分からない。2回ぶんの費用を
// 払っている以上、何が変わったかは見えているべきである。
const assert = require('assert');
const path = require('path');

// plan-import.js は画面用だが、この関数は DOM を触らない。
global.self = global;
global.document = undefined;
require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-import.js'));
const changes = global.PlanImport.reviewChanges;

const page = (floor, width, depth, rooms) => ({ floors: [{ floor, width, depth, rooms }] });
const room = (name, parts) => ({ name, parts: parts || [{ x0: 0, y0: 0, x1: 910, y1: 910 }] });

// 奥行きの読み違いは、いちばん効く直し方（実測で2階だけ 4170 と読んでいた）。
let out = changes([page(2, 7280, 4170, [room('LDK')])], [page(2, 7280, 4095, [room('LDK')])]);
assert.deepStrictEqual(out, ['2階の奥行きを 4170 → 4095mm に直しました。']);

// 名前の付いていなかった部屋に名前が付いた
out = changes([page(1, 7280, 4095, [room('')])], [page(1, 7280, 4095, [room('玄関')])]);
assert.ok(out.some((l) => l.indexOf('玄関') >= 0), '足した部屋が出ていない');
assert.ok(out.some((l) => l.indexOf('(名前なし)') >= 0), '外した部屋が出ていない');

// L字にし直した（長方形1つ → 2つ）
out = changes(
  [page(1, 7280, 4095, [room('洋室')])],
  [page(1, 7280, 4095, [room('洋室', [{ x0: 0, y0: 0, x1: 910, y1: 910 }, { x0: 910, y0: 0, x1: 1820, y1: 455 }])])]);
assert.deepStrictEqual(out, ['1階の部屋の形（長方形の数）を 1 → 2 に直しました。']);

// 何も変わっていなければ、何も言わない
out = changes([page(1, 7280, 4095, [room('洋室')])], [page(1, 7280, 4095, [room('洋室')])]);
assert.deepStrictEqual(out, []);

// 読み取れなかった階を勝手に増やさない（対応する階が無ければ触らない）
out = changes([page(1, 7280, 4095, [room('洋室')])], [page(3, 5915, 3640, [room('趣味部屋')])]);
assert.deepStrictEqual(out, []);

console.log('plan-review-changes: ok');
