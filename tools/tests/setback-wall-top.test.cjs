// 斜線の板(setbackRoof)の下の壁は、板の**下面**で止める。
// 利用者のプラン41: 壁の天端が板の上面(制限面)と同じ高さに並び、黒い板の上に
// 壁の色がちらついた(W105・W108)。ふつうの屋根は従来どおり面まで。
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
function ctx() {
  const c = vm.createContext({
    U: 0.001, Math, Number,
    roofCoversPlanPoint: () => true,
    roofUndersideWorldYAt: () => 9.0,
  });
  vm.runInContext(['roofSlabThickM', 'roofSlabBottomWorldYAt', 'roofSlabBottomLimitAtPlanPoint'].map(sliceFunction).join('\n'), c);
  return c;
}

test('斜線の板の下では、壁の頭は板の下面(面から板厚ぶん下)で止まる', () => {
  const slab = { type: 'roof', roofType: 'mono', setbackRoof: true, roofThickness: 100 };
  assert.ok(Math.abs(ctx().roofSlabBottomLimitAtPlanPoint([slab], 0, 0) - 8.9) < 1e-9);
});

test('ふつうの屋根では従来どおり面まで', () => {
  const roof = { type: 'roof', roofType: 'mono', roofThickness: 100 };
  assert.equal(ctx().roofSlabBottomLimitAtPlanPoint([roof], 0, 0), 9.0);
});

test('両方かかる点では低い方', () => {
  const slab = { type: 'roof', roofType: 'mono', setbackRoof: true, roofThickness: 100 };
  const roof = { type: 'roof', roofType: 'mono', roofThickness: 100 };
  assert.ok(Math.abs(ctx().roofSlabBottomLimitAtPlanPoint([roof, slab], 0, 0) - 8.9) < 1e-9);
});

test('面に届かない壁は下げない(板が建たない所で天端を下げない)。届く壁だけ板の下面で止める', () => {
  const c = vm.createContext({
    U: 0.001, Math, Number,
    roofCoversPlanPoint: () => true,
    roofUndersideWorldYAt: () => 9.0,
    wallExteriorFaceOffsetM: () => 0.063, wallInteriorFaceOffsetM: () => 0.063,
  });
  vm.runInContext(['roofSlabThickM', 'roofSlabBottomWorldYAt', 'roofTopLimitAtPlanPoint', 'roofSlabBottomLimitAtPlanPoint', 'wallRoofTopLimitWorldY'].map(sliceFunction).join('\n'), c);
  const slab = { type: 'roof', roofType: 'mono', setbackRoof: true, roofThickness: 100 };
  const w = { x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120 };
  assert.equal(c.wallRoofTopLimitWorldY(w, [slab], 500, 0, 8.95), 9.0, '面より下の壁には効かない');
  assert.ok(Math.abs(c.wallRoofTopLimitWorldY(w, [slab], 500, 0, 9.2) - 8.9) < 1e-9, '面に届く壁は板の下面');
  assert.ok(Math.abs(c.wallRoofTopLimitWorldY(w, [slab], 500, 0) - 8.9) < 1e-9, '候補が無ければ板の下面');
});
