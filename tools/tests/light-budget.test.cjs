// 光の予算。ダウンライトを 32 灯並べた LDK で、ウォークスルー1フレームが約0.5秒
// かかった(利用者の報告: 動作がかなり重くなった)。three.js は全画素で全部の光を
// 計算するので、内観・ウォークスルーでは光を計算する数に上限を置き、カメラに近い
// ものから光らせる。種類ごとの数と、影を落とす数は常に一定(シェーダーを作り直さない)。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const html = require('./app-source.cjs').appSource();
function sliceFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}') { depth--; if (depth === 0) break; } }
  return html.slice(at + 1, i + 1);
}
let THREE;
test.before(async () => {
  THREE = await import(pathToFileURL(path.join(__dirname, '..', '..', 'assets/vendor/three/build/three.module.js')).href);
});
function scene(nSpot, nPoint) {
  const sc3 = new THREE.Scene();
  for (let i = 0; i < nSpot; i++) {
    const s = new THREE.SpotLight(0xffffff, 1); s.position.set(i, 2.5, 0);
    s.userData.shadowable = true; sc3.add(s);
  }
  for (let i = 0; i < nPoint; i++) { const p = new THREE.PointLight(0xffffff, 1); p.position.set(-i, 2.5, 3); sc3.add(p); }
  return sc3;
}
function ctx(sc3, interior) {
  const c = vm.createContext({ THREE, sc3, isInt: interior, isWalkView: () => false, ren: { shadowMap: {} }, Math, performance: { now: () => c._t } });
  c._t = 0;
  vm.runInContext(html.match(/\nvar LIGHT_BUDGET=[^;]*;/)[0] + '\n' + html.match(/\nvar _lightBudget=[^;]*;/)[0] + '\n' +
    ['invalidateLightBudget', 'applyInteriorLightBudget'].map(sliceFunction).join('\n'), c);
  return c;
}
const cam = (x) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, 1.6, 0); return c; };
const lit = (sc3, type) => { const out = []; sc3.traverse((o) => { if (o['is' + type] && o.visible) out.push(o); }); return out; };

test('内観では、スポットはカメラに近い上限数だけ光らせ、影もその中の近いものだけ', () => {
  const sc3 = scene(32, 3), c = ctx(sc3, true);
  c.applyInteriorLightBudget(cam(0));
  const on = lit(sc3, 'SpotLight');
  assert.equal(on.length, c.LIGHT_BUDGET.spot);
  assert.ok(on.every((o) => o.position.x < c.LIGHT_BUDGET.spot), '遠い光が残っている');
  assert.equal(on.filter((o) => o.castShadow).length, c.LIGHT_BUDGET.spotShadow);
  assert.equal(lit(sc3, 'PointLight').length, 3, '上限より少なければ全部光る');
});
test('歩くと光らせる光が入れ替わるが、数と影の数は変わらない', () => {
  const sc3 = scene(32, 0), c = ctx(sc3, true);
  c.applyInteriorLightBudget(cam(0));
  c._t = 1000;
  c.applyInteriorLightBudget(cam(25));
  const on = lit(sc3, 'SpotLight');
  assert.equal(on.length, c.LIGHT_BUDGET.spot);
  assert.ok(on.every((o) => Math.abs(o.position.x - 25) <= 6), '近くの光に入れ替わっていない');
  assert.equal(on.filter((o) => o.castShadow).length, c.LIGHT_BUDGET.spotShadow);
});
test('外観では予算をかけず、隠した光を戻す', () => {
  const sc3 = scene(32, 0), c = ctx(sc3, true);
  c.applyInteriorLightBudget(cam(0));
  c.isInt = false;
  c.applyInteriorLightBudget(cam(0));
  assert.equal(lit(sc3, 'SpotLight').length, 32);
});
