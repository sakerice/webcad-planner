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

// ── 図面の印が何であるかを当てる ──────────────────────────────────
//
// **これが知識を書いた目的そのもの。** 形だけでは「薄い箱」としか言えない
// ものを、置かれ方の知識で絞る。
let NAMES = null;
test.before(async () => {
  const v = await import('file://' + join(ROOT, 'tools/catalogue-vocab.mjs'));
  NAMES = {};
  for (const [k, d] of Object.entries(v.KINDS)) NAMES[k] = { ja: d.ja, search: d.search };
});

const WINDOW = { kind: 'window', w: 1690, d: 150, dist: 120 };
const top = (mark, ctx) => (OK.candidatesFor(mark, ctx)[0] || {}).kind;

test('窓のそばにある幅の合う薄い箱は、カーテンになる', () => {
  assert.equal(top({ w: 1990, d: 150 },
    { roomType: 'ldk', near: [WINDOW], onExteriorWall: true }), 'curtain');
});

test('窓から離れた薄い箱は、カーテンにならない', () => {
  const list = OK.candidatesFor({ w: 1240, d: 300 }, { roomType: 'ldk', near: [] });
  assert.equal(list[0].kind, 'tv');
  assert.ok(!list.some((c) => c.kind === 'curtain'), 'そばに窓が無いのにカーテンが出ている');
});

test('幅が窓と釣り合わなければ、カーテンにならない', () => {
  // 窓1690 に対して幅800。カーテンの決まり（窓幅+100〜400）から外れる。
  const list = OK.candidatesFor({ w: 800, d: 150 },
    { roomType: 'ldk', near: [WINDOW], onExteriorWall: true });
  assert.ok(!list.some((c) => c.kind === 'curtain'));
});

test('図面の添え字が、いちばん強い手がかりになる', () => {
  assert.equal(top({ w: 1240, d: 300, label: 'TV' },
    { roomType: 'ldk', near: [], names: NAMES }), 'tv');
});

test('添え字があれば、寸法が合わなくても候補から外さない', () => {
  // **「テレビ」と書いてあるのに寸法が違うとき、欲しいのは「冷蔵庫では」
  // ではなく「テレビだが寸法が違う」という答え。**
  const list = OK.candidatesFor({ w: 600, d: 600, label: 'テレビ' },
    { roomType: 'ldk', near: [], names: NAMES });
  assert.equal(list[0].kind, 'tv');
  assert.ok(list[0].why.some((w) => /実寸が/.test(w)), '寸法が外れている旨が添えられていない');
});

test('添え字があれば、その部屋に在らなくても候補から外さない', () => {
  const list = OK.candidatesFor({ w: 640, d: 720, label: '洗濯機' },
    { roomType: 'ldk', near: [], names: NAMES });
  assert.equal(list[0].kind, 'laundry');
  assert.ok(list[0].why.some((w) => /この部屋には在らない/.test(w)));
});

test('呼び名を渡さなければ、添え字は使わない', () => {
  // 呼び名はカタログの語彙が持つ。**ここに書き写さない**ので、
  // 渡されなければその手がかりは使えない（黙って誤判定しない）。
  const list = OK.candidatesFor({ w: 600, d: 600, label: 'テレビ' }, { roomType: 'ldk', near: [] });
  assert.ok(!list.some((c) => c.kind === 'tv'), '呼び名なしで添え字を当てている');
});

test('根拠は、効いた順に並ぶ', () => {
  // **画面はいちばん強い根拠(why[0])だけを出す。** 拾った順のままだと
  // 「LDKの900×1400は食卓かもしれません（この部屋に在るもの）」という、
  // 何も説明していない一行になる。実物の図面で実測してそうなっていた。
  const list = OK.candidatesFor({ w: 900, d: 1400 }, { roomType: 'ldk', near: [] });
  const top = list.find((c) => c.kind === 'dining-table');
  assert.ok(top, '食卓が候補に出ていない');
  assert.match(top.why[0], /実寸/, '効いた根拠より先に「この部屋に在るもの」が来ている');

  // 添え字はいちばん強いので、寸法より先に来る。
  const labelled = OK.candidatesFor({ w: 1240, d: 300, label: 'TV' },
    { roomType: 'ldk', near: [], names: NAMES });
  assert.match(labelled[0].why[0], /書かれている/);

  // 「ただし…」の但し書きは最後に回る。
  const odd = OK.candidatesFor({ w: 600, d: 600, label: 'テレビ' },
    { roomType: 'ldk', near: [], names: NAMES });
  assert.match(odd[0].why[odd[0].why.length - 1], /^ただし/);
});
