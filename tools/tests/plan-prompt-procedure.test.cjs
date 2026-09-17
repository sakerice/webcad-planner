// 図面を読む「段取り」が指示文に残っているか。
//
// なぜ在るのか
// ------------
// 読み取りの精度は、何を先に決めるかでほぼ決まる。実測で分かったこと:
//
//   - 各階を紙の上の位置のまま並べる(1階 y=0..4095 / 2階 y=4095..8190)。
//     上下階が重ならず、基礎も屋根もあらぬ位置に付く。
//   - 間仕切り壁を1本落とすと、部屋は壁から計算されるので2部屋が1つになる。
//   - 「合計が合うまで読み直す」と思考だけで32,765トークンを使い切り、
//     答えが0トークンのまま打ち切られる(課金だけされて1件も使えない)。
//
// どれも段取りの問題で、直した文が消えると同じ失敗が戻る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const prompt = async () => (await mod('worker/plan-prompt.mjs')).buildPlanPrompt();

test('階ごとにくり返す段取りになっている', async () => {
  const p = await prompt();
  assert.match(p, /階の数だけ.*くり返/s, '階ごとのくり返しになっていない');
  assert.match(p, /手順0/, '全体を見る手順が無い');
});

test('階段を壁より先に置く（上下階をつなぐ基準だから）', async () => {
  const p = await prompt();
  const stair = p.indexOf('階段を置く');
  const walls = p.indexOf('外周の壁を置く');
  assert.ok(stair > 0 && walls > 0, '階段と外周の手順が見つからない');
  assert.ok(stair < walls, '階段が壁より後になっている。上下階を合わせる基準が無くなる');
});

test('部屋を先に捉えてから、その輪郭を壁にする', async () => {
  const p = await prompt();
  // 壁から先に引くと間仕切りの引き忘れに気づけない。部屋を数えてから
  // その境界を引かせることで、抜けが見つかる。
  assert.match(p, /部屋の区画を目で捉え/, '部屋を先に捉える手順が無い');
  assert.match(p, /輪郭を、?壁として引/, '捉えた部屋の輪郭を壁にする指示が無い');
});

test('検算は1回だけ（思考が止まらなくなる）', async () => {
  const p = await prompt();
  assert.match(p, /一度だけ/, '検算を1回に限る指示が無い');
  assert.match(p, /何度も読み直さない/, '読み直しを止める指示が無い');
});

test('全階で座標系はひとつ、という注意が残っている', async () => {
  const p = await prompt();
  assert.match(p, /全階で座標系はひとつ/);
  assert.match(p, /4095\.\.8190/, '紙の位置のまま積む誤りの実例が消えている');
});

test('補ってよいものと、いけないものを分けている', async () => {
  const p = await prompt();
  assert.match(p, /補ってよい/, '確実に決まるものを補う許可が無い');
  assert.match(p, /補ってはいけない/, '根拠の無い補完を止める指示が無い');
  // 読めない画像は必ず来る。決められるものは決め、決められないものは省く。
  assert.match(p, /欠けているのが\*\*1つだけ\*\*|欠けているのが1つだけ/,
    '差から一意に決まる場合の許可が無い');
  assert.match(p, /ふつう在るからという理由で足す/, '「ありそう」で足すのを止める指示が無い');
  assert.match(p, /notes に/, '補った根拠を書かせていない');
});

test('部屋と基礎と屋根はアプリが作る、と伝えている', async () => {
  const p = await prompt();
  for (const [layer, who] of [['部屋', '壁から計算'], ['基礎', '自動で作る'], ['屋根', '自動で作る']]) {
    assert.ok(p.includes(layer), `${layer} の説明が無い`);
  }
  assert.match(p, /壁の精度が、?そのまま家の精度/, '壁がすべてを決めることが伝わっていない');
});

test('建具の向きは指定させない（壁から決まる）', async () => {
  const p = await prompt();
  // assets/js/draw-2d.js の getOpeningWallInfo が最寄りの壁(400mm以内)へ
  // 吸着させ、向きも壁から取る。AIに出させても使われない。
  assert.match(p, /向き\(rot\)は指定しなくて構いません|向きの指定は不要/,
    '使われない回転を出させようとしている');
  assert.match(p, /400mm/, '壁に載せる許容範囲が書かれていない');
});

test('家具は読ませない', async () => {
  const p = await prompt();
  assert.match(p, /家具（ベッド・ソファ・食卓・テレビ・棚）は出力しません/);
});

test('補足(hint)は末尾に足される', async () => {
  const { buildPlanPrompt } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt({ hint: '1階だけの図です' });
  assert.match(p, /1階だけの図です/);
  assert.ok(!buildPlanPrompt().includes('利用者からの補足'), '補足が無いのに見出しが出ている');
});
