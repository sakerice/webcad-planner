// 図面の印が何であるかを決める。
//
// なぜ在るのか
// ------------
// はじめは、印の寸法・部屋・窓との距離に点数を付けて**こちらで当てて**いた。
// 実物の図面3枚(平屋・2階建て・3階建て)で試すと、家具に文字が書かれていない
// 図面では 21件中1件、16件中1件しか当たらなかった。壁沿いの薄い箱をまとめて
// テレビと呼び、洗面ボウルをロールスクリーンと呼んだ。
//
// ところが読み取りは「二重線の縦長矩形。上端に小さな横長矩形、内側に格子」の
// ように**形を正確に描写して返していた**。それを1文字も見ていなかった。
//
// そこで2つを組んで、同じ実物の図面(印114件)で比べた:
//
//   A. jev に選ばせる(見た目の描写と置かれ方の知識を渡す)
//   B. 読み取り(図面を見ている側)が答え、知識で照らす
//
// 食い違った49件のうち、**A だけが正しかったものは0件**。jev が受け取るのは
// 一行の描写で、図面そのものではない。いまの分担:
//
//   読み取り … 何であるかを答える(guess)
//   知識    … それを照らす。部屋に合わなければ印を付ける(消さない)
//   jev     … 読み取りが答えなかった印だけ。候補は部屋で絞る(shortlistFor)
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const OK = require(join(ROOT, 'assets/js/object-knowledge.js'));
const mod = (rel) => import('file://' + join(ROOT, rel));

// ── 候補の絞り方 ────────────────────────────────────────────────

test('まとまりで描かれた印でも、正解を候補から落とさない', () => {
  // **図面の印はまとまりで描かれる。** 実測の値そのもの。
  // 寸法の範囲で外していた頃は、これらの正解がすべて落ちていた。
  const cases = [
    [{ w: 1760, d: 1460 }, 'bedroom', 'bed', 'ベッド＋ナイトテーブル2つ'],
    [{ w: 1675, d: 1610 }, 'ldk', 'dining-table', '食卓＋椅子4脚'],
    [{ w: 560, d: 560 }, 'washroom', 'vanity', '洗面ボウルだけ'],
    [{ w: 850, d: 830 }, 'washitsu', 'low-table', '和室の座卓'],
  ];
  for (const [mark, room, want, what] of cases) {
    assert.ok(OK.shortlistFor(mark, room).includes(want), `${what}(${want}) が候補から落ちた`);
  }
});

test('窓から離れていても、カーテンを候補から落とさない', () => {
  // 読み取りは窓の中心を壁芯に置き、印の中心は室内側にある。
  // 実測で最寄りの窓まで 1431mm あり、「窓から300mm以内」で全部落ちていた。
  assert.ok(OK.shortlistFor({ w: 280, d: 1400 }, 'ldk').includes('curtain'));
});

test('その部屋に在り得ないものは外す', () => {
  const list = OK.shortlistFor({ w: 1600, d: 750 }, 'ldk');
  assert.ok(!list.includes('bathtub'), 'LDK の候補に浴槽がある');
  assert.ok(!list.includes('toilet'));
});

test('部屋の用途が決まっていなければ、何も返さない', () => {
  // 決まらないものを決めつけない。候補46件を jev に投げても選べない。
  assert.deepEqual(OK.shortlistFor({ w: 1000, d: 2000 }, null), []);
});

// ── jev への聞き方 ─────────────────────────────────────────────

const MARK = {
  id: 'm1', looks: '横長の二重矩形。右端に小さな矩形が上下に2つ並び、内側に薄い格子模様',
  label: '', w: 1760, d: 1460, roomJa: '寝室',
  candidates: ['bed', 'chest', 'desk'], names: { bed: 'ベッド', chest: 'チェスト', desk: 'デスク' },
};

