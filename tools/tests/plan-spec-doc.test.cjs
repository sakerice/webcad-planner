// house-planner mobile の取り込みデータ仕様。
//
// なぜ在るのか
// ------------
// AIに渡す仕様書。**仕様だけを持つ**ことが要件で、注意喚起・読み取りのコツ・
// 解釈の方針が混ざると、仕様として参照できなくなる。混ざりはじめを検査で止める。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const spec = async () => (await mod('worker/plan-spec.mjs')).planSpec();

test('単位と座標系が書かれている', async () => {
  const s = await spec();
  assert.match(s, /長さ: ミリメートル/);
  assert.match(s, /角度: 度/);
  assert.match(s, /x は右が正、y は下が正/);
  assert.match(s, /原点 \(0,0\) は建物の左上の外角/);
  assert.match(s, /全階で同一の座標系/);
});

test('出力する項目がすべて説明されている', async () => {
  const s = await spec();
  for (const f of ['floors', 'notes', 'floor', 'width', 'depth', 'dims',
                   'rooms', 'items', 'total', 'parts', 'name',
                   'x0', 'y0', 'x1', 'y1', 'type', 'rot']) {
    assert.ok(s.includes(f), `${f} が仕様に無い`);
  }
});

test('使える種類と既定寸法は、アプリの定数から作る', async () => {
  const s = await spec();
  const { ITEM_SPEC } = await mod('worker/plan-item-spec.mjs');
  for (const it of ITEM_SPEC) {
    assert.ok(s.includes(it.type), `${it.type} が仕様に無い`);
    assert.ok(s.includes(`${it.w}×${it.d}mm`), `${it.type} の既定寸法が仕様に無い`);
  }
});

test('アプリが生成する要素を、生成元とともに書いている', async () => {
  const s = await spec();
  // 壁・基礎・屋根がデータに無い理由は、仕様として書かれていないと分からない。
  for (const f of ['壁', '基礎', '屋根']) assert.ok(s.includes(f), `${f} の扱いが仕様に無い`);
  assert.match(s, /このデータに含めない/);
});

test('注意喚起や解釈の方針が混ざっていない', async () => {
  const s = await spec();
  for (const word of ['間違えやすい', '気をつけ', '注意', '〜しないこと',
                      '当てずっぽう', 'ありそう', '推測', '読み違え', '実測']) {
    assert.ok(!s.includes(word), `仕様に「${word}」が入っている。仕様以外は手順の側へ`);
  }
  // 手順を指す言葉も入れない
  assert.ok(!/手順/.test(s), '仕様に手順が混ざっている');
});
