// 非矩形の屋根 (L字・コの字)。
//
// 矩形の屋根アイテムを結合すると1つの屋根 (it.parts) になり、外周・棟・谷・
// 妻・軒樋は結合後の多角形から作られる。矩形1枚の屋根は結合の経路を1度も
// 通らないので、既存のプランの屋根は1頂点も変わらない。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = require('./app-source.cjs').appSource();

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
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}

const FNS = [
  'roofPartsRaw', 'roofParts', 'hasRoofParts', 'roofPartsBoundsMm',
  'roofUnionGrid', 'roofUnionEdgesMm',
  'roofPartRidgeAxes', 'roofPartsOwningEdge', 'roofEdgeIsEave',
  'roofPolygonModel', 'roofPolygonModelBuild', 'roofEnvelopeAt',
  'roofPolygonHeightAt', 'roofPolygonEaveEdges', 'roofPolygonOutlineMm',
  'roofSurfaceHeightAt', 'roofLocalPoint', 'roofLocalToWorldMm',
  'roofCoversPlanPoint', 'setbackClipsCoverPlan', 'setbackOutlineCoversLocal'
];

function ctx() {
  const c = vm.createContext({ console, Number, Math, isFinite, Array, Object, JSON });
  vm.runInContext([
    topLevelVar('U'),
    topLevelVar('_roofPolygonModelCache')
  ].concat(FNS.map(topLevelFunction)).join('\n'), c);
  vm.runInContext('var _roofPolygonModelCacheN=0;', c);
  return c;
}

// L字: 長手 8000x4000 の下に、左へ 4000x4000 が生える。
// 中心を原点にそろえた parts (結合時に normalise されるのと同じ形)。
function lShape(roofType) {
  return {
    id: 1, type: 'roof', x: 0, y: 0, w: 8000, d: 8000, rot: 0, floor: 1,
    roofType: roofType || 'hip', pitch: 30,
    parts: [
      { cx: 0, cz: -2000, w: 8000, d: 4000 },
      { cx: -2000, cz: 2000, w: 4000, d: 4000 }
    ],
    partsBox: { w: 8000, d: 8000 }
  };
}

const TAN30 = Math.tan(30 * Math.PI / 180);
// 高さ(m) → 軒からの水平距離(m)。勾配で割れば読みやすい。
function run(c, it, x, z) { return c.roofPolygonHeightAt(it, x, z) / TAN30; }

test('矩形1枚の屋根は結合の経路を通らない', () => {
  const c = ctx();
  const plain = { id: 2, type: 'roof', x: 0, y: 0, w: 8000, d: 4000, roofType: 'hip', pitch: 30 };
  assert.equal(c.hasRoofParts(plain), false);
  assert.equal(c.roofParts(plain), null);
  // 従来の式(寄棟 = 短辺の半分まで上がる)がそのまま出る
  assert.ok(Math.abs(c.roofSurfaceHeightAt(plain, 0, 0) - TAN30 * 2) < 1e-9);
});

test('結合した屋根の外周は、外接矩形ではなくL字になる', () => {
  const c = ctx();
  const it = lShape();
  const edges = c.roofUnionEdgesMm(it.parts);
  assert.equal(edges.length, 6, 'L字の外周は6辺');
  // 同一直線上の辺は1本にまとまっている(切れ目ごとに偽の隅棟ができない)
  const zMin = edges.filter(e => e.nz > 0);
  assert.equal(zMin.length, 1);
  assert.equal(Math.abs(zMin[0].bx - zMin[0].ax), 8000);
});

test('寄棟: 入隅では谷が入隅点まで降りる（高さ0）', () => {
  const c = ctx();
  const it = lShape('hip');
  // 入隅はローカル (0,0)
  assert.ok(Math.abs(run(c, it, 0, 0)) < 1e-6);
  // 入隅の内側 200mm は 200mm ぶんだけ上がる
  assert.ok(Math.abs(run(c, it, 0.5, -0.2) - 0.2) < 1e-6);
});

