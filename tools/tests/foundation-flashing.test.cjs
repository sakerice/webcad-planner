// 基礎水切り(基礎の天端を回る金物)。
//
// 直した不良: 基礎を置くと上端に黒い帯が巻かれ、基礎の色を変えても帯だけ
// 変わらなかった。色が 0x4a4d52 の決め打ちで、しかも壁の有無に関わらず
// 無条件に回していたため。水切りは外装材の下端を受ける金物なので、
// 基礎の上に壁が立っていないなら存在しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function topLevelFunction(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(name + ' の本体が閉じていない');
}

// THREE.Color の最小の代役。掛け算で暗くなることだけ見る。
class FakeColor {
  constructor(v) {
    if (typeof v === 'number') { this.r = ((v >> 16) & 255) / 255; this.g = ((v >> 8) & 255) / 255; this.b = (v & 255) / 255; }
    else {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(v));
      if (!m) throw new Error('bad color');
      this.r = parseInt(m[1], 16) / 255; this.g = parseInt(m[2], 16) / 255; this.b = parseInt(m[3], 16) / 255;
    }
  }
  multiplyScalar(k) { this.r *= k; this.g *= k; this.b *= k; return this; }
}

function ctxFor(data) {
  const ctx = vm.createContext({ DATA: data, THREE: { Color: FakeColor }, Number, Math, isFinite });
  vm.runInContext([
    topLevelFunction('foundationCarriesWalls'),
    topLevelFunction('foundationFlashingColor')
  ].join('\n'), ctx);
  return ctx;
}

const FND = { type: 'foundation', x: -4000, y: -3000, w: 8000, d: 6000 };

test('基礎の上に壁が無ければ水切りは付かない（置いただけの基礎に帯を巻かない）', () => {
  const ctx = ctxFor({ walls: [] });
  assert.equal(ctx.foundationCarriesWalls(FND), false);
});

test('基礎の上に1階の壁が立っていれば付く', () => {
  const ctx = ctxFor({ walls: [{ floor: 1, x1: -3500, y1: -2500, x2: 3500, y2: -2500 }] });
  assert.equal(ctx.foundationCarriesWalls(FND), true);
});

test('基礎の外の壁、上階の壁では付かない', () => {
  assert.equal(ctxFor({ walls: [{ floor: 1, x1: 9000, y1: 9000, x2: 12000, y2: 9000 }] })
    .foundationCarriesWalls(FND), false);
  assert.equal(ctxFor({ walls: [{ floor: 2, x1: -3500, y1: -2500, x2: 3500, y2: -2500 }] })
    .foundationCarriesWalls(FND), false);
});

test('水切りの色は基礎の色に従う（決め打ちの黒ではない）', () => {
  const ctx = ctxFor({ walls: [] });
  const def = ctx.foundationFlashingColor({ type: 'foundation' });
  assert.ok(def.r > 0.3 && Math.abs(def.r - def.b) < 0.1, '指定が無ければ既定の金物色（灰）');
  const red = ctx.foundationFlashingColor({ type: 'foundation', colorCustom: true, color: '#cc3333' });
  assert.ok(red.r > red.g && red.r > red.b, '赤い基礎なら赤系');
  assert.ok(red.r < 0xcc / 255, '基礎そのものより暗い（金物なので落とす）');
  const green = ctx.foundationFlashingColor({ type: 'foundation', colorCustom: true, color: '#22cc22' });
  assert.ok(green.g > green.r && green.g > green.b, '緑の基礎なら緑系');
});

test('壁の有無・切り替え・色が build3DFoundation の条件に入っている', () => {
  const body = topLevelFunction('build3DFoundation');
  assert.match(body, /it\.foundationFlashing!==false/, '切り替えで消せる');
  assert.match(body, /foundationCarriesWalls\(it\)/, '壁が無ければ出さない');
  assert.match(body, /color:foundationFlashingColor\(it\)/, '色が決め打ちのままになっている');
  assert.doesNotMatch(body, /color:0x4a4d52/, '決め打ちの黒が残っている');
  // 日陰で空を映して真っ黒に見えていたので金属感を落とす
  assert.match(body, /metalness:0\.15/);
});

test('プロパティ欄から水切りを切れる（何の板か名前も出す）', () => {
  // index.html の中では文字列リテラルなのでクォートがエスケープされている
  assert.match(html, /updateSelectedProp\(\\?'foundationFlashing\\?',this\.checked\)/);
  assert.match(html, /水切りを付ける/);
  assert.match(html, /水切りは外壁の下端を受ける金物/);
});
