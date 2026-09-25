// 数値欄の四則演算(assets/js/number-expr.js)の検査。
// 計算器そのものと、「読めない式は各欄に渡さない」前提になる null の返し方を押さえる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const NumberExpr = require(join(__dirname, '..', '..', 'assets', 'js', 'number-expr.js'));
const ev = NumberExpr.evaluate;

test('数字だけはそのまま読む', () => {
  assert.equal(ev('1230'), 1230);
  assert.equal(ev('-150'), -150);
  assert.equal(ev('2.5'), 2.5);
});

test('四則演算は掛け算・割り算を先に計算する', () => {
  assert.equal(ev('1230+20'), 1250);
  assert.equal(ev('2400-150+800'), 3050);
  assert.equal(ev('910*3'), 2730);
  assert.equal(ev('2730/3'), 910);
  assert.equal(ev('100+20*3'), 160);
  assert.equal(ev('(100+20)*3'), 360);
  assert.equal(ev('-(200-50)'), -150);
});

test('全角・空白・桁区切りのまま打っても読める', () => {
  assert.equal(ev('１２３０＋２０'), 1250);
  assert.equal(ev(' 2,400 - 150 '), 2250);
  assert.equal(ev('910×3'), 2730);
  assert.equal(ev('2730÷3'), 910);
  assert.equal(ev('（1+2）＊3'), 9);
});

test('小数の端数は落とす', () => {
  assert.equal(ev('0.1+0.2'), 0.3);
});

test('読めない式は null(欄に渡さない)', () => {
  for (const bad of ['', '1230+', '1+*2', '(1+2', '1/0', 'abc', '12a', 'alert(1)']) {
    assert.equal(ev(bad), null, JSON.stringify(bad) + ' を数値にしてしまった');
  }
});
