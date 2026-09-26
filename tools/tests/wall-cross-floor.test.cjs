// 階をまたぐ壁の角のつなぎ方(wallJoinsAtCorner)。
//   ・下の階の壁が、その角で上の階の壁の頭まで届いているときだけつなぐ。途中まで
//     しか届かない相手に端を合わせると、その上で角が欠けた(2階の出隅に60mm角)。
//   ・高さは重い計算なので、角を成すと分かった相手にだけ行う。距離・角度より先に
//     高さを見ていたせいで、2階を表示した平面図の再描画が1回100秒を超えた。
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
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が無い');
  return m[0];
}
function ctx(walls, calls) {
  const c = vm.createContext({
    DATA: { walls }, Math, U: 0.001,
    _roofBaseCache: null,
    floorBaseY: (f) => (f === 1 ? 0.45 : 3.318),
    wallDisplayHeightM: (w) => w._h,
    wallRaiseRoofs: (w) => (w._raise ? [{}] : []),
    wallTopWorldYAtPointM: (w) => { calls.n++; return w._topAt; },
    wallSolidCoverHeightMm: (w) => w._h * 1000,
  });
  vm.runInContext([topLevelVar('WALL_CORE_END_PAD_MM')].concat(
    ['wallCoreBoxHitMm', 'wallJoinsAtCorner', 'wallEndCornerExtensionMm'].map(sliceFunction)).join('\n'), c);
  return c;
}
// 2階の壁(東西)の西端が、1階の壁(南北)の上に載る角。
const upper = { id: 'u', floor: 2, x1: 0, y1: 4550, x2: 3000, y2: 4550, thick: 120, _h: 2.688 };   // 頭 6.006
function lower(extra) {
  return Object.assign({ id: 'l', floor: 1, x1: 0, y1: 4480, x2: 0, y2: 8200, thick: 120, _h: 3.68 }, extra);
}

test('同じ階の壁はつなぐ(高さを見ない)', () => {
  const calls = { n: 0 };
  const same = { id: 's', floor: 2, x1: 0, y1: 4480, x2: 0, y2: 8200, thick: 120, _h: 2.688 };
  const c = ctx([upper, same], calls);
  assert.equal(c.wallJoinsAtCorner(same, upper, 0, 4550), true);
  assert.equal(calls.n, 0);
});

test('屋根まで立ち上がって上の階の壁の頭まで届く下の階の壁とは、つなぐ', () => {
  const calls = { n: 0 };
  const l = lower({ _raise: true, _topAt: 5.98 });
  assert.equal(ctx([upper, l], calls).wallJoinsAtCorner(l, upper, 0, 4550), true);
});

test('途中までしか届かない下の階の壁とは、つながない(上の階の壁が自分で角を閉じる)', () => {
  const calls = { n: 0 };
  const raisedShort = lower({ _raise: true, _topAt: 4.13 });
  assert.equal(ctx([upper, raisedShort], calls).wallJoinsAtCorner(raisedShort, upper, 0, 4550), false);
  // 立ち上げない壁は、上端を求めるまでもなく落ちる
  const plain = lower({ _topAt: 99 });
  const c2 = { n: 0 };
  assert.equal(ctx([upper, plain], c2).wallJoinsAtCorner(plain, upper, 0, 4550), false);
  assert.equal(c2.n, 0, '立ち上げない壁の上端を求めている');
});

test('2つ下の階の壁や、位置を渡さない呼び出しでは、階をまたいでつながない', () => {
  const calls = { n: 0 };
  const l = lower({ _raise: true, _topAt: 99 });
  const c = ctx([upper, l], calls);
  assert.equal(c.wallJoinsAtCorner(l, upper), false);
  const third = Object.assign({}, upper, { floor: 3 });
  assert.equal(c.wallJoinsAtCorner(l, third, 0, 4550), false);
});

test('角を成さない下の階の壁の高さは求めない(平面図の再描画を重くしない)', () => {
  const calls = { n: 0 };
  const walls = [upper];
  // 角から離れた、屋根まで立ち上がる1階の壁を50枚。
  for (let i = 0; i < 50; i++) walls.push(lower({ id: 'far' + i, x1: 20000 + i * 1000, x2: 20000 + i * 1000, _raise: true, _topAt: 99 }));
  const c = ctx(walls, calls);
  c.wallEndCornerExtensionMm(upper, false);
  c.wallEndCornerExtensionMm(upper, true);
  assert.equal(calls.n, 0, '離れた壁の上端を ' + calls.n + ' 回求めた');
});
