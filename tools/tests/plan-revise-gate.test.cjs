// 見直しを払うかどうかの門（worker/plan-gate.mjs）。
//
// 見ているのは3つ:
//   1. 判断の材料が、モデルの答えからこちらで計算できていること
//   2. 境目が**実際に効く**こと（どんな答えでも同じ側に倒れる死んだ門でないこと）
//   3. 判断が得られないときに、**門が無かった頃と同じ動き**に戻ること
//
// 3つ目がいちばん大事である。Jev が落ちていたら見直しを省く、という倒れ方を
// すると、読み取りの質が黙って下がる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const rect = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const items = (pairs) => pairs.flatMap(([type, n]) => Array.from({ length: n }, () => ({ type, x: 0, y: 0, w: 900 })));

// 素直な1階。実測で consistent 0.76 / completeness 2.68 が返った形。
const CLEAN_1F = {
  floors: [{
    floor: 1, width: 9100, depth: 9100,
    dims: {
      top: { total: 9100, parts: [1820, 3640, 3640] },
      left: { total: 9100, parts: [3640, 5460] },
    },
    rooms: [
      { name: 'LDK', parts: [rect(0, 3640, 5460, 9100), rect(5460, 5460, 9100, 9100)] },
      { name: '玄関', parts: [rect(0, 0, 1820, 1820)] },
      { name: '洗面脱衣室', parts: [rect(3640, 0, 5460, 1820)] },
      { name: '浴室', parts: [rect(5460, 0, 7280, 1820)] },
      { name: 'トイレ', parts: [rect(7280, 0, 8190, 1820)] },
    ],
    items: items([['door-front', 1], ['door-swing', 3], ['window', 6], ['window-door', 2],
      ['stair', 1], ['bath', 1], ['toilet', 1], ['sink', 1], ['kitchen', 1]]),
  }],
  notes: [],
};

// 浴室・トイレと名のつく部屋が在るのに、浴槽と便器が無い読み取り。
const NO_FIXTURES = {
  floors: [{
    floor: 1, width: 9100, depth: 9100,
    dims: { left: { total: 9100, parts: [3640, 3640] } },
    rooms: [
      { name: 'LDK', parts: [rect(0, 3640, 5460, 9100)] },
      { name: '浴室', parts: [rect(5460, 0, 7280, 1820)] },
      { name: 'トイレ', parts: [rect(7280, 0, 8190, 1820)] },
    ],
    items: items([['door-swing', 2], ['window', 3], ['kitchen', 1]]),
  }],
  notes: ['トイレの位置が読み取れませんでした'],
};

test('モデルの答えから、判断の材料をこちらで計算する', async () => {
  const { pageFacts } = await mod('worker/plan-gate.mjs');
  const f = pageFacts(CLEAN_1F, 0).floors[0];

  // 寸法線の検算。総寸法と内訳の和は、聞くものではなく計算するもの。
  assert.deepEqual(f.dimension_check.top, { total: 9100, sum_of_parts: 9100 });
  assert.deepEqual(f.dimension_check.left, { total: 9100, sum_of_parts: 9100 });
  // 部屋が建物の輪郭をどれだけ埋めているか
  assert.ok(f.room_area_sum_ratio_to_footprint > 0.5, '部屋の面積比が出ていない');
  assert.equal(f.has_entrance_door, true);
  assert.equal(f.has_stair, true);
  assert.deepEqual(f.fixtures_expected_but_absent, []);
  // 1つの部屋が複数の長方形に分かれていることも材料になる
  assert.equal(f.rooms.find((r) => r.name === 'LDK').rects, 2);
});

test('室名に対して在るべき物が無いことは、質問ではなく事実として数える', async () => {
  const { pageFacts } = await mod('worker/plan-gate.mjs');
  const f = pageFacts(NO_FIXTURES, 0).floors[0];
  const missing = f.fixtures_expected_but_absent.map((m) => m.expected_item).sort();
  assert.deepEqual(missing, ['bath', 'toilet'], '浴室の浴槽・トイレの便器の欠けを数えていない');
  // 内訳の和(7280)が総寸法(9100)と食い違っていることも、材料に残る
  assert.equal(f.dimension_check.left.sum_of_parts, 7280);
});

test('境目は実際に効く（どちらにも倒れる）', async () => {
  const { reviseDecision } = await mod('worker/plan-gate.mjs');
  const answer = (c, s) => ({ consistent: { noul: c }, completeness: { score: s } });

  // 実測値をそのまま入れる。素直な1階だけが通る。
  assert.equal(reviseDecision(answer(0.76, 2.68)).revise, false, '素直な1階で見直しを省けていない');
  assert.equal(reviseDecision(answer(0.57, 1.74)).revise, true, '迷いの出た階で見直しを省いている');
  assert.equal(reviseDecision(answer(0.28, 1.02)).revise, true, '壊れた読み取りで見直しを省いている');

  // 片方だけ良くても通さない
  assert.equal(reviseDecision(answer(0.95, 1.0)).revise, true);
  assert.equal(reviseDecision(answer(0.1, 4.0)).revise, true);
});

