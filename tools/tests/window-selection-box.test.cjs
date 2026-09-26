// 窓の選択枠(getSelectionBox3D)は、窓そのものを包む。
// 以前は高さを「壁の高さ − 窓の下端」で打ち切っていて、その壁の高さを壁を渡さずに
// 求めていた(wallHeightMm(null) は下限の 300mm)。どの窓でも枠が 0.2〜0.25m に潰れ、
// 窓の下端に薄い帯として出た(利用者の報告)。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

function sliceFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が無い');
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
  throw new Error(name + ' が閉じていない');
}
const covers = (rf, x, y) => x >= rf.x && x <= rf.x + rf.w && y >= rf.y && y <= rf.y + rf.d;
function Vec(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
function Box3() { this.min = new Vec(Infinity, Infinity, Infinity); this.max = new Vec(-Infinity, -Infinity, -Infinity); }
Box3.prototype.isEmpty = function () { return this.max.y < this.min.y; };
// 回していない箱だけを扱う(試験の窓は rot 0)
Box3.prototype.setFromObject = function (m) {
  const g = m.geometry, p = m.position;
  this.min = new Vec(p.x - g.w / 2, p.y - g.h / 2, p.z - g.d / 2);
  this.max = new Vec(p.x + g.w / 2, p.y + g.h / 2, p.z + g.d / 2);
  return this;
};
const THREE = {
  Box3, Vector3: Vec,
  BoxGeometry: function (w, h, d) { this.w = w; this.h = h; this.d = d; this.dispose = () => {}; },
  Mesh: function (g) {
    this.geometry = g; const self = this;
    this.position = { x: 0, y: 0, z: 0, set(x, y, z) { self.position.x = x; self.position.y = y; self.position.z = z; } };
    this.rotation = { y: 0 };
  }
};
function box(it) {
  const c = vm.createContext({
    THREE, U: 0.001, Math, Number,
    shouldRenderItemInCurrent3DView: () => true,
    isOpeningItemType: () => true,
    isWindowLikeType: (t) => t === 'window' || t === 'window-door',
    getItemDisplayPose: (r) => ({ x: r.x + r.w / 2, y: r.y + r.d / 2, rot: 0 }),
    item3DBaseY: () => 0.78,
    openingSillMm: (r) => (r.type === 'window' ? r.windowSill : 0),
    openingHeightMm: (r) => r.windowHeight,
    windowHeightMm: (r) => r.windowHeight,
    wallHeightMm: (w) => { const v = Number(w && w.wallHeight); return isFinite(v) ? Math.max(300, v) : 2400; },
  });
  vm.runInContext(sliceFunction('getSelectionBox3D'), c);
  const b = c.getSelectionBox3D(it);
  return [Math.round(b.min.y * 1000), Math.round(b.max.y * 1000)];
}

test('腰窓の選択枠は、窓の下端から上端まで', () => {
  assert.deepEqual(box({ type: 'window', x: 0, y: 0, w: 1650, d: 150, windowSill: 900, windowHeight: 1200 }), [1680, 2880]);
});
test('掃き出し窓の選択枠は、床から窓の上端まで', () => {
  assert.deepEqual(box({ type: 'window-door', x: 0, y: 0, w: 1650, d: 180, windowHeight: 2100 }), [780, 2880]);
});
test('高い位置の窓(高窓)でも枠が潰れない', () => {
  assert.deepEqual(box({ type: 'window', x: 0, y: 0, w: 780, d: 150, windowSill: 1800, windowHeight: 600 }), [2580, 3180]);
});
