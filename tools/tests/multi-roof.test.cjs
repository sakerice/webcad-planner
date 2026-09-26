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

// ── 2枚の屋根の境の段差(利用者のプラン32) ─────────────────────────────
// 天井も壁の頭も刻みで高さを採る。境で一気に跳ぶ高さを刻みの点で結ぶと、
// 1刻みぶんの斜面になり、低い側の屋根の小口が段々の帯になって見えた。
test('高さの跳びは、刻みの途中でも垂直の段になる(高い側へ1〜2mm寄せる)', () => {
  const c = vm.createContext({});
  vm.runInContext('var STEP_JUMP_MIN_M=0.02, STEP_JUMP_RATIO=4;\n' + sliceFunction('stepAwareSamples'), c);
  const f = (p) => (p <= 5.430 ? 3.85 : 5.27);           // 陸屋根 | 片流れ
  const ps = [5.3882, 5.5079];                             // 境をまたぐ1刻み
  const s = c.stepAwareSamples(f, ps);
  assert.equal(s.length, 4);
  const [lo, hi] = [s[1], s[2]];
  assert.ok(lo.pos > 5.430 && lo.pos < 5.4315, '低い点は境のすぐ先 ' + lo.pos);
  assert.equal(lo.y, 3.85);
  assert.ok(hi.pos - lo.pos <= 0.0011, '段は垂直(1mm) ' + (hi.pos - lo.pos));
  assert.equal(hi.y, 5.27);
  // 下り(高い側が手前)でも同じく高い側へ寄せる
  const g = (p) => (p <= 5.430 ? 5.27 : 3.85);
  const t = c.stepAwareSamples(g, ps);
  assert.ok(t[1].pos < 5.430 && t[2].pos < 5.430 && t[2].y === 3.85);
});

test('ふつうの勾配(27度)には段を入れない', () => {
  const c = vm.createContext({});
  vm.runInContext('var STEP_JUMP_MIN_M=0.02, STEP_JUMP_RATIO=4;\n' + sliceFunction('stepAwareSamples'), c);
  const ps = [0, 0.06, 0.12, 0.18];
  const s = c.stepAwareSamples((p) => 3 + p * Math.tan(27 * Math.PI / 180), ps);
  assert.equal(s.length, ps.length);
});

// 屋根の縁に2階の壁が立ち、その端が1階の外壁の上に載る隅。屋根は2階の壁の
// 内面から始まるので、1階の壁は2階の壁の下で立ち上がらず、隅が欠けていた。
test('上階の壁の足元だけ、屋根の縁の少し外でも立ち上げる', () => {
  const roof = { id: 'mono', type: 'roof', roofType: 'mono', floor: 2, x: 5430, y: 4615, w: 3730, d: 3640 };
  const lower = { id: 'w1', floor: 1, x1: 9100, y1: 4480, x2: 9100, y2: 8200, thick: 120 };
  const upper = { id: 'w2', floor: 2, x1: 9040, y1: 4550, x2: 9555, y2: 4550, thick: 120 };
  const c = vm.createContext({
    DATA: { walls: [lower, upper] },
    wallRaiseTopWorldY: (w, roofs, x, y) => (covers(roof, x, y) ? 5.98 : null),
  });
  vm.runInContext(sliceFunction('wallRaiseBridgeReachMm') + '\n' + sliceFunction('wallRaiseTopNearWorldY'), c);
  // 2階の壁の下(y=4550)と、壁の端の先(y=4474)は立ち上がる
  assert.equal(c.wallRaiseTopNearWorldY(lower, [roof], 9100, 4550), 5.98);
  assert.equal(c.wallRaiseTopNearWorldY(lower, [roof], 9100, 4474), 5.98);
  // 2階の壁が無ければ、屋根の縁の外では立ち上げない(屋根の上へ突き出さない)
  c.DATA.walls = [lower];
  assert.equal(c.wallRaiseTopNearWorldY(lower, [roof], 9100, 4550), null);
});
