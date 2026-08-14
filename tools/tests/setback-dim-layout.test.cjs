// Task 21-5: 斜線の寸法の文字が **画面の上で建物の輪郭に被らない**ことを、
// 実際に投影して確かめる。平面の上で建物の外へ置くだけでは、視点によっては
// 建物の手前や奥に重なって見えるので、逃がす向きは毎フレーム決まる。
//
// grep ではない。index.html から layoutSetbackDimLabels を切り出し、
// 手で組んだ透視投影のカメラで走らせ、動いたスプライトの画面座標を読む。
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

// ── 手で組んだ透視投影 ────────────────────────────────────────────────
// three.js と同じ順序（world → matrixWorldInverse → projectionMatrix → w 除算）。
function mat(rows) {   // rows は行優先の 4x4。elements は three.js と同じ並び。
  const e = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) e[c * 4 + r] = rows[r][c];
  return { elements: e };
}
const CAM_D = 20, FOV_F = 1 / Math.tan((35 * Math.PI / 180) / 2), ASPECT = 1.5;
const NEAR = 0.1, FAR = 500;
const PROJ = mat([
  [FOV_F / ASPECT, 0, 0, 0],
  [0, FOV_F, 0, 0],
  [0, 0, (FAR + NEAR) / (NEAR - FAR), 2 * FAR * NEAR / (NEAR - FAR)],
  [0, 0, -1, 0],
]);
const VIEW = mat([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, -CAM_D], [0, 0, 0, 1]]);

function Vector3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
Vector3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Vector3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
Vector3.prototype.clone = function () { return new Vector3(this.x, this.y, this.z); };
Vector3.prototype.applyMatrix4 = function (m) {
  const e = m.elements, x = this.x, y = this.y, z = this.z;
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  return this;
};
Vector3.prototype.applyQuaternion = function () { return this; };   // 回転なしのカメラ
Vector3.prototype.project = function (cam) {
  return this.applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
};
function Box3() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }

function Obj3D() {
  this.children = []; this.userData = {}; this.visible = true;
  const self = this;
  this.position = { x: 0, y: 0, z: 0, set(x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
}
Obj3D.prototype.add = function (o) { this.children.push(o); return o; };
Obj3D.prototype.traverse = function (cb) {
  cb(this);
  this.children.forEach(function (c) { if (c.traverse) c.traverse(cb); else cb(c); });
};

const CAM = { matrixWorldInverse: VIEW, projectionMatrix: PROJ, quaternion: {} };
function ndcX(x, y, z) { return new Vector3(x, y, z).project(CAM).x; }

function makeCtx() {
  const sc3 = new Obj3D();
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String,
    THREE: { Vector3, Box3 },
    sc3,
    _setbackBuildingBox: null,
  });
  vm.runInContext(['SETBACK_DIM_LABEL_GAP_NDC', 'SETBACK_DIM_LABEL_MAX_M'].map(topLevelVar)
    .concat([topLevelFunction('layoutSetbackDimLabels')]).join('\n'), ctx);
  return { ctx, sc3 };
}
// 建物: x -3..3, y 0..6, z -3..3。画面ではこの箱の輪郭が寸法の逃げ先を決める。
function setBuilding(h) {
  const b = new Box3();
  b.min = new Vector3(-3, 0, -3); b.max = new Vector3(3, 6, 3);
  h.ctx.__b = b;
  vm.runInContext('_setbackBuildingBox=__b;', h.ctx);
}
function addLabel(h, x, y, z) {
  const sp = new Obj3D();
  sp.position.set(x, y, z);
  const lead = new Obj3D();
  lead.geometry = { attributes: { position: { array: [0, 0, 0, 0, 0, 0], needsUpdate: false } } };
  lead.visible = false;
  sp.userData.setbackDimAnchor = [x, y, z];
  sp.userData.setbackDimLead = lead;
  h.sc3.add(sp); h.sc3.add(lead);
  return { sp, lead };
}
function buildingNdcSpan() {
  let lo = Infinity, hi = -Infinity;
  [-3, 3].forEach((x) => [0, 6].forEach((y) => [-3, 3].forEach((z) => {
    const v = ndcX(x, y, z);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  })));
  return [lo, hi];
}

test('21-5(最重要): 建物に重なる寸法の文字は、画面の輪郭の外へ逃げる', () => {
  const h = makeCtx();
  setBuilding(h);
  const l = addLabel(h, 0, 7, 0);        // 建物の真上・画面のど真ん中
  const span = buildingNdcSpan();
  assert.ok(ndcX(0, 7, 0) > span[0] && ndcX(0, 7, 0) < span[1], '前提: 逃がす前は輪郭の中');
  vm.runInContext('layoutSetbackDimLabels(__cam)', Object.assign(h.ctx, { __cam: CAM }));
  const after = ndcX(l.sp.position.x, l.sp.position.y, l.sp.position.z);
  assert.ok(after <= span[0] || after >= span[1],
    '逃がしたあとも輪郭の中にいる: ' + after + ' vs ' + JSON.stringify(span));
});

test('21-5(最重要): 逃がした文字は引き出し線で元の位置と結ばれる', () => {
  const h = makeCtx();
  setBuilding(h);
  const l = addLabel(h, 0, 7, 0);
  vm.runInContext('layoutSetbackDimLabels(__cam)', Object.assign(h.ctx, { __cam: CAM }));
  assert.equal(l.lead.visible, true, '引き出し線が出ていない = 文字が宙に浮く');
  const p = l.lead.geometry.attributes.position.array;
  assert.deepEqual([p[0], p[1], p[2]], [0, 7, 0], '引き出し線の根元が元の位置でない');
  assert.equal(p[3], l.sp.position.x, '引き出し線の先が文字の位置でない');
  assert.equal(p[4], l.sp.position.y);
  assert.equal(p[5], l.sp.position.z);
});

test('21-5: もともと建物に被っていない文字は動かさない（無闇に飛ばさない）', () => {
  const h = makeCtx();
  setBuilding(h);
  const l = addLabel(h, 14, 3, 0);
  const span = buildingNdcSpan();
  assert.ok(ndcX(14, 3, 0) > span[1] + 0.055, '前提: 既に輪郭の外');
  vm.runInContext('layoutSetbackDimLabels(__cam)', Object.assign(h.ctx, { __cam: CAM }));
  assert.deepEqual([l.sp.position.x, l.sp.position.y, l.sp.position.z], [14, 3, 0]);
  assert.equal(l.lead.visible, false, '動かしていないのに引き出し線が出ている');
});

test('21-5: 逃がすのは画面の近い側（遠回りして反対側へ飛ばさない）', () => {
  const h = makeCtx();
  setBuilding(h);
  const l = addLabel(h, 2.5, 7, 0);      // 右寄り
  vm.runInContext('layoutSetbackDimLabels(__cam)', Object.assign(h.ctx, { __cam: CAM }));
  assert.ok(l.sp.position.x > 2.5, '右寄りの文字が左へ飛んだ: ' + l.sp.position.x);
});

test('21-5: 建物が測れていないときは1つも動かさない', () => {
  const h = makeCtx();
  const l = addLabel(h, 0, 7, 0);
  vm.runInContext('layoutSetbackDimLabels(__cam)', Object.assign(h.ctx, { __cam: CAM }));
  assert.deepEqual([l.sp.position.x, l.sp.position.y, l.sp.position.z], [0, 7, 0]);
});