test('jev に見た目と置かれ方の知識の両方を渡す', async () => {
  const { judgeMarks } = await mod('worker/plan-finish.mjs');
  let asked = null;
  await judgeMarks([MARK], {}, {
    aiRun: async (_m, input) => { asked = input; return { answers: { kind: { choice: 'bed', confidence: 0.8 } } }; },
  });
  const q = asked.questions.kind;
  assert.match(q.instructions, /二重矩形/, '見た目(looks)を渡していない');
  assert.match(q.instructions, /group/, 'まとまりで描かれることを伝えていない');
  assert.match(q.criteria.bed, /ベッド/, '呼び名を渡していない');
  assert.match(q.criteria.bed, /理由:/, '置かれ方の知識(describe)を渡していない');
  assert.ok(q.criteria.none, '「どれでもない」を選べない');
});

test('jev の答えを返す', async () => {
  const { judgeMarks } = await mod('worker/plan-finish.mjs');
  const out = await judgeMarks([MARK], {}, {
    aiRun: async () => ({ answers: { kind: { choice: 'bed', confidence: 0.8 } } }),
  });
  assert.deepEqual(out, [{ id: 'm1', kind: 'bed', confidence: 0.8 }]);
});

test('迷った答え・候補に無い答え・どれでもない は返さない', async () => {
  const { judgeMarks } = await mod('worker/plan-finish.mjs');
  const ask = (answer) => judgeMarks([MARK], {}, { aiRun: async () => ({ answers: { kind: answer } }) });
  assert.deepEqual(await ask({ choice: 'bed', confidence: 0.2 }), [], '迷った答えを採っている');
  assert.deepEqual(await ask({ choice: 'bathtub', confidence: 0.9 }), [], '候補に無いものを採っている');
  assert.deepEqual(await ask({ choice: 'none', confidence: 0.9 }), []);
});

test('jev が無ければ黙る', async () => {
  // 手元の wrangler dev で remote が切れているとき・本番でバインディングが
  // 無いとき。**止めない。**
  const { judgeMarks } = await mod('worker/plan-finish.mjs');
  assert.deepEqual(await judgeMarks([MARK], {}), []);
});

// ── 読み取り側の判断 ───────────────────────────────────────────

test('読み取りが選べる語は、こちらの表から作っている', async () => {
  // 書き写すと、表に足したときに読み取りだけ古いまま残る。
  const { PLAN_RESPONSE_SCHEMA: s } = await mod('worker/plan-response-schema.mjs');
  const RP = require(join(ROOT, 'assets/js/room-program.js'));
  const f = s.properties.floors.items.properties;
  assert.deepEqual(f.rooms.items.properties.use.enum, Object.keys(RP.ROOM_TYPES));
  assert.deepEqual(f.marks.items.properties.guess.enum, Object.keys(OK.KNOWLEDGE));
});

test('読み取りの判断が、部屋と印に載って返る', async () => {
  const { finishImportedPlan } = await mod('worker/routes-ai.mjs');
  const body = await finishImportedPlan({
    floors: [{
      floor: 3, width: 2275, depth: 3185,
      rooms: [{ name: '趣味部屋', parts: [{ x0: 0, y0: 0, x1: 2275, y1: 3185 }], use: 'study' }],
      marks: [{ x: 1000, y: 1000, w: 1200, d: 600, label: '', looks: '横長の矩形', guess: 'desk' }],
    }],
  }, null, {}).json();
  assert.equal(body.plan.rooms[0].use, 'study');
  assert.equal(body.marks[0].guess, 'desk');
});

// ── 本筋の流れ（画面側） ───────────────────────────────────────

const PC = require(join(ROOT, 'assets/js/plan-check.js'));

/** 取り込みと同じ経路で作った間取り（部屋の id が本物の付け方になる）。 */
async function importedPlan(rooms, marks) {
  const { finishImportedPlan } = await mod('worker/routes-ai.mjs');
  const body = await finishImportedPlan({
    floors: [{ floor: 1, width: 5460, depth: 3640, rooms, marks: marks || [] }],
  }, null, {}).json();
  return body;
}

