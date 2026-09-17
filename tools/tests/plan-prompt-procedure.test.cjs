// 送るものが、役割ごとに分かれたままか。
//
// なぜ在るのか
// ------------
// 指示文は、失敗を見つけるたびに一文ずつ足して膨らんだ。役割の宣言も、
// データの仕様も、読み取りの段取りも、注意書きも、ひとつの文章に混ざっていた。
// そうなると、仕様として参照したいときに、どれが決まりでどれが助言か
// 分からなくなる。直すときも、どこを直せばよいか決められない。
//
// いまは3つに分けてある。
//
//   役割   SYSTEM_PROMPT        何をする人で、何を出すか
//   仕様   worker/plan-spec.mjs データの構成・項目・単位・使える種類
//   手順   buildPlanPrompt      どの順に何を埋めるか
//
// ここが見張るのは**分かれたままであること**。どれかに他の役割が混ざり
// 始めたら落ちる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('役割は、何をして何を出すかだけを言う', async () => {
  const { SYSTEM_PROMPT } = await mod('worker/plan-prompt.mjs');
  assert.match(SYSTEM_PROMPT, /間取り図/);
  assert.match(SYSTEM_PROMPT, /JSON/);
  // 手順や項目名が紛れ込んでいないこと
  assert.ok(!/手順/.test(SYSTEM_PROMPT), '役割に手順が混ざっている');
  assert.ok(!/rooms|items|dims/.test(SYSTEM_PROMPT), '役割に項目名が混ざっている');
});

test('検算を手順として持っている', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  // 検算を抜いたら、下辺の内訳から 227.5 が1つ落ちたまま通った(合計 7052.5、
  // 総寸法 7280)。読む→確かめる→直す、の「確かめる」は作業の一段であって
  // 注意書きではない。
  assert.match(buildPlanPrompt(), /内訳の合計が総寸法と一致することを確かめる/);
  // 読めない箇所が1つだけなら、その値は差で決まる。実測で、寸法の文字に
  // 補助線が重なって読めない箇所があり、モデルはそれを捨てて不一致のまま進んだ。
  assert.match(buildPlanPrompt(), /読めない箇所が1つだけの場合は/);
});

test('長方形でない部屋の表し方を手順として持っている', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  // 試した図面の洋室がL字だった。長方形ひとつでは表せない。
  assert.match(buildPlanPrompt(), /長方形でない部屋は、複数の長方形に分けて/);
});

test('階段は上下の向きと、廻り部分の接し方まで指示する', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /rot は上る向きに合わせる/, '階段の向きの指示が無い');
  assert.match(p, /辺を接して/, '廻り部分を直進部分に接して置く指示が無い');
  assert.match(p, /間を空けない/, '離れて置かれるのを止める指示が無い');
});

test('カタログの品物は大きさを変えさせない', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 階段・設備はアプリのカタログの品物なので、寸法を変えると3Dの納まりが崩れる。
  assert.match(p, /w と d は仕様の既定値のまま変えない/, '既定寸法を守らせる指示が無い');
  // 建具は逆に、図の寸法どおりにする。
  assert.match(p, /図に描かれている開口の幅/, '扉の幅を図から取る指示が無い');
  assert.match(p, /図に描かれている窓の幅/, '窓の幅を図から取る指示が無い');
});

test('長方形でない部屋を、見直しの手順で拾わせる', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /輪郭に凹みがあるのに parts が1つなら/, 'L字の取りこぼしに気づかせる指示が無い');
  assert.match(p, /入れた部屋を見直す/, '最後の見直しの手順が無い');
});

test('items の座標の決め方が手順にある', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 部屋には座標の導き方があるのに items には無く、玄関や階段が根拠なく
  // 置かれていた。設備は部屋の中、扉は部屋と部屋の境界、窓は部屋と外の境界。
  assert.match(p, /範囲の中に収める/, '設備を部屋の中に収める指示が無い');
  assert.match(p, /2つの部屋が接する境界の上に置く/, '扉を部屋の境界に置く指示が無い');
  assert.match(p, /部屋と建物の外が接する境界の上に置く/, '窓を外周に置く指示が無い');
  assert.match(p, /玄関ドアは、玄関と\s*建物の外が接する境界の上に置く/,
    '玄関ドアの置き場所の指示が無い');
});

test('室名の無い部屋を、何をもってその部屋とするかが手順にある', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 図面に室名が書かれていない部屋は多い。置かれている設備から決まる。
  for (const [fixture, name] of [['浴槽', '浴室'], ['洗面台', '洗面所'], ['便器', 'トイレ'],
                                 ['階段', '階段室'], ['玄関ドア', '玄関'], ['流し台', 'キッチン'],
                                 ['通路', '廊下']]) {
    assert.ok(p.includes(fixture) && p.includes(name),
      fixture + ' から ' + name + ' を作る手順が無い');
  }
});

test('手順は、順に何を埋めるかだけを言う', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 出力の各項目に、それを埋める手順がある
  for (const field of ['dims', 'width', 'depth', 'rooms', 'name', 'items']) {
    assert.ok(p.includes(field), `${field} を埋める手順が無い`);
  }
  assert.match(p, /手順1/);
  assert.match(p, /手順18/);
});

test('手順に仕様の写しを持たない', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const { ALLOWED_ITEM_TYPES } = await mod('worker/plan-item-spec.mjs');
  const p = buildPlanPrompt();
  assert.ok(!p.includes('ミリメートル'), '単位は仕様の側にある');
  assert.ok(!/原点/.test(p), '座標系は仕様の側にある');
  // 階段だけは例外。直進する部分と向きが変わる部分は別の種類で、どちらを
  // どこに置くかが手順そのものなので、名前を出さないと指示にならない。
  const spellOut = new Set(['stair', 'stair-corner']);
  for (const t of ALLOWED_ITEM_TYPES) {
    if (spellOut.has(t)) continue;
    assert.ok(!p.includes(t), `使える種類 "${t}" が手順にも書かれている`);
  }
});

test('手順に注意書きを持ち込まない', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 失敗を見つけるたびに足した「間違えやすい」「〜しないこと」の類。
  // 足しはじめると際限が無く、手順が読めなくなる。
  for (const word of ['間違えやすい', '気をつけ', '注意', '誤り:', 'こと。**']) {
    assert.ok(!p.includes(word), `手順に注意書き「${word}」が入っている`);
  }
});

test('補足(hint)は末尾に足される', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  assert.match(buildPlanPrompt({ hint: '1階だけの図です' }), /1階だけの図です/);
  assert.ok(!buildPlanPrompt().includes('利用者からの補足'), '補足が無いのに見出しが出ている');
});

test('手順は短いままにする', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  // 目安。超えたら、仕様か注意書きが混ざり始めている。
  assert.ok(buildPlanPrompt().length < 2200,
    '手順が ' + buildPlanPrompt().length + ' 文字ある。仕様か注意書きが混ざっていないか');
});
