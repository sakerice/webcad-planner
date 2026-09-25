// 家具を置いたときの高さの初期値(findDefaultPlacementSurface)。
// 報告: 家具が床に埋まる。基礎(建物の床の下にある)を「載る面」と取り違え、
// 床スラブ+床上げぶん(スキップフロアの上では段差ぶんも)沈めていた。
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

// 基礎: 地面(0)から 450。室内の床: 780(基礎450+スラブ180+床上げ150)。机: 床から 700。
function ctx(items) {
  const c = vm.createContext({
    U: 0.001, DATA: { items }, ST: { floor: 1 },
    canSetItemElevation: () => true,
    isPlacementSurfaceItem: (o) => o.type === 'foundation' || o.type === 'desk',
    isInsideItem: (o, x, y) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.d,
    getItemTopElevation: (o) => (o.elev || 0) + (o.type === 'foundation' ? 450 : 700),
    item3DBaseY: (o) => (o.type === 'foundation' ? 0 : 0.78)
  });
  vm.runInContext(sliceFunction('findDefaultPlacementSurface'), c);
  return c;
}
const foundation = { type: 'foundation', floor: 1, x: 0, y: 0, w: 9000, d: 8000 };

test('室内に置いた家具は、床の下の基礎を載る面にしない(床に埋まらない)', () => {
  const sofa = { type: 'sofa', floor: 1, x: 1000, y: 1000, w: 1800, d: 800 };
  assert.equal(ctx([foundation, sofa]).findDefaultPlacementSurface(sofa), null);
});

test('机の上に置いた物は、従来どおり天板へ載る', () => {
  const desk = { type: 'desk', floor: 1, x: 900, y: 900, w: 1200, d: 600 };
  const lamp = { type: 'lamp', floor: 1, x: 1400, y: 1100, w: 200, d: 200 };
  const s = ctx([foundation, desk, lamp]).findDefaultPlacementSurface(lamp);
  assert.equal(s.item, desk);
  assert.equal(s.top, 700);
});