test('寄棟: 棟の高さは各翼の短辺の半分（隅棟が45度で走る）', () => {
  const c = ctx();
  const it = lShape('hip');
  assert.ok(Math.abs(run(c, it, 0, -2) - 2) < 1e-6);     // 長手の棟
  assert.ok(Math.abs(run(c, it, -2, 2) - 2) < 1e-6);     // 左翼の頂点
  assert.ok(Math.abs(run(c, it, -3.9, -1.9) - 0.1) < 1e-6); // 軒先の近く
});

test('入隅の外側では、45度に広げた影響域が正しい面を選ぶ（円錐にならない）', () => {
  const c = ctx();
  const it = lShape('hip');
  // 入隅(0,0)から左下へ 45度。入隅の2辺の面が効くので、距離は 0.3 のまま
  assert.ok(Math.abs(run(c, it, -0.3, -0.3) - 0.3) < 1e-6);
});

test('切妻: 棟の向きは矩形ごとに決まり、L字でも棟の高さがそろう', () => {
  const c = ctx();
  const it = lShape('gable');
  const axes = c.roofPartRidgeAxes(it.parts, false);
  assert.deepEqual(axes, ['x', 'z'], '長手はx方向、正方形の翼は隣と直交');
  // どちらの棟も軒から 2000mm
  assert.ok(Math.abs(run(c, it, 0, -2) - 2) < 1e-6);
  assert.ok(Math.abs(run(c, it, -2, 2) - 2) < 1e-6);
  // 妻(棟と直交しない辺)は軒ではない = そこは垂直に立ち上がる
  const model = c.roofPolygonModel(it);
  assert.ok(model.eaves.length < model.edges.length);
});

test('陸屋根は結合しても平ら', () => {
  const c = ctx();
  const it = lShape('flat');
  assert.equal(c.roofPolygonHeightAt(it, 0, -2), 0);
  assert.equal(c.roofPolygonHeightAt(it, -2, 2), 0);
});

test('軒樋の軒先は、結合後の外周の軒だけに付く', () => {
  const c = ctx();
  const hip = c.roofPolygonEaveEdges(lShape('hip'));
  assert.equal(hip.length, 6, '寄棟は全周が軒');
  const gable = c.roofPolygonEaveEdges(lShape('gable'));
  assert.ok(gable.length > 0 && gable.length < 6, '切妻は妻側に軒樋を出さない');
});

test('外接矩形が変わると parts も同じ比率で追従する', () => {
  const c = ctx();
  const it = lShape();
  it.w = 16000;                      // つまんで横に2倍
  const scaled = c.roofParts(it);
  assert.equal(scaled[0].w, 16000);
  assert.equal(scaled[1].cx, -4000);
  assert.equal(scaled[0].d, 4000);   // 奥行きは変えていない
});

test('屋根の輪郭判定も結合後の形で見る（L字の欠けた側は屋根の下ではない）', () => {
  const c = ctx();
  const it = lShape();            // ワールド x 0..8000 / y 0..8000 の外接矩形
  // 長手(y 0..4000)の下は屋根の下
  assert.equal(c.roofCoversPlanPoint(it, 4000, 2000), true);
  // 左翼(x 0..4000, y 4000..8000)の下も屋根の下
  assert.equal(c.roofCoversPlanPoint(it, 2000, 6000), true);
  // 欠けている側(x 4000..8000, y 4000..8000)は屋根の下ではない。
  // 外接矩形で見ていた頃はここも「屋根の下」になっていた。
  assert.equal(c.roofCoversPlanPoint(it, 6000, 6000), false);
});

test('結合と解除は往復する（位置が飛ばない）', () => {
  // 解除は中心を先にすべて求めてから書き換える。1枚目で it.x/it.w を
  // 書き換えてから2枚目を変換すると原点がずれて位置が飛んだ。
  const body = topLevelFunction('splitSelectedRoof');
  assert.match(body, /var centers=parts\.map/);
  assert.ok(body.indexOf('var centers=parts.map') < body.indexOf('it.parts=undefined'),
    '中心の計算は it を書き換える前に終わっていなければならない');
});
