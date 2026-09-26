// 線照明と、下げ天井に仕込む間接照明。
//
// 利用者の報告: 線照明がきちんと照らない。以前は器具の両端寄りに点光源を2つ置いて
// 全方向へ照らしていたので、光が丸いにじみ2つになり、天井や壁を線に沿って照らせ
// なかった。線の長さ全体から、決めた向きへ照らす(面光源 RectAreaLight)。
// 下げ天井は多くの場合、縁に間接照明を仕込む(利用者)。その形も作る。
//
// 面光源の向きは実物の three.js(同梱の r169)で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const html = require('./app-source.cjs').appSource();
const ROOT = path.join(__dirname, '..', '..');

function sliceFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.notEqual(at, -1, name);
  let i = src.indexOf('{', at), depth = 0, mode = null;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) { if (c === '\\') { i++; continue; } if (c === mode) mode = null; continue; }
    if (c === '/' && n === '/') { mode = 'line'; i++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(name);
}
let THREE;
test.before(async () => {
  THREE = await import(pathToFileURL(path.join(ROOT, 'assets/vendor/three/build/three.module.js')).href);
});
function lineCtx(rectReady) {
  const T = Object.assign({}, THREE, { rectAreaReady: rectReady });
  const c = vm.createContext({ THREE: T, isInt: true, isWalkView: () => false, U: 0.001, Math, Number });
  vm.runInContext('var LINE_LIGHT_WIDTH_M=0.04; var LINE_LIGHT_LUMINANCE=1.6;\n' +
    sliceFunction(html, 'lineLightAim') + '\n' + sliceFunction(html, 'addLineLight'), c);
  return c;
}
// 面光源が照らす向き(ワールド)と、長手の向き。
function aimOf(light) {
  light.updateMatrixWorld(true);
  const e = light.matrixWorld.elements;
  return { dir: new THREE.Vector3(-e[8], -e[9], -e[10]).normalize(), along: new THREE.Vector3(e[0], e[1], e[2]).normalize() };
}
const near = (v, x, y, z) => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6 && Math.abs(v.z - z) < 1e-6;

test('線照明は面光源1つで、線の長さ全体から決めた向きへ照らす', () => {
  const c = lineCtx(true);
  for (const [aim, dx, dy, dz] of [['down', 0, -1, 0], ['up', 0, 1, 0]]) {
    const grp = new THREE.Group();
    c.addLineLight(grp, { lightIntensity: 0.8, lightAim: aim }, new THREE.Color('#fff'), 1.8, c.lineLightAim({ lightAim: aim }));
    const lights = grp.children.filter((o) => o.isRectAreaLight);
    assert.equal(lights.length, 1, aim);
    assert.equal(lights[0].width, 1.8);
    const a = aimOf(lights[0]);
    assert.ok(near(a.dir, dx, dy, dz), aim + ' の向き ' + JSON.stringify(a.dir));
    assert.ok(near(a.along, 1, 0, 0), aim + ' の長手が器具に沿っていない ' + JSON.stringify(a.along));
  }
  // 横へ: 器具の前(ローカル +奥行き = +Z)へ、少し下向き
  const g = new THREE.Group();
  c.addLineLight(g, { lightIntensity: 0.8 }, new THREE.Color('#fff'), 1.2, 'side');
  const s = aimOf(g.children.find((o) => o.isRectAreaLight));
  assert.ok(s.dir.z > 0.9 && s.dir.y < 0, JSON.stringify(s.dir));
});
test('面光源が使えないときは、点光源を線に沿って並べる', () => {
  const c = lineCtx(false);
  const grp = new THREE.Group();
  c.addLineLight(grp, { lightIntensity: 0.8 }, new THREE.Color('#fff'), 2.4, 'down');
  const pts = grp.children.filter((o) => o.isPointLight);
  assert.equal(pts.length, 4);
  const xs = pts.map((p) => p.position.x);
  assert.ok(Math.min(...xs) < -0.8 && Math.max(...xs) > 0.8, '線に沿って広がっていない ' + xs);
});
test('線照明の向きの既定は下。知らない値も下', () => {
  const c = lineCtx(true);
  assert.equal(c.lineLightAim({}), 'down');
  assert.equal(c.lineLightAim({ lightAim: 'up' }), 'up');
  assert.equal(c.lineLightAim({ lightAim: 'x' }), 'down');
});

// ── 下げ天井の間接照明 ──
const cd = fs.readFileSync(path.join(ROOT, 'assets/js/ceiling-designer.js'), 'utf8');
function coveCtx() {
  const c = vm.createContext({ THREE, U: 0.001, Math, Number, isInt: true, isWalkView: () => false });
  vm.runInContext('const COVE_GAP_DEFAULT_MM=100, COVE_SETBACK_M=.06;\nvar LINE_LIGHT_WIDTH_M=0.04; var LINE_LIGHT_LUMINANCE=1.6;\n' +
    ['coveOf', 'buildCove'].map((n) => sliceFunction(cd, n)).join('\n') + '\n' + sliceFunction(html, 'addLineLight'), c);
  c.THREE = Object.assign({}, THREE, { rectAreaReady: true });
  return c;
}
test('間接照明を仕込めるのは下げ天井で、段差が光の出口＋40mm 以上のときだけ', () => {
  const c = coveCtx();
  assert.ok(c.coveOf({ offset: -250, cove: true }));
  assert.equal(c.coveOf({ offset: -250 }), null, '入れていない');
  assert.equal(c.coveOf({ offset: 250, cove: true }), null, '折り上げには仕込まない');
  assert.equal(c.coveOf({ offset: -130, cove: true }), null, '100+40 に届かない');
  assert.ok(c.coveOf({ offset: -140, cove: true }));
  assert.equal(c.coveOf({ offset: -250, cove: true, coveGap: 250 }), null);
  assert.equal(Math.round(c.coveOf({ offset: -250, cove: true, coveGap: 80 }).gapM * 1000), 80);
});
test('間接照明は4辺の縁の上から、外向き・斜め上へ照らし、器具は上板の上にある', () => {
  const c = coveCtx();
  const g = new THREE.Group();
  const a = { id: 'a', offset: -250, cove: true };
  // 中心 (0,0)、幅 2m × 奥行き 1m、上板 y=2.3
  c.buildCove(g, a, null, 0, 0, 2, 1, 2.3, new THREE.MeshBasicMaterial());
  const lights = g.children.filter((o) => o.isRectAreaLight);
  assert.equal(lights.length, 4);
  lights.forEach((l) => {
    const { dir } = aimOf(l);
    assert.ok(dir.y > 0.7, '上向きでない ' + JSON.stringify(dir));
    const out = new THREE.Vector3(l.position.x, 0, l.position.z).normalize();
    assert.ok(dir.x * out.x + dir.z * out.z > 0.3, '外へ向いていない');
    assert.ok(l.position.y > 2.3, '上板より下にある');
  });
  assert.equal(g.children.filter((o) => o.userData.coveLed).length, 4);
});
