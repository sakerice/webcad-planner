// 外装面の端を、交わる壁の外面へ寄せる(描画だけ)。
// 利用者のプラン41: 外と内の判定は 80mm 刻みなので、3階の入隅で W108 の外装面が
// W106 の外面の 5mm 手前で止まり、そこに内装(白)の面が縦線になって見えた。
// 面ごとの色設定は a/b をキーに保存されている(exteriorFaceKey)ので、a/b は動かさない。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

function sliceFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が無い');
  const start = at + 1;
  let i = html.indexOf('{', start), depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' が閉じていない');
}
// プラン41 の3階: W108(x=3220, y 400→3330) と、それに突き当たる W106(y=940)
const w108 = { id: 108, floor: 3, thick: 120, x1: 3220, y1: 400, x2: 3220, y2: 3330 };
const w106 = { id: 106, floor: 3, thick: 120, x1: 3220, y1: 940, x2: -40, y2: 940 };
function ctx() {
  const c = vm.createContext({ DATA: { walls: [w108, w106] }, U: 0.001 });
  ['wallCrossingFacePositionsM', 'snapExteriorSpanDrawEnds', 'interiorFaceDrawRange']
    .forEach((n) => vm.runInContext(sliceFunction(n), c));
  return c;
}

test('途中で終わる外装面は、交わる壁の外面まで描く。キーの a/b は動かさない', () => {
  const c = ctx();
  const spans = [{ a: 0, b: 0.475, sign: 1 }];          // 80mm 刻みで止まった端
  c.snapExteriorSpanDrawEnds(w108, spans);
  assert.equal(spans[0].a, 0);
  assert.equal(spans[0].b, 0.475, 'キー(a/b)は保存済みの設定と同じまま');
  assert.equal(spans[0].da, 0);
  assert.ok(Math.abs(spans[0].db - 0.48) < 1e-9, 'W106 の外面(y=880)まで ' + spans[0].db);
});

test('外装面の端に接する内装面は、同じだけ縮める(重なり・すき間を作らない)', () => {
  const c = ctx();
  const spans = c.snapExteriorSpanDrawEnds(w108, [{ a: 0, b: 0.475, sign: 1 }]);
  const r = c.interiorFaceDrawRange({ a: 0.475, b: 0.54, sign: 1 }, spans);
  assert.ok(Math.abs(r.a - 0.48) < 1e-9, '内装面は外装面の終わりから ' + r.a);
  assert.equal(r.b, 0.54);
  // 反対側の面は触らない
  const o = c.interiorFaceDrawRange({ a: 0.475, b: 0.54, sign: -1 }, spans);
  assert.equal(o.a, 0.475);
});

test('交わる壁の面が1刻みより遠ければ寄せない(壁の端も寄せない)', () => {
  const c = ctx();
  const spans = c.snapExteriorSpanDrawEnds(w108, [{ a: 0, b: 1.5, sign: 1 }]);
  assert.equal(spans[0].db, 1.5);
  const whole = c.snapExteriorSpanDrawEnds(w108, [{ a: 0, b: 2.93, sign: 1 }]);
  assert.equal(whole[0].db, 2.93);
});
