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
  const c = vm.createContext({ THREE: Object.assign({}, THREE, { rectAreaReady: true }), sc3, isInt: interior, isWalkView: () => false, ren: { shadowMap: {} }, Math, performance: { now: () => c._t } });
  c._t = 0;
  vm.runInContext(html.match(/\nvar LIGHT_BUDGET=[^;]*;/)[0] + '\n' + html.match(/\nvar _lightBudget=[^;]*;/)[0] + '\n' +
    ['invalidateLightBudget', 'lightAncestorsVisible', 'lightBudgetDummy', 'padShadowBudget', 'padLightBudget', 'applyInteriorLightBudget'].map(sliceFunction).join('\n'), c);
  return c;
}
const cam = (x) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, 1.6, 0); return c; };
// 実際に描画に使われる光(自分と親がすべて見えている)。明るさ 0 の空の光も数える
// (シェーダーの形を決めるのは数なので)。
function effective(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
const lit = (sc3, type, withDummy) => { const out = []; sc3.traverse((o) => { if (o['is' + type] && effective(o) && (withDummy || !o.userData.budgetDummy)) out.push(o); }); return out; };

test('内観では、スポットはカメラに近い上限数だけ光らせ、影もその中の近いものだけ', () => {
  const sc3 = scene(32, 3), c = ctx(sc3, true);
  c.applyInteriorLightBudget(cam(0));
  const on = lit(sc3, 'SpotLight');
  assert.equal(on.length, c.LIGHT_BUDGET.spot);
  assert.ok(on.every((o) => o.position.x < c.LIGHT_BUDGET.spot), '遠い光が残っている');
  assert.equal(lit(sc3, 'SpotLight', true).length, c.LIGHT_BUDGET.spot + c.LIGHT_BUDGET.spotShadow);
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

// 利用者の報告: 階を跨ぐと重い / 2階のホールで重い。ウォークスルーはいる階以外の家具を
// グループごと隠すので、その中の光は描画に使われない。以前は隠れた光も候補に数え、
// 実際に効く光の数が歩く位置や階で変わって、シェーダーを作り直していた。
function twoFloors() {
  const sc3 = new THREE.Scene();
  const f1 = new THREE.Group(), f2 = new THREE.Group();
  sc3.add(f1); sc3.add(f2);
  for (let i = 0; i < 30; i++) { const s = new THREE.SpotLight(0xffffff, 1); s.position.set(i * 0.3, 2.5, 0); s.userData.shadowable = true; f1.add(s); }
  for (let i = 0; i < 5; i++) { const s = new THREE.SpotLight(0xffffff, 1); s.position.set(i, 5.4, 0); s.userData.shadowable = true; f2.add(s); }
  return { sc3, f1, f2 };
}
test('隠れた階の光は候補にせず、足りない分は明るさ 0 の光で埋めて、効く光の数を一定に保つ', () => {
  const { sc3, f1 } = twoFloors(), c = ctx(sc3, true);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 4.5, 0);
  c.applyInteriorLightBudget(camera);
  const total = c.LIGHT_BUDGET.spot + c.LIGHT_BUDGET.spotShadow;
  const shadowsOf = () => lit(sc3, 'SpotLight', true).filter((o) => o.castShadow).length;
  assert.equal(lit(sc3, 'SpotLight', true).length, total);
  assert.equal(shadowsOf(), c.LIGHT_BUDGET.spotShadow);
  // 2階に移り、1階の家具(光を含む)がグループごと隠れる
  f1.visible = false;
  c._t = 50;
  c.applyInteriorLightBudget(camera);
  assert.equal(lit(sc3, 'SpotLight', true).length, total, '効く光の数が変わった(シェーダーを作り直す)');
  assert.equal(shadowsOf(), c.LIGHT_BUDGET.spotShadow, '影の数が変わった');
  assert.equal(lit(sc3, 'SpotLight').length, 5, '2階の光が全部は光っていない');
  const dummies = lit(sc3, 'SpotLight', true).filter((o) => o.userData.budgetDummy);
  assert.equal(dummies.length, total - 5);
  assert.ok(dummies.every((d) => d.intensity === 0));
});
test('影の描き直しは、影を落とす光が変わったときだけ', () => {
  const sc3 = scene(32, 0), c = ctx(sc3, true);
  c.applyInteriorLightBudget(cam(0));
  c.ren.shadowMap.needsUpdate = false;
  c._t = 1000;
  c.applyInteriorLightBudget(cam(0.3));      // 少し動いたが、近い光の顔ぶれは同じ
  assert.equal(c.ren.shadowMap.needsUpdate, false, '影を落とす光が同じなのに描き直している');
  c._t = 2000;
  c.applyInteriorLightBudget(cam(25));
  assert.equal(c.ren.shadowMap.needsUpdate, true);
});
