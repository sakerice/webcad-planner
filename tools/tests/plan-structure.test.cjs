// 壁から構造部材（基礎・屋根）を組み立てる処理。
//
// 間取り図から起こしたプランに基礎も屋根も無かった。AIへ渡す「使える種類」の
// 一覧に入れていなかったため——出さなかったのではなく、出すなと言っていた。
// 出来上がるのは「家」ではなく「壁の集まり」だった。
//
// これはAIに出させて直す話ではない。基礎と屋根は壁から一意に決まる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = join(__dirname, '..', '..');
const { structureFor, footprint, floorsOf, describe: describeMade, EAVE_MM } =
  require(join(ROOT, 'assets', 'js', 'plan-structure.js'));

function w(x1, y1, x2, y2, floor) {
  return { x1, y1, x2, y2, floor: floor || 1, thick: 120 };
}
// 1階 7280×4095、2階は 5460×4095（3階ぶんは無い）の家
function house() {
  return [
    w(0, 0, 7280, 0, 1), w(7280, 0, 7280, 4095, 1), w(7280, 4095, 0, 4095, 1), w(0, 4095, 0, 0, 1),
    w(0, 0, 5460, 0, 2), w(5460, 0, 5460, 4095, 2), w(5460, 4095, 0, 4095, 2), w(0, 4095, 0, 0, 2),
  ];
}
const byType = (items) => Object.fromEntries(items.map((i) => [i.type, i]));

test('基礎は1階の壁の外形そのもの', () => {
  const made = byType(structureFor(house()));
  assert.ok(made.foundation, '基礎が作られていない');
  assert.deepEqual(
    { x: made.foundation.x, y: made.foundation.y, w: made.foundation.w, d: made.foundation.d },
    { x: 0, y: 0, w: 7280, d: 4095 });
  assert.equal(made.foundation.floor, 1);
  assert.equal(made.foundation.foundationHeight, 450);
});

test('屋根は最上階の外形に軒を出した大きさで、その1つ上の階に載る', () => {
  const made = byType(structureFor(house()));
  assert.ok(made.roof, '屋根が作られていない');
  // 2階が最上階(5460×4095)。軒450mmを四周に出す。
  assert.deepEqual(
    { x: made.roof.x, y: made.roof.y, w: made.roof.w, d: made.roof.d },
    { x: -EAVE_MM, y: -EAVE_MM, w: 5460 + EAVE_MM * 2, d: 4095 + EAVE_MM * 2 });
  assert.equal(made.roof.floor, 3, '最上階(2)の1つ上に載っていない');
});

test('屋根は陸屋根にする（図面に屋根伏図が無いので形を推測しない）', () => {
  const made = byType(structureFor(house()));
  // 勾配屋根なら棟の向きを決める必要があるが、平面図だけでは分からない。
  // 分からないものを推測で置くより、平らな板にして利用者に選ばせる。
  assert.equal(made.roof.roofType, 'flat');
});

test('敷地は作らない（図面に描かれていないものを推測で置かない）', () => {
  const types = structureFor(house()).map((i) => i.type);
  assert.ok(!types.includes('site-rect'),
    '敷地を勝手に作っている。隣地も道路も分からないのに、それらしい矩形を置くと利用者が信じてしまう');
});

test('平屋でも成り立つ', () => {
  const flat = [w(0, 0, 3640, 0, 1), w(3640, 0, 3640, 2730, 1), w(3640, 2730, 0, 2730, 1), w(0, 2730, 0, 0, 1)];
  const made = byType(structureFor(flat));
  assert.equal(made.foundation.w, 3640);
  assert.equal(made.roof.floor, 2, '平屋なら屋根は2階に載る');
});

test('壁が無ければ何も作らない', () => {
  assert.deepEqual(structureFor([]), []);
  assert.deepEqual(structureFor(null), []);
});

test('要らないほうを切れる', () => {
  assert.deepEqual(structureFor(house(), { roof: false }).map((i) => i.type), ['foundation']);
  assert.deepEqual(structureFor(house(), { foundation: false }).map((i) => i.type), ['roof']);
});

