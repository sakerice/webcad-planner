// 物の置かれ方の知識（assets/js/object-knowledge.js）。
//
// なぜ在るのか
// ------------
// 取り込んだ間取りの「外壁沿いの薄い箱」がテレビかカーテンかは、形では
// 決まらない。**カーテンは窓に付き、幅は窓より左右100〜200mm大きい**という
// 作法を持っていて初めて分かる。ここはその知識が壊れていないかを見る。
//
// 表は1か所しか無い（tools/catalogue-vocab.mjs の REAL_SIZE もここを参照する）。
// **同じ数字が二か所にあると、片方だけ直したときに検査と実物が食い違う。**
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const OK = require(join(ROOT, 'assets/js/object-knowledge.js'));
const RP = require(join(ROOT, 'assets/js/room-program.js'));

const MOUNTS = ['floor', 'wall', 'ceiling', 'tabletop', 'builtin', 'outdoor'];
const PLACES = ['exterior-wall', 'against-wall', 'free', 'room-centre', 'corner', 'boundary'];

let KINDS = null;
test.before(async () => {
  ({ KINDS } = await import('file://' + join(ROOT, 'tools/catalogue-vocab.mjs')));
});

test('分類の key が、カタログの語彙と一致している', () => {
  // key がずれると、タグ(tags.json)から知識を引けなくなる。
  const unknown = Object.keys(OK.KNOWLEDGE).filter((k) => !KINDS[k]);
  assert.deepEqual(unknown, [], '語彙に無い分類が表にある');
});

test('部屋・取り付け・位置の値が、決めた語のなかに収まっている', () => {
  for (const [kind, k] of Object.entries(OK.KNOWLEDGE)) {
    if (k.rooms && k.rooms !== 'any') {
      for (const r of k.rooms) {
        assert.ok(RP.ROOM_TYPES[r], `${kind}: 知らない部屋 ${r}`);
      }
    }
    if (k.mount) assert.ok(MOUNTS.includes(k.mount), `${kind}: 知らない取り付け ${k.mount}`);
    if (k.place) assert.ok(PLACES.includes(k.place), `${kind}: 知らない位置 ${k.place}`);
  }
});

test('付随先が、実在する分類か窓を指している', () => {
  const extra = ['window', 'window-door'];
  for (const [kind, k] of Object.entries(OK.KNOWLEDGE)) {
    for (const rel of [k.attach, k.span]) {
      if (!rel) continue;
      const to = rel.to || rel.of;
      assert.ok(KINDS[to] || extra.includes(to), `${kind}: 付随先 ${to} が実在しない`);
    }
  }
});

test('実寸の範囲が、下限より上限が大きい', () => {
  for (const [kind, k] of Object.entries(OK.KNOWLEDGE)) {
    if (!k.size) continue;
    assert.ok(k.size.w[0] < k.size.w[1], `${kind}: 幅の範囲が逆`);
    assert.ok(k.size.d[0] < k.size.d[1], `${kind}: 奥行の範囲が逆`);
    assert.ok(k.size.what, `${kind}: 実寸の根拠(what)が無い`);
  }
});

// ── 使えることを見る ────────────────────────────────────────────
test('外壁沿いの薄い箱を、テレビとカーテンで見分けられる', () => {
  // **これがこの表を作った理由。** 形だけでは同じ「薄い箱」になる。
  const windowWidth = 1690;

  // 窓幅＋左右150mm ＝ カーテンとして成立し、テレビとしては大きすぎる
  assert.equal(OK.spanOk('curtain', windowWidth + 300, windowWidth), true);
  assert.equal(OK.sizeOk('tv', windowWidth + 300, 150), false, 'テレビの実寸から外れていない');

  // 幅1,240・奥行300 ＝ テレビとして成立し、カーテンの幅の決まりから外れる
  assert.equal(OK.sizeOk('tv', 1240, 300), true);
  assert.equal(OK.spanOk('curtain', 1240, windowWidth), false, 'カーテンの幅の決まりに合ってしまう');

  // 向きの決まりが、両者で違う
  assert.equal(OK.KNOWLEDGE.curtain.face, 'none');
  assert.deepEqual(OK.KNOWLEDGE.tv.face, { faces: 'sofa' });
});

test('部屋に在り得ないものを弾ける', () => {
  assert.equal(OK.roomAllows('toilet', 'toilet'), true);
  assert.equal(OK.roomAllows('toilet', 'ldk'), false);
  assert.equal(OK.roomAllows('curtain', 'bedroom'), true, 'どこでも在り得るものが弾かれている');
  assert.equal(OK.roomAllows('bathtub', 'kids'), false);
  assert.equal(OK.roomAllows('other', 'ldk'), null, '知らない分類は判定しない');
});

test('レンジフードは、コンロ以上の幅でなければならない', () => {
  // 火源を覆えないと煙を捕らえられない。
  assert.equal(OK.spanOk('range-hood', 750, 750), true);
  assert.equal(OK.spanOk('range-hood', 600, 750), false);
});

test('実寸の表が、この知識表ひとつから出ている', async () => {
  const vocab = await import('file://' + join(ROOT, 'tools/catalogue-vocab.mjs'));
  const fromKnowledge = OK.sizeTable();
  assert.deepEqual(vocab.REAL_SIZE, fromKnowledge, '実寸が二か所に書かれている');
  assert.ok(Object.keys(fromKnowledge).length >= 10, '実寸を持つ分類が減っている');
});

test('jev へ渡す説明文に、判断の手がかりが入っている', () => {
  // **jev はリビングが何かは知っているが、カーテンの幅の決まりは知らない。**
  const text = OK.describe('curtain');
  assert.match(text, /窓/);
  assert.match(text, /100/, '幅の決まりが説明に入っていない');
  assert.match(text, /理由:/, 'なぜそうなのかが入っていない');
  assert.equal(OK.describe('存在しない分類'), '');
});
