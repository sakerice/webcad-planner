// 見直し用の絵が、読み取れる種類を取りこぼさないことを確かめる。
//
// 絵はモデルが自分の答えを見比べる相手なので、描かれていない物は
// **無かったことになる**。種類を1つ足したのに絵の側を直し忘れると、
// その種類だけ見直しの対象から黙って抜け落ちる。
const assert = require('assert');
const path = require('path');

const Draw = require(path.join(__dirname, '..', '..', 'assets', 'js', 'plan-review-draw.js'));

(async () => {
  const spec = await import(
    'file://' + path.join(__dirname, '..', '..', 'worker', 'plan-item-spec.mjs')
  );
  const allowed = spec.ALLOWED_ITEM_TYPES.slice().sort();

  const named = Object.keys(Draw.JA).sort();
  assert.deepStrictEqual(named, allowed,
    '絵の日本語名が、AIに出させる種類と一致していない');

  const sized = Object.keys(Draw.SIZES).sort();
  assert.deepStrictEqual(sized, allowed,
    '絵の既定寸法が、AIに出させる種類と一致していない');

  // 既定寸法そのものも合わせる。ここがずれると、d を省いて返ってきた物を
  // アプリとは違う大きさで描いて見せることになる。
  for (const type of allowed) {
    const s = spec.specFor(type);
    assert.strictEqual(Draw.SIZES[type].w, s.w, `${type} の既定の幅が違う`);
    assert.strictEqual(Draw.SIZES[type].d, s.d, `${type} の既定の奥行きが違う`);
  }

  // canvas の無いところでは描かない（画面側だけの機能なので、落ちずに諦める）。
  assert.strictEqual(Draw.drawPage({ floors: [{ floor: 1, width: 7280, depth: 4095, rooms: [] }] }), null,
    'document が無いときは null を返すこと');

  console.log('plan-review-draw: ok');
})().catch((e) => { console.error(e); process.exit(1); });
