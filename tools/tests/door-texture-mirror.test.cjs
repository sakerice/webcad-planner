// 扉テクスチャの表裏。
//
// BoxGeometry の既定UVは6面それぞれを「その面の正面から見て正立」させる。だから同じ
// テクスチャを1枚のマテリアルで貼ると、表でも裏でも画像は同じ向きに読める = 世界座標では
// 左右が入れ替わる。実物の扉は1枚の板なので、表で戸先(ノブ側)に描かれた取手は、裏から
// 見ても同じ物理的な辺になければならない。つまり裏面の画像は左右反転していなければならない。
// 反転させないと、玄関ドアのテクスチャを貼ったとき裏側だけノブが吊元(丁番)側に現れる。
//
// grep ではなく、実際に index.html の関数を動かして「同じ世界座標のX位置が、表面と裏面で
// 同じテクスチャ座標を指すか」を測る。
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

function Tex(repX, offX, repY, offY) {
  this.repeat = new V2(repX == null ? 1 : repX, repY == null ? 1 : repY);
  this.offset = new V2(offX == null ? 0 : offX, offY == null ? 0 : offY);
  this.image = { width: 512, height: 512 };
  this.needsUpdate = false;
}
Tex.prototype.clone = function () {
  const t = new Tex(this.repeat.x, this.offset.x, this.repeat.y, this.offset.y);
  t.image = this.image;
  return t;
};

function Mat(map) { this.map = map || null; this.color = 0xffffff; }
Mat.prototype.clone = function () { return new Mat(this.map); };

function loadHelpers() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    topLevelFunction('mirrorMaterialTextureX') + '\n' + topLevelFunction('doorLeafFaceMaterials'),
    sandbox
  );
  return sandbox;
}

// BoxGeometry の既定UV。幅 w のパネルのローカルX位置 x が、その面の u 値いくつになるか。
// +Z面: x=-w/2 で u=0 / x=+w/2 で u=1。-Z面はその逆(面の正面から見て正立するため)。
function uOnFace(faceIndex, x, w) {
  if (faceIndex === 4) return (x + w / 2) / w;   // +Z
  if (faceIndex === 5) return (w / 2 - x) / w;   // -Z
  throw new Error('表裏以外の面は見ない');
}
// マテリアルのテクスチャ変換を通した最終的なテクスチャ座標。
function texUAt(mat, faceIndex, x, w) {
  return mat.map.offset.x + mat.map.repeat.x * uOnFace(faceIndex, x, w);
}

test('最重要: テクスチャを貼った扉は、同じ世界座標の辺が表裏で同じ画像位置を指す(ノブが動かない)', () => {
  const s = loadHelpers();
  const W = 0.8;
  [1, -1].forEach(function (frontSign) {
    const mats = s.doorLeafFaceMaterials(new Mat(new Tex()), frontSign);
    assert.ok(Array.isArray(mats), 'テクスチャがある扉は面ごとのマテリアル配列になる');
    // 戸先側(ローカル +X 端)を表面と裏面それぞれから見る
    const front = texUAt(mats[4], 4, W / 2, W);
    const back = texUAt(mats[5], 5, W / 2, W);
    assert.equal(front.toFixed(6), back.toFixed(6),
      'frontSign=' + frontSign + ': 同じ辺なのに表裏で画像の別の場所が出ている');
    // 吊元側(ローカル -X 端)も同様
    assert.equal(texUAt(mats[4], 4, -W / 2, W).toFixed(6), texUAt(mats[5], 5, -W / 2, W).toFixed(6),
      'frontSign=' + frontSign + ': 吊元側が表裏でずれている');
  });
});

test('テクスチャどおりに読める面は frontSign(室外側)。その裏だけが反転する', () => {
  const s = loadHelpers();
  const base = new Mat(new Tex());
  const outPlus = s.doorLeafFaceMaterials(base, 1);
  assert.equal(outPlus[4].map.repeat.x, 1, '+Z が室外なら +Z 面は素のまま');
  assert.equal(outPlus[5].map.repeat.x, -1, '+Z が室外なら -Z 面が反転');

  const outMinus = s.doorLeafFaceMaterials(base, -1);
  assert.equal(outMinus[5].map.repeat.x, 1, '-Z が室外なら -Z 面は素のまま');
  assert.equal(outMinus[4].map.repeat.x, -1, '-Z が室外なら +Z 面が反転');
});

