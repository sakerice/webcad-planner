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

test('長方形でない部屋を、ふつうの部屋より先に見つけさせる', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // 試した図面の洋室がL字だった。ふつうの部屋の手順に注意書きとして添えても
  // 従わなかったので、**独立した手順として、しかも先に**置く。
  const lshape = p.indexOf('輪郭が長方形でない部屋');
  const named = p.indexOf('室名が書かれているものを入れる');
  assert.ok(lshape > 0, 'L字を探す手順が無い');
  assert.ok(named > 0, '室名のある部屋の手順が無い');
  assert.ok(lshape < named, 'L字の手順が、ふつうの部屋より後になっている');
  assert.match(p, /この手順は飛ばさない/, '飛ばされたときに何が起きるかが書かれていない');
});

test('階段は上下の向きと、廻り部分の接し方まで指示する', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /rot は上る向きに合わせる/, '階段の向きの指示が無い');
  assert.match(p, /辺を接して/, '廻り部分を直進部分に接して置く指示が無い');
  assert.match(p, /間を空けない/, '離れて置かれるのを止める指示が無い');
});

test('階段は部屋と重なってよい（階段下の収納・トイレを消さない）', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const { planSpec } = await mod('worker/plan-spec.mjs');
  // 日本の住宅では階段の下がトイレや収納になっていることが多い。
  // 部屋どうしは重ねられない(重ねると壁が消える)が、階段は物なので重ねてよい。
  // 「階段のある場所は階段室」にすると、室名のある収納やトイレが消える。
  assert.match(buildPlanPrompt(), /階段は部屋と重なってよい/, '階段を重ねてよいと伝えていない');
  assert.match(buildPlanPrompt(), /室名が書かれて\s*いれば、その部屋として入れる/,
    '階段下に室名があるときの扱いが無い');
  assert.match(planSpec(), /物は部屋と重なってよい/, '仕様に重なりの扱いが無い');
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

test('部屋の面積を検算させる（L字の取りこぼしに気づく唯一の手）', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  // L字を長方形1つで済ませる誤りは、手順に書いても直らなかった。寸法線で
  // 効いたのは検算だったので、同じ手を面積に当てる。合計が width×depth に
  // 足りなければ、どこかの部屋が凹みを埋めている。
  assert.match(p, /部屋の面積を検算する/, '面積の検算が無い');
  assert.match(p, /width × depth と一致するか/, '何と比べるのかが無い');
  assert.match(p, /手順6の見落とし/, '足りないときの原因が示されていない');
  assert.match(p, /輪郭に凹みがあるのに parts が1つの部屋がある/, 'L字の取りこぼしに気づかせる指示が無い');
});

test('階段の折り返しを見直させる', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /段が向きを変えていれば/, '折り返しの見分け方が無い');
  assert.match(p, /段の番号が折り返している/, '図の上での見分け方が無い');
  assert.match(p, /階段を見直す/, '最後の見直しが無い');
});

test('階段の長さは図に従わせる（段数で決まるため）', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const { planSpec } = await mod('worker/plan-spec.mjs');
  // 「既定寸法を変えるな」と「図のとおりに再現しろ」が矛盾していた。
  // 実測で、モデル自身が「階段の奥行きを図に合わせたが指示と矛盾する
  // 可能性がある」と申告した。長さは段数で決まるので図に従う。
  assert.match(buildPlanPrompt(), /w は仕様の既定値のまま。d は図の段の数に合わせた長さ/);
  assert.match(planSpec(), /d は段数に応じて図から読み取った長さ/);
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
  assert.match(p, /手順20/);
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
  //
  // 2600 → 2700（2026-09-24）。図面の印(marks)を拾う手順19bを足したぶん。
  // **説明は仕様書(plan-spec.mjs の「図面に描かれていた印」)へ置き、
  // 手順には1行しか足していない。** 上げたのは工程が1つ増えたからであって、
  // 注意書きが混ざったからではない。混ざり始めたら、また上げずに減らすこと。
  assert.ok(buildPlanPrompt().length < 2700,
    '手順が ' + buildPlanPrompt().length + ' 文字ある。仕様か注意書きが混ざっていないか');
});

// 実測で起きた読み違い。どれも「指示が無かった」ことが原因だった。
test('外構を部屋にしない（バルコニーは物として置く）', async () => {
  // 実測で、玄関ポーチ(455×2275)が1階の部屋になり、バルコニーは2階の部屋と
  // 物の両方に入った。部屋にすると床と壁ができてしまう。
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /建物の外は rooms に入れない/, '屋外を部屋から外す指示が無い');
  assert.match(p, /ポーチ・テラス・デッキ/, '何が屋外なのかの例が無い');
  assert.match(p, /バルコニーとして\s*items に入れる/, 'バルコニーを物として置く手順が無い');
});

test('家に、外から中へ入る入口が在ることを確かめさせる', async () => {
  // 実測で、玄関ドアの内側が別の部屋(KB置き場)に食われ、玄関が1つも
  // 作られなかった。「玄関ドアと土間がある部屋」だけでは足りない。
  //
  // **見分け方ではなく、満たすべき条件として書く。** 見分け方を書こうとして
  // 「くぐった先に部屋が無ければ玄関」と置いたことがあるが、このアプリは
  // 土間も部屋の長方形で作るので、一意に決まらない。
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /家には、外から中へ入る入口が必ず1つ以上ある/, '玄関が在ることの確認が無い');
  assert.match(p, /それをくぐると家の中の部屋へ入れる/, '外と部屋がつながる条件が無い');
  assert.ok(!/くぐった先に部屋が無い/.test(p), '一意に決まらない見分け方が残っている');
});

test('階段の上下を意識させる', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const { itemTypeTable } = await mod('worker/plan-item-spec.mjs');
  // 上る向きは図に描かれている。どこを見れば分かるかを言う。
  assert.match(buildPlanPrompt(), /UP/, '上る向きの読み取り方が無い');
  // 階の間の決まりは仕様の側（データの意味そのものなので）。
  assert.match(itemTypeTable(), /上下階で同じ位置に置き、いちばん上の階には置かない/,
    '階段が階をまたぐ物であることが仕様に無い');
  // 手順の側は、読み直して揃える作業だけを持つ。
  assert.match(buildPlanPrompt(), /下の階と位置が揃っているか/, '階段の見直しに位置の確認が無い');
});