test('判断が無ければ、門が無かった頃と同じ動きに戻る', async () => {
  const { reviseDecision, reviseAdvice } = await mod('worker/plan-gate.mjs');

  assert.equal(reviseDecision(null).revise, true, '答えが無いのに見直しを省いている');
  assert.equal(reviseDecision({ consistent: { noul: 0.9 } }).revise, true, '答えが欠けているのに省いている');

  // env.AI が無い環境（手元・検査）でも落ちず、全ページ「見直す」になる
  const none = await reviseAdvice([CLEAN_1F], {});
  assert.equal(none.skipAll, false);
  assert.equal(none.pages[0].revise, true);

  // Jev が落ちている / 時間切れでも同じ
  const broken = await reviseAdvice([CLEAN_1F], {}, { aiRun: async () => { throw new Error('down'); } });
  assert.equal(broken.skipAll, false);
  assert.equal(broken.pages[0].revise, true);
});

test('全ページが素直なときだけ、見直しを省く', async () => {
  const { reviseAdvice } = await mod('worker/plan-gate.mjs');
  const reply = (c, s) => async () => ({ answers: { consistent: { noul: c }, completeness: { score: s } } });

  const clean = await reviseAdvice([CLEAN_1F, CLEAN_1F], {}, { aiRun: reply(0.8, 3.0) });
  assert.equal(clean.skipAll, true, '素直なページだけなのに見直しを払っている');

  // 2ページ目だけ怪しい場合。**いまは全部払う**（ページ単位の出し分けは
  // 受付番号の経路をまたぐので、まだ入れていない）。
  let n = 0;
  const mixed = await reviseAdvice([CLEAN_1F, NO_FIXTURES], {}, {
    aiRun: async () => (++n === 1 ? { answers: { consistent: { noul: 0.8 }, completeness: { score: 3.0 } } }
      : { answers: { consistent: { noul: 0.2 }, completeness: { score: 0.5 } } }),
  });
  assert.equal(mixed.skipAll, false);
  assert.equal(mixed.pages[0].revise, false);
  assert.equal(mixed.pages[1].revise, true);
});

test('AI_REVISE_GATE で門を止められる', async () => {
  const { reviseAdvice } = await mod('worker/plan-gate.mjs');
  const aiRun = async () => ({ answers: { consistent: { noul: 0.9 }, completeness: { score: 3.5 } } });

  const off = await reviseAdvice([CLEAN_1F], { AI_REVISE_GATE: 'off' }, { aiRun });
  assert.equal(off.skipAll, false, 'off なのに見直しを省いている');

  // shadow は判断だけして、払うほうは従来どおり
  const shadow = await reviseAdvice([CLEAN_1F], { AI_REVISE_GATE: 'shadow' }, { aiRun });
  assert.equal(shadow.skipAll, false);
  assert.equal(shadow.pages[0].revise, true);
  assert.equal(shadow.pages[0].shadow, true, '省けたはずだったことを記録していない');
});

test('提示していない選択肢は、実行に使わない', async () => {
  const { jevAsk } = await mod('worker/jev.mjs');
  const questions = {
    pick: { type: 'choice', instructions: 'x', criteria: { a: 'A', b: 'B' } },
  };
  const good = await jevAsk({}, { state: { x: 1 }, questions }, { aiRun: async () => ({ answers: { pick: { choice: 'a' } } }) });
  assert.equal(good.pick.choice, 'a');

  const bad = await jevAsk({}, { state: { x: 1 }, questions }, { aiRun: async () => ({ answers: { pick: { choice: 'c' } } }) });
  assert.equal(bad, null, '提示していない選択肢を通している');

  // 確率が [0,1] の外、score が数値でない、といったものも通さない
  const noul = { q: { type: 'noul', instructions: 'x' } };
  assert.equal(await jevAsk({}, { state: {}, questions: noul }, { aiRun: async () => ({ answers: { q: { noul: 1.4 } } }) }), null);

  // Cloudflare の二重の封筒も開ける
  const wrapped = await jevAsk({}, { state: {}, questions: noul },
    { aiRun: async () => ({ result: { result: { answers: { q: { noul: 0.4 } } } } }) });
  assert.equal(wrapped.q.noul, 0.4);
});

test('次の一手は、確信が薄ければ黙る', async () => {
  const { nextStep, failureFacts } = await mod('worker/plan-gate.mjs');
  const facts = failureFacts({ error: 'ai_bad_response', pageCount: 3, imageBytes: [1000, 2000], mimeTypes: ['image/png'] });
  assert.equal(facts.pages_sent, 3);

  const sure = await nextStep(facts, {}, { aiRun: async () => ({ answers: { next_step: { choice: 'single_page', confidence: 0.7 } } }) });
  assert.equal(sure.step, 'single_page');

  const thin = await nextStep(facts, {}, { aiRun: async () => ({ answers: { next_step: { choice: 'single_page', confidence: 0.1 } } }) });
  assert.equal(thin, null, '確信の薄い助言を出している');

  const dunno = await nextStep(facts, {}, { aiRun: async () => ({ answers: { next_step: { choice: 'unknown', confidence: 0.9 } } }) });
  assert.equal(dunno, null, 'unknown を助言として出している');
});

test('次の一手の選択肢と、画面の文面が1対1で対応する', async () => {
  const { NEXT_STEP_QUESTION } = await mod('worker/plan-gate.mjs');
  const src = readFileSync(join(ROOT, 'assets', 'js', 'plan-import.js'), 'utf8');
  const block = /var NEXT_STEP = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(block, '画面側に次の一手の文面が無い');
  const shown = [...block[1].matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]).sort();
  // unknown は「分からない」なので、文面を持たない（出さない）。
  const asked = Object.keys(NEXT_STEP_QUESTION.next_step.criteria).filter((k) => k !== 'unknown').sort();
  assert.deepEqual(shown, asked, '選択肢と文面が食い違っている（文面の無い答えは画面に出ない）');
});
