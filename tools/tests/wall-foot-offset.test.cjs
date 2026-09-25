// 壁の足元の上下(wallFootOffsetMm)と、上に床の無い部屋の判定(roomHasNoFloorAbove)。
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

test('足元の上下は省略で 0、範囲外は丸める', () => {
  const c = vm.createContext({});
  vm.runInContext(sliceFunction('wallFootOffsetMm'), c);
  assert.equal(c.wallFootOffsetMm({}), 0);
  assert.equal(c.wallFootOffsetMm({ footOffsetMm: -450 }), -450);
  assert.equal(c.wallFootOffsetMm({ footOffsetMm: -9000 }), -3000);
  assert.equal(c.wallFootOffsetMm({ footOffsetMm: 'x' }), 0);
});

test('上の階に部屋があるのに真上に無く、さらに上の屋根だけが覆う部屋を見つける', () => {
  const stairRoom = { floor: 1, x: 0, y: 0, w: 1800, d: 900 };
  const other2F = { floor: 2, x: 3000, y: 0, w: 3000, d: 3000 };
  const roof3 = { type: 'roof', floor: 3 };
  const c = vm.createContext({
    DATA: { rooms: [stairRoom, other2F], items: [roof3] },
    roomHasRoomAbove: (r) => r === stairRoom ? false : true,
    roofCoversPlanPoint: () => true,
  });
  vm.runInContext(sliceFunction('roomHasNoFloorAbove'), c);
  assert.equal(c.roomHasNoFloorAbove(stairRoom), true);
  // 屋根が真上の階に載っている(下屋)なら、上は屋根裏であって上の階ではない。
  roof3.floor = 2;
  assert.equal(c.roomHasNoFloorAbove(stairRoom), false);
});