test('外形は壁の端点から取る', () => {
  assert.deepEqual(footprint(house(), 1), { x: 0, y: 0, w: 7280, d: 4095 });
  assert.deepEqual(footprint(house(), 2), { x: 0, y: 0, w: 5460, d: 4095 });
  assert.equal(footprint(house(), 9), null, '無い階に外形を作っている');
  assert.deepEqual(floorsOf(house()), [1, 2]);
});

test('何を足したかを利用者に伝えられる', () => {
  const text = describeMade(structureFor(house()));
  assert.match(text, /基礎/);
  assert.match(text, /屋根/);
  assert.match(text, /自動で置きました/, '勝手に足したことが分かる文になっていない');
});

// ── 実物のプランと同じ作りになっているか ────────────────────────────
test('実物の基礎・屋根と、同じ形の値を作っている', () => {
  // 実物がどう作られているかに合わせる。ここがずれると、取り込んだ家だけ
  // 別の作りになり、あとから編集したときに挙動が変わる。
  //
  // 出荷用の assets/default_plan.json は読まない決まり(fixture-only.test.cjs)。
  // 凍結した間取りを見る。
  const plan = JSON.parse(readFileSync(join(ROOT, 'tools', 'tests', 'fixtures', 'house-2f.json'), 'utf8'));
  const realFoundation = plan.items.find((i) => i.type === 'foundation');
  const realRoof = plan.items.find((i) => i.type === 'roof');
  const made = byType(structureFor(house()));
  for (const k of ['type', 'x', 'y', 'w', 'd', 'rot', 'floor', 'foundationHeight']) {
    assert.ok(k in made.foundation, '基礎に ' + k + ' が無い');
    assert.ok(k in realFoundation, '実物の基礎に ' + k + ' が無い(前提が変わった)');
  }
  for (const k of ['roofType', 'pitch', 'roofThickness', 'roofSkirt', 'elev']) {
    assert.ok(k in made.roof, '屋根に ' + k + ' が無い');
    assert.ok(k in realRoof, '実物の屋根に ' + k + ' が無い(前提が変わった)');
  }
  assert.equal(made.foundation.foundationHeight, realFoundation.foundationHeight,
    '基礎の高さが出荷しているものと違う');
});

// ── 各階が重なっているか ──────────────────────────────────────────
//
// 実測で、AIがPDFの各ページを「紙の上の位置のまま」並べたことがある。
// 1階 y=0..4095 / 2階 y=4095..8190 / 3階 y=8190..11830。上下階が重ならず、
// 基礎も屋根もあらぬ位置に付いた。見た目にはすぐ分かるが、数字だけ見ていると
// 気づきにくい。
const { floorsOverlap } = require(join(ROOT, 'assets', 'js', 'plan-structure.js'));

test('各階が同じ位置に重なっていれば通る', () => {
  const r = floorsOverlap(house());
  assert.equal(r.ok, true);
  assert.deepEqual(r.floors, [1, 2]);
});

test('階を縦に積み上げていたら気づく', () => {
  const stacked = [
    w(0, 0, 7280, 0, 1), w(7280, 0, 7280, 4095, 1), w(7280, 4095, 0, 4095, 1), w(0, 4095, 0, 0, 1),
    // 2階を1階の真下へ置いてしまった場合
    w(0, 4095, 7280, 4095, 2), w(7280, 4095, 7280, 8190, 2), w(7280, 8190, 0, 8190, 2), w(0, 8190, 0, 4095, 2),
  ];
  const r = floorsOverlap(stacked);
  assert.equal(r.ok, false, '積み上げを見逃している');
  assert.deepEqual(r.detached, [2]);
});

test('上階が小さくても、重なっていれば通る（セットバック）', () => {
  const setback = [
    w(0, 0, 7280, 0, 1), w(7280, 0, 7280, 4095, 1), w(7280, 4095, 0, 4095, 1), w(0, 4095, 0, 0, 1),
    w(0, 0, 5460, 0, 2), w(5460, 0, 5460, 3640, 2), w(5460, 3640, 0, 3640, 2), w(0, 3640, 0, 0, 2),
  ];
  assert.equal(floorsOverlap(setback).ok, true, 'セットバックを積み上げと誤判定している');
});

test('1階だけなら判定しない', () => {
  assert.equal(floorsOverlap([w(0,0,3640,0,1), w(3640,0,3640,2730,1), w(3640,2730,0,2730,1), w(0,2730,0,0,1)]).ok, true);
});
