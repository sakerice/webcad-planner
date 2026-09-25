// 壁紙カラーの設定欄に、ほかの壁に埋まって見えない面が並ばないこと。
// 判定(wallFaceCoveredByOtherWalls)を実際に走らせて、埋まる区間と見える区間を分ける。
// 3Dの描画はこの判定を使わない(埋まった区間を消すと、重なり方によって室内から
// 壁の芯が素通しに見えたため)。設定欄だけが使う。
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
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が無い');
  return m[0];
}
function ctx(walls) {
  const c = vm.createContext({ DATA: { walls } });
  vm.runInContext([topLevelVar('WALL_H'), topLevelVar('WALL_CORE_END_PAD_MM')].concat(
    ['isPositiveNumber', 'wallSolidCoverHeightMm', 'wallCoreBoxHitMm', 'wallFaceCoveredByOtherWalls'].map(sliceFunction)
  ).join('\n'), c);
  return c;
}

// A: 東西に 0..4000。B: A の東端を貫く南北の壁。A の端 60mm は B の中に埋まる。
const A = { id: 'A', floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120 };
const B = { id: 'B', floor: 1, x1: 4000, y1: -2000, x2: 4000, y2: 2000, thick: 120 };

test('隣の壁の中に入った壁端の区間は、埋まっているとみなす', () => {
  const c = ctx([A, B]);
  assert.equal(c.wallFaceCoveredByOtherWalls(A, 3940, 4000, 1), true);
  assert.equal(c.wallFaceCoveredByOtherWalls(A, 3940, 4000, -1), true);
});

test('部屋に面した区間は、埋まっていない', () => {
  const c = ctx([A, B]);
  assert.equal(c.wallFaceCoveredByOtherWalls(A, 0, 3940, 1), false);
});

test('一部だけ覆われた区間は、見えるので残す', () => {
  const c = ctx([A, B]);
  assert.equal(c.wallFaceCoveredByOtherWalls(A, 3000, 4000, 1), false);
});

test('低い壁(腰壁)や非表示の壁は、覆っているとみなさない', () => {
  assert.equal(ctx([A, Object.assign({}, B, { wallHeight: 1100 })]).wallFaceCoveredByOtherWalls(A, 3940, 4000, 1), false);
  assert.equal(ctx([A, Object.assign({}, B, { vis3D: 'hide' })]).wallFaceCoveredByOtherWalls(A, 3940, 4000, 1), false);
});
