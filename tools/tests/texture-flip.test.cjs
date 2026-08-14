// 「左右反転」トグル(textureFlipX/Y)の反転式。
//
// 反転とは、面の左右を入れ替えて読むこと。つまり反転後のテクスチャ座標は
//   f(u) = 素の状態での (1-u) の値
// でなければならない。素の状態が offset=o / repeat=r なら f(u) = (o+r) + (-r)*u。
//
// 以前は offset に 1-o を入れていた。o=(1-r)/2 のとき、つまり中央の切り出しのときだけ
// o+r と一致するので、既定の全面表示や中央トリミングでは正しく見えていた。
// 中央から寄せた切り出し(sX)やタイリング(repeat≠1)では、使う範囲そのものがずれていた。
//
// 定義そのものを検査する: 反転後の任意の u が、素の状態の 1-u と同じ位置を指すか。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
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
  throw new Error(name + ' の本体が閉じていない');
}

function V2(x, y) { this.x = x; this.y = y; }
V2.prototype.set = function (x, y) { this.x = x; this.y = y; return this; };

function Tex(repX, repY, offX, offY) {
  this.repeat = new V2(repX == null ? 1 : repX, repY == null ? 1 : repY);
  this.offset = new V2(offX == null ? 0 : offX, offY == null ? 0 : offY);
  this.image = { width: 512, height: 512 };
  this.needsUpdate = false;
}

function load() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext([
    topLevelFunction('textureImageSize'),
    topLevelFunction('textureImageAspect'),
    topLevelFunction('setTextureRepeatNoDistort'),
    topLevelFunction('applyTextureFlip')
  ].join('\n'), sandbox);
  return sandbox;
}

const R = (v) => Number(v.toFixed(9));
// 面の位置 u が最終的に指すテクスチャ座標
const texU = (t, u) => t.offset.x + t.repeat.x * u;
const texV = (t, v) => t.offset.y + t.repeat.y * v;

test('最重要: 反転後の u は、素の状態の 1-u と同じ位置を指す', () => {
  const s = load();
  const cases = [
    { name: '既定(全面)', r: 1, o: 0 },
    { name: '中央の切り出し', r: 0.5, o: 0.25 },
    { name: '中央から寄せた切り出し', r: 0.5, o: 0.1 },
    { name: '端に寄せた切り出し', r: 0.4, o: 0.55 },
    { name: 'タイリング', r: 3.2, o: 0 }
  ];
  cases.forEach(function (c) {
    const plain = new Tex(c.r, c.r, c.o, c.o);
    const flipped = new Tex(c.r, c.r, c.o, c.o);
    s.applyTextureFlip(flipped, { textureFlipX: true, textureFlipY: true });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (u) {
      assert.equal(R(texU(flipped, u)), R(texU(plain, 1 - u)), c.name + ': u=' + u + ' が鏡像になっていない');
      assert.equal(R(texV(flipped, u)), R(texV(plain, 1 - u)), c.name + ': v=' + u + ' が鏡像になっていない');
    });
  });
});

test('既定のテクスチャ(全面)の反転は今までと1ビットも変わらない', () => {
  const s = load();
  const t = new Tex(1, 1, 0, 0);
  s.applyTextureFlip(t, { textureFlipX: true, textureFlipY: true });
  assert.equal(t.repeat.x, -1);
  assert.equal(t.offset.x, 1);
  assert.equal(t.repeat.y, -1);
  assert.equal(t.offset.y, 1);
});

test('反転しない軸には触らない', () => {
  const s = load();
  const t = new Tex(0.5, 0.5, 0.1, 0.1);
  s.applyTextureFlip(t, { textureFlipX: true, textureFlipY: false });
  assert.equal(R(t.repeat.y), 0.5, 'Yを指定していないのにVが動いた');
  assert.equal(R(t.offset.y), 0.1);
  assert.equal(R(t.repeat.x), -0.5);
  assert.equal(R(t.offset.x), 0.6);
});

test('source が無い/反転オフなら素通し', () => {
  const s = load();
  const t = new Tex(0.5, 0.5, 0.1, 0.2);
  s.applyTextureFlip(t, null);
  assert.equal(R(t.repeat.x), 0.5);
  assert.equal(R(t.offset.x), 0.1);
  assert.equal(R(t.offset.y), 0.2);
});

test('同じテクスチャに二度掛けても結果が変わらない', () => {
  const s = load();
  const src = { textureFlipX: true, textureFlipY: true };
  const once = new Tex(0.5, 0.5, 0.1, 0.1);
  s.applyTextureFlip(once, src);
  const twice = new Tex(0.5, 0.5, 0.1, 0.1);
  s.applyTextureFlip(twice, src);
  s.applyTextureFlip(twice, src);
  assert.equal(R(twice.repeat.x), R(once.repeat.x), '掛けるたびに反転が積み重なっている');
  assert.equal(R(twice.offset.x), R(once.offset.x));
  assert.equal(R(twice.repeat.y), R(once.repeat.y));
  assert.equal(R(twice.offset.y), R(once.offset.y));
});

test('反転を解除すれば素の状態に戻る', () => {
  const s = load();
  const t = new Tex(0.5, 0.5, 0.1, 0.1);
  s.applyTextureFlip(t, { textureFlipX: true, textureFlipY: true });
  s.applyTextureFlip(t, { textureFlipX: false, textureFlipY: false });
  assert.equal(R(t.repeat.x), 0.5);
  assert.equal(R(t.offset.x), 0.1);
  assert.equal(R(t.repeat.y), 0.5);
  assert.equal(R(t.offset.y), 0.1);
});

// バルコニーフェンスは、壁用に作った(反転済みの)マテリアルへ実寸で密度を掛け直す。
// 密度指定が反転の痕跡を残すと、掛け直すたびに柄の位相がずれていく。
test('密度の指定(setTextureRepeatNoDistort)は反転前の素の状態を作る', () => {
  const s = load();
  const t = new Tex(1, 1, 0, 0);
  s.applyTextureFlip(t, { textureFlipX: true, textureFlipY: true });
  s.setTextureRepeatNoDistort(t, 3.0, 1.1, 0.45);
  assert.equal(t.offset.x, 0, '反転で入れた offset が残っている');
  assert.equal(t.offset.y, 0);
  assert.ok(t.repeat.x > 0 && t.repeat.y > 0, '密度は正の値で入る');
});

test('密度を掛け直してから反転しても、鏡像の関係は保たれる', () => {
  const s = load();
  const flipped = new Tex(1, 1, 0, 0);
  s.applyTextureFlip(flipped, { textureFlipX: true });      // 壁用マテリアルの時点で反転済み
  s.setTextureRepeatNoDistort(flipped, 3.0, 1.1, 0.45);     // フェンスの実寸で density を再計算
  s.applyTextureFlip(flipped, { textureFlipX: true });

  const plain = new Tex(1, 1, 0, 0);
  s.setTextureRepeatNoDistort(plain, 3.0, 1.1, 0.45);

  [0, 0.5, 1].forEach(function (u) {
    assert.equal(R(texU(flipped, u)), R(texU(plain, 1 - u)), 'u=' + u + ': フェンスの柄が鏡像からずれている');
  });
});
