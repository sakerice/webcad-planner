// 取り込んだ間取りを、物の置かれ方の知識に照らす（worker/plan-check.mjs）。
//
// なぜ在るのか
// ------------
// 読み取りは図面から設備を拾うが、**それが置かれた部屋が正しいかは見ていない。**
// 浴槽が「洋室」に入っていても、そのまま通って3Dになる。見れば一目で分かる
// 間違いだが、読み取りの時点では誰も気づかない。
//
// ここが落ちると、その取り違えが黙って通るようになる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
let check = null;

test.before(async () => {
  check = await import('file://' + join(ROOT, 'worker/plan-check.mjs'));
});

/** 部屋1つと、その中の設備1つだけの間取り。 */
function planWith(roomName, item) {
  return {
    rooms: [{ floor: 1, n: roomName, x: 0, y: 0, w: 3000, d: 3000 }],
    items: [Object.assign({ floor: 1, x: 1000, y: 1000 }, item)],
  };
}

test('浴槽が主寝室にあれば指摘する', () => {
  const w = check.knowledgeWarnings(planWith('主寝室', { type: 'bath', w: 1600, d: 750 }));
  assert.equal(w.length, 1, '指摘が出ていない');
  assert.match(w[0], /浴槽/);
  assert.match(w[0], /主寝室/);
  assert.match(w[0], /浴室/, 'どこにあるべきかが書かれていない');
});

test('用途が名前で決まらない部屋（洋室）では黙る', () => {
  // 「洋室」は寝室・子供部屋・書斎のどれか名前だけでは決まらない
  // （assets/js/room-program.js の AMBIGUOUS）。**決まらないものを
  // 決めつけて指摘すると、正しい図面を直させることになる。**
  // ここを判断させたいなら jev の出番で、名前の規則では届かない。
  const w = check.knowledgeWarnings(planWith('洋室(1)', { type: 'bath', w: 1600, d: 750 }));
  assert.deepEqual(w, []);
});

test('浴槽が浴室にあれば黙る', () => {
  assert.deepEqual(check.knowledgeWarnings(planWith('浴室', { type: 'bath', w: 1600, d: 750 })), []);
});

test('便器がLDKにあれば指摘する', () => {
  const w = check.knowledgeWarnings(planWith('LDK', { type: 'toilet', w: 380, d: 680 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /便器/);
});

test('実寸から外れた寸法を指摘する', () => {
  // 便器 380×680 が標準。3000×3000 は明らかに読み違い。
  const w = check.knowledgeWarnings(planWith('トイレ', { type: 'toilet', w: 3000, d: 3000 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /3000×3000/);
  assert.match(w[0], /380/, '標準寸法が示されていない');
});

test('どの部屋にも入っていない設備を指摘する', () => {
  const plan = planWith('浴室', { type: 'bath', w: 1600, d: 750 });
  plan.items[0].x = 90000;   // 部屋の外へ出す
  plan.items[0].y = 90000;
  const w = check.knowledgeWarnings(plan);
  assert.equal(w.length, 1);
  assert.match(w[0], /どの部屋にも/);
});

test('知識を持たない種類には、何も言わない', () => {
  // **推測で警告を出すと、正しい図面を直させることになる。**
  for (const type of ['window', 'door-swing', 'stair', 'balcony', 'door-front']) {
    assert.deepEqual(
      check.knowledgeWarnings(planWith('LDK', { type: type, w: 800, d: 200 })), [],
      type + ' に根拠の無い指摘が出ている');
  }
});

test('部屋の名前から用途が決まらないときは黙る', () => {
  // 「物置」は室種別の表に無い。知らない部屋で在り得ないとは言えない。
  const w = check.knowledgeWarnings(planWith('ほげほげ', { type: 'bath', w: 1600, d: 750 }));
  assert.deepEqual(w, [], '知らない部屋で誤った指摘が出ている');
});

test('読み取りの種類と知識表の分類の対応が、実在するものを指している', async () => {
  const OK = require(join(ROOT, 'assets/js/object-knowledge.js'));
  const spec = await import('file://' + join(ROOT, 'worker/plan-item-spec.mjs'));
  for (const [importType, kind] of Object.entries(check._internals.IMPORT_TO_KIND)) {
    assert.ok(spec.ALLOWED_ITEM_TYPES.includes(importType),
      `${importType} は読み取りが返さない種類`);
    assert.ok(OK.KNOWLEDGE[kind], `${kind} が知識表に無い`);
  }
});
