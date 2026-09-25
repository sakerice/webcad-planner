// 部屋に2枚の屋根がかかるとき(1階の LDK の西に陸屋根、東に片流れ)。
//   ・勾配天井は、部屋にかかる屋根すべてを見る(roofsOverRoom)
//   ・2階の壁は、同じ階の勾配屋根(下屋)の下面で切る。陸屋根は壁の足元なので切らない
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
const westFlat = { id: 'wf', type: 'roof', roofType: 'flat', floor: 2, x: 0, y: 4550, w: 5470, d: 3640 };
const eastMono = { id: 'em', type: 'roof', roofType: 'mono', floor: 2, x: 5470, y: 4550, w: 4160, d: 3640 };
const ldk = { floor: 1, x: 0, y: 4550, w: 9100, d: 3640 };

test('部屋に2枚の屋根がかかると、勾配天井は両方を見る', () => {
  const c = vm.createContext({
    DATA: { items: [westFlat, eastMono] },
    roofItemOverRoom: () => westFlat,          // 中心にかかるのは西の陸屋根
    roofCoversPlanPoint: covers,
    roofCeilingWorldYAt: () => 3, floorTopY: () => 0,
  });
  vm.runInContext(sliceFunction('roofsOverRoom'), c);
  assert.equal(c.roofsOverRoom(ldk).map((r) => r.id).join(','), 'wf,em');
});

test('屋根が1枚の部屋では、その1枚だけ(従来どおり)', () => {
  const c = vm.createContext({
    DATA: { items: [westFlat] },
    roofItemOverRoom: () => westFlat, roofCoversPlanPoint: covers,
    roofCeilingWorldYAt: () => 3, floorTopY: () => 0,
  });
  vm.runInContext(sliceFunction('roofsOverRoom'), c);
  assert.equal(c.roofsOverRoom(ldk).length, 1);
});

test('2階の壁は、同じ階の片流れで切られ、陸屋根では切られない', () => {
  const c = vm.createContext({ DATA: { items: [westFlat, eastMono] }, roofCoversPlanPoint: covers });
  vm.runInContext(sliceFunction('wallSameFloorRoofs'), c);
  const gable = { floor: 2, x1: 5470, y1: 4550, x2: 5470, y2: 8190 };
  assert.equal(c.wallSameFloorRoofs(gable).map((r) => r.id).join(','), 'em');
  const onFlat = { floor: 2, x1: 1000, y1: 5000, x2: 3000, y2: 5000 };
  assert.equal(c.wallSameFloorRoofs(onFlat).length, 0);
});
