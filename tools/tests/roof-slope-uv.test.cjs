// 屋根の柄(瓦の段・立平のはぜ)の向き。三角形ごとに、その面の流れに沿って貼る(roofSlopeUVs)。
// 以前は真上からの投影で、棟が南北の屋根・寄棟の妻側の面では瓦の段が軒と直交していた。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1);
  let depth = 0;
  for (let i = html.indexOf('{', at); i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(at + 1, i + 1);
  }
  throw new Error('閉じ括弧が無い');
}
const ctx = vm.createContext({ Math });
vm.runInContext(fn('roofSlopeUVs'), ctx);
const W = 6, D = 4, pitch = 30 * Math.PI / 180;

// 1つの三角形の uv を、W・D を掛けて実寸(m)に戻して返す
function uvM(tri) {
  const uv = ctx.roofSlopeUVs(new Float32Array(tri.flat()), W, D);
  return [0, 1, 2].map((k) => [uv[k * 2] * W, uv[k * 2 + 1] * D]);
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-4, `${msg}: ${a} ≠ ${b}`);

for (const [label, eave, ridge] of [
  ['南向きの面(棟が東西)', [[0, 0, 2], [3, 0, 2]], [[0, 0.8, 0]]],
  ['東向きの面(棟が南北)', [[2, 0, 0], [2, 0, 3]], [[0, 0.8, 0]]],
]) {
  test(`${label}: 軒に沿った2点は v が同じ(段が軒と平行)、軒の長さは u の差`, () => {
    const rise = Math.tan(pitch) * 2;
    const r = ridge[0].slice(); r[1] = rise;
    const [a, b, c] = uvM([eave[0], eave[1], r]);
    close(a[1], b[1], '軒の2点の v');
    close(Math.abs(a[0] - b[0]), 3, '軒の長さ');
    // 水上へ向かって v が増え、増え方は流れの実長(勾配で伸びた長さ)
    assert.ok(c[1] > a[1], '棟の方が v が大きい(画像の上が棟)');
    close(c[1] - a[1], 2 / Math.cos(pitch), '流れの実長');
  });
}

test('陸屋根(水平な面)は、従来どおり真上からの投影', () => {
  const uv = ctx.roofSlopeUVs(new Float32Array([-3, 0.1, -2, 3, 0.1, -2, 3, 0.1, 2]), W, D);
  assert.deepEqual(Array.from(uv).map((v) => +v.toFixed(6)), [0, 0, 1, 0, 1, 1]);
});