test('反転は上下(V)を変えない', () => {
  const s = loadHelpers();
  const mats = s.doorLeafFaceMaterials(new Mat(new Tex(1, 0, 0.5, 0.25)), 1);
  assert.equal(mats[5].map.repeat.y, 0.5, '反転でVのスケールが変わってはいけない');
  assert.equal(mats[5].map.offset.y, 0.25, '反転でVのオフセットが変わってはいけない');
});

test('切り出し(sX/sScale で寄せたトリミング)を保ったまま反転する', () => {
  const s = loadHelpers();
  // 画像の [0.10, 0.60] だけを使う、中央でない切り出し
  const mats = s.doorLeafFaceMaterials(new Mat(new Tex(0.5, 0.1)), 1);
  const back = mats[5].map;
  // 反転後も使う範囲は [0.10, 0.60] のまま、向きだけが逆になる
  assert.equal(back.repeat.x.toFixed(6), (-0.5).toFixed(6));
  assert.equal((back.offset.x).toFixed(6), (0.6).toFixed(6), 'u=0 側が切り出しの右端を指す');
  assert.equal((back.offset.x + back.repeat.x).toFixed(6), (0.1).toFixed(6), 'u=1 側が切り出しの左端を指す');
});

test('ユーザーの左右反転トグル(textureFlipX 適用済み = repeat 負)にも重ねてかかる', () => {
  const s = loadHelpers();
  // applyTextureFlip 後の状態: repeat.x=-1, offset.x=1
  const mats = s.doorLeafFaceMaterials(new Mat(new Tex(-1, 1)), 1);
  const back = mats[5].map;
  assert.equal(back.repeat.x.toFixed(6), (1).toFixed(6), '二重反転で元の向きに戻る');
  assert.equal(back.offset.x.toFixed(6), (0).toFixed(6));
});

test('元のマテリアルとテクスチャは書き換えない(表面が巻き添えにならない)', () => {
  const s = loadHelpers();
  const tex = new Tex();
  const base = new Mat(tex);
  const mats = s.doorLeafFaceMaterials(base, 1);
  assert.equal(tex.repeat.x, 1, '元テクスチャの repeat が書き換わっている');
  assert.equal(tex.offset.x, 0, '元テクスチャの offset が書き換わっている');
  assert.notEqual(mats[5].map, tex, '裏面が元テクスチャを共有している');
  assert.equal(mats[4], base, '表面は元のマテリアルをそのまま使う');
});

test('テクスチャ無しの扉(色だけ)は今までどおり単一マテリアルのまま', () => {
  const s = loadHelpers();
  const plain = new Mat(null);
  assert.equal(s.doorLeafFaceMaterials(plain, 1), plain, '色だけの扉に面分割を持ち込まない');
  assert.equal(s.mirrorMaterialTextureX(plain), plain);
  assert.equal(s.doorLeafFaceMaterials(null, 1), null);
});

// 扉の面材が増えたとき、素の doorMat を貼ってしまう取りこぼしを防ぐ。
test('扉の面材は生の doorMat ではなく、表裏を分けた doorLeafMat を使う', () => {
  const body = topLevelFunction('buildWinFrames');
  const leaks = [];
  body.split('\n').forEach(function (line, i) {
    if (!/\bdoorMat\b/.test(line)) return;
    // 定義行と、doorLeafMat を組み立てている行だけが doorMat に触れてよい
    if (/var doorMat=/.test(line)) return;
    if (/doorLeafFaceMaterials\(doorMat/.test(line)) return;
    leaks.push((i + 1) + ': ' + line.trim());
  });
  assert.deepEqual(leaks, [], 'この行の面材は裏面が反転しない:\n' + leaks.join('\n'));
});
