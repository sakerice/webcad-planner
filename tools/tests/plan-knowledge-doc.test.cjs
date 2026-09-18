// 日本の住宅の平面図を読むときの例。
//
// なぜ在るのか
// ------------
// モデルは日本の住宅図面の一般論をすでに知っている。網羅的な教科書を渡すと
// 長くなるだけで効かない。**実際に外した箇所を例で示す**のがこのファイルの
// 役目で、そこから逸れはじめたら落ちる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const kb = async () => (await mod('worker/plan-knowledge.mjs')).planKnowledge();

test('日本の住宅の寸法体系に沿った推定を認めている', async () => {
  const s = await kb();
  assert.match(s, /910mm を基準/);
  assert.match(s, /推定してよい/);
});

test('227.5 を捨てさせないための例がある', async () => {
  const s = await kb();
  // 実測: この例が無いとき、モデルは 227.5 を読んだうえで「無視しました」と
  // 申告して捨てた。入れれば合計が総寸法と一致するのに、外して不一致にした。
  assert.match(s, /227\.5/);
  assert.match(s, /1,137\.5/);
  assert.match(s, /一致する/);
});

test('壁と、壁でないものの例がある', async () => {
  const s = await kb();
  assert.match(s, /105〜150mm/, '壁の厚みが無い');
  for (const w of ['浴槽', '便器', '洗面台', 'ハンガーパイプ', '階段の段']) {
    assert.ok(s.includes(w), `壁でないものの例に ${w} が無い`);
  }
});

test('長方形でない部屋と、室名の無い部屋の例がある', async () => {
  const s = await kb();
  assert.match(s, /長方形2つで表す/);
  for (const n of ['浴室', '洗面所', 'トイレ', '階段室', '廊下', '玄関']) {
    assert.ok(s.includes(n), `室名の無い部屋の例に ${n} が無い`);
  }
});

test('建具の記号の例がある', async () => {
  const s = await kb();
  for (const d of ['開き戸', '引戸', '折戸', '窓', '玄関ドア']) {
    assert.ok(s.includes(d), `建具の例に ${d} が無い`);
  }
});

test('教科書にしない（例に絞る）', async () => {
  const s = await kb();
  assert.ok(s.length < 1500, '例が ' + s.length + ' 文字ある。網羅しはじめていないか');
});

test('送信時に、知識・仕様・手順を別々の部品として渡している', async () => {
  const { readFileSync } = require('node:fs');
  for (const f of ['worker/routes-ai.mjs', 'tools/probe_vertex.cjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /docs:\s*\[planKnowledge\(\),\s*planSpec\(\)\]/,
      `${f} が知識と仕様を渡していない`);
  }
});
