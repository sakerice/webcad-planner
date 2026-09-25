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

test.before(() => {
  check = require(join(ROOT, 'assets/js/plan-check.js'));
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

test('用途を渡せば、名前で決まらない部屋でも判定できる', () => {
  // **ここが jev をつなぐ口。** 「洋室」は名前だけでは寝室・子供部屋・書斎の
  // どれか決まらないので取り込み直後は黙るが、jev が決めたあとなら言える。
  const plan = planWith('洋室(1)', { type: 'bath', w: 1600, d: 750 });
  plan.rooms[0].id = 'r1';
  assert.deepEqual(check.knowledgeWarnings(plan), [], '用途が無いのに判定している');
  const w = check.knowledgeWarnings(plan, { r1: 'bedroom' });
  assert.equal(w.length, 1);
  assert.match(w[0], /浴槽/);
});

test('Worker からも同じ実装が呼べる', async () => {
  // 実装が二か所にあると必ず食い違う。入口だけ別で、中身は同じ。
  // Worker 側は既定寸法を添えて渡すだけで、判定そのものは持たない。
  const worker = await import('file://' + join(ROOT, 'worker/plan-check.mjs'));
  assert.equal(worker._internals, check._internals, '別の実装を持っている');
  const plan = planWith('主寝室', { type: 'bath', w: 1600, d: 750 });
  assert.deepEqual(worker.knowledgeWarnings(plan), check.knowledgeWarnings(plan),
    '同じ間取りで答えが違う');
});

test('既定寸法のままの設備を、寸法の読み違いと言わない', async () => {
  // **手順17は設備の寸法を「既定値のまま変えない」と命じている。**
  // 命じたとおりの値を叱ると、正しく読めた図面ほど必ず警告が出る。
  // 実測で、浴槽の既定 1600×1600 は知識表の湯船(1100〜1700 × 650〜900)から
  // 外れており、浴槽のある図面すべてでこの指摘が出ていた。
  const spec = await import('file://' + join(ROOT, 'worker/plan-item-spec.mjs'));
  const worker = await import('file://' + join(ROOT, 'worker/plan-check.mjs'));
  for (const s of spec.ITEM_SPEC) {
    if (!check._internals.IMPORT_TO_KIND[s.type]) continue;
    const room = { bath: '浴室', toilet: 'トイレ', sink: '洗面所', kitchen: 'キッチン' }[s.type];
    const w = worker.knowledgeWarnings(planWith(room, { type: s.type, w: s.w, d: s.d }));
    assert.deepEqual(w, [], `${s.type} の既定 ${s.w}×${s.d} に指摘が出ている`);
  }
});

test('既定から外れた寸法は、Worker から呼んでも指摘する', async () => {
  // 既定を見逃す代わりに、既定から外れたものを見落としてはいけない。
  const worker = await import('file://' + join(ROOT, 'worker/plan-check.mjs'));
  const w = worker.knowledgeWarnings(planWith('トイレ', { type: 'toilet', w: 3000, d: 3000 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /3000×3000/);
});

test('実物の図面の室名から、用途が決まる', () => {
  // **提供された3つの実物の図面(平屋・2階建て・3階建て)で確かめたもの。**
  // 室名46件のうち16件が決まらず、そのうち名前だけで決まるものを足した。
  const RP = require(join(ROOT, 'assets/js/room-program.js'));
  const cases = [
    ['収納', 'storage'], ['床上げ収納', 'storage'], ['ハーフ収納', 'storage'],
    ['FCL', 'wic'], ['ファミリークローゼット', 'wic'], ['SCL', 'storage'],
    ['Living Dinning Kitchen', 'ldk'], ['Living Dining Kitchen', 'ldk'],
  ];
  for (const [name, want] of cases) {
    assert.equal(RP.typeFromName(name), want, `${name} が ${want} にならない`);
  }
  // **決まらないものは足さない。** 「趣味部屋」が書斎か工房かは名前で決まらない。
  for (const name of ['趣味部屋', 'スキップ', 'ニッチ', 'KB置き場', '洋室']) {
    assert.equal(RP.typeFromName(name), null, `${name} を決め打ちしている`);
  }
});

// ── 図面の印を解釈する ──────────────────────────────────────────
//
// 読み取りは印の位置・大きさ・添え字だけを返し、**種類は当てさせない**。
// 何であるかはここで、置かれ方の知識を使って当てる。
let NAMES = null;
test.before(async () => {
  const v = await import('file://' + join(ROOT, 'tools/catalogue-vocab.mjs'));
  NAMES = {};
  for (const [k, d] of Object.entries(v.KINDS)) NAMES[k] = { ja: d.ja, search: d.search };
});

/** LDK ひと部屋と、北面の窓ひとつ。 */
function ldkWithWindow() {
  return {
    rooms: [{ id: 'r1', floor: 1, n: 'LDK', x: 0, y: 0, w: 5000, d: 4000 }],
    items: [{ floor: 1, type: 'window', x: 1000, y: -75, w: 1690, d: 150 }],
  };
}

test('窓のそばの薄い箱は、カーテンと読む', () => {
  const r = check.interpretMarks(ldkWithWindow(),
    [{ floor: 1, x: 1845, y: 200, w: 1990, d: 150, looks: '細長い薄い矩形' }],
    { names: NAMES });
  assert.equal(r.length, 1);
  assert.equal(r[0].candidates[0].kind, 'curtain');
  assert.equal(r[0].room, 'LDK');
});

test('窓から離れた同じような箱は、カーテンと読まない', () => {
  const r = check.interpretMarks(ldkWithWindow(),
    [{ floor: 1, x: 4000, y: 3500, w: 1240, d: 300 }], { names: NAMES });
  assert.equal(r[0].candidates[0].kind, 'tv');
});

test('添え字があれば、それに従う', () => {
  const r = check.interpretMarks(ldkWithWindow(),
    [{ floor: 1, x: 4000, y: 3500, w: 1240, d: 300, label: 'TV' }], { names: NAMES });
  assert.equal(r[0].candidates[0].kind, 'tv');
  assert.ok(r[0].candidates[0].why.some((w) => /書かれている/.test(w)));
});

test('位置が読めない印は捨てる', () => {
  const r = check.interpretMarks(ldkWithWindow(),
    [{ floor: 1, x: null, y: 1, w: 1, d: 1 }], { names: NAMES });
  assert.deepEqual(r, []);
});

test('印が無ければ何も返さない', () => {
  assert.deepEqual(check.interpretMarks(ldkWithWindow(), [], { names: NAMES }), []);
  assert.deepEqual(check.interpretMarks(ldkWithWindow(), null, {}), []);
});

test('読み取りが返す印の形が、解釈できる形になっている', async () => {
  // **スキーマと解釈側がずれると、印が黙って捨てられる。**
  const prompt = await import('file://' + join(ROOT, 'worker/plan-prompt.mjs'));
  const decoded = prompt.decodeCompactPlan({
    floors: [{
      floor: 1, width: 5000, depth: 4000, rooms: [], items: [],
      marks: [{ x: 1845, y: 200, w: 1990, d: 150, label: '', looks: '細長い薄い矩形' }],
    }],
  });
  assert.equal(decoded.marks.length, 1);
  const r = check.interpretMarks(ldkWithWindow(), decoded.marks, { names: NAMES });
  assert.equal(r.length, 1, '読み取りの形をそのまま解釈できていない');
});