test('仕上げが決めた部屋の用途が、取り込んだ部屋に届く', async () => {
  // **仕上げへは部屋を並び順の番号(r0, r1)で送っている。** 取り込んだ部屋の
  // id は p38 のような別の番号なので、そのまま引くと1件も当たらない。
  // 実物の2階建てで 29部屋中0部屋だった。単体テストが id を手で揃えて
  // 作っていたので、ずっと通っていた。**ここは本物の取り込みで作る。**
  const { plan } = await importedPlan([
    { name: '洋室(1)', parts: [{ x0: 0, y0: 0, x1: 2730, y1: 3640 }] },
    { name: '洋室(2)', parts: [{ x0: 2730, y0: 0, x1: 5460, y1: 3640 }] },
  ]);
  assert.notEqual(plan.rooms[0].id, 'r0', '前提が崩れた: 取り込んだ部屋の id が並び順の番号と同じ');
  const types = PC.typesByRoomId(plan, [{ id: 'r0', type: 'kids' }, { id: 'r1', type: 'bedroom' }]);
  assert.equal(types[plan.rooms[0].id], 'kids');
  assert.equal(types[plan.rooms[1].id], 'bedroom');
});

test('届いた用途で、名前の決まらない部屋の設備を照らせる', async () => {
  const { plan } = await importedPlan([
    { name: '洋室(1)', parts: [{ x0: 0, y0: 0, x1: 5460, y1: 3640 }] },
  ]);
  plan.items.push({ type: 'bath', floor: 1, x: 1000, y: 1000, w: 1600, d: 750 });
  assert.deepEqual(PC.knowledgeWarnings(plan, {}), [], '用途が無いのに判定している');
  const types = PC.typesByRoomId(plan, [{ id: 'r0', type: 'bedroom' }]);
  const w = PC.knowledgeWarnings(plan, types);
  assert.equal(w.length, 1, '仕上げで決まった用途が照合に届いていない');
  assert.match(w[0], /浴槽/);
});

test('読み取りが答えた印はそれを採り、答えなかった印だけ jev に回す', async () => {
  const { plan, marks } = await importedPlan(
    [{ name: '寝室', parts: [{ x0: 0, y0: 0, x1: 5460, y1: 3640 }] }],
    [
      { x: 1000, y: 1000, w: 1760, d: 1460, looks: '二重矩形に枕2つ', guess: 'bed' },
      { x: 3000, y: 1000, w: 400, d: 400, looks: '小さな正方形', guess: 'other' },
      { x: 4000, y: 1000, w: 400, d: 400, looks: '小さな正方形' },
    ]);
  const got = PC.readMarks(plan, marks, {});
  assert.equal(got.reads.length, 1);
  assert.equal(got.reads[0].kind, 'bed');
  assert.equal(got.reads[0].from, 'reader');
  assert.equal(got.reads[0].fits, true);
  assert.equal(got.ask.length, 2, '答えの無い印を jev に回していない');
  assert.ok(got.ask[0].candidates.includes('chest'), '寝室の候補で絞れていない');
  assert.ok(!got.ask[0].candidates.includes('bathtub'));
});

test('知識と食い違う読み取りの答えは、消さずに印を付ける', async () => {
  // 実物の図面で、食い違い13件はすべて知識の側の穴だった。消すと、
  // 正しい答えを知識の穴で捨てることになる。
  const { plan, marks } = await importedPlan(
    [{ name: 'LDK', parts: [{ x0: 0, y0: 0, x1: 5460, y1: 3640 }] }],
    [{ x: 1000, y: 1000, w: 1600, d: 750, looks: '角丸の二重矩形', guess: 'bathtub' }]);
  const got = PC.readMarks(plan, marks, {});
  assert.equal(got.reads.length, 1, '食い違った答えを消している');
  assert.equal(got.reads[0].fits, false);
});

test('実物の図面で「部屋に合わない」と言っていた置かれ方が、直っている', () => {
  // 読み取りが正しく、知識の表が狭すぎた11件の実例。
  const cases = [
    ['plant', 'bedroom', '主寝室の鉢植え'],
    ['plant', 'entry', '玄関脇の鉢植え'],
    ['cabinet', 'bedroom', '寝室のテレビ台'],
    ['cabinet', 'washroom', 'ランドリーの収納'],
    ['closet', 'storage', '室名の無い物入れのハンガーパイプ'],
    ['shelf', 'washroom', '洗面所のニッチの棚'],
    ['shoe-storage', 'storage', 'シューズクローク(SCL)の下駄箱'],
  ];
  for (const [kind, room, what] of cases) {
    assert.equal(OK.roomAllows(kind, room), true, `${what}が、まだ「部屋に合わない」になる`);
  }
});
