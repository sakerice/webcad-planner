// 片引き戸の引き込み側。戸は開口の横へ開口幅ぶん滑るので、そこが壁に
// 納まっているかを測る(slideDoorPocketInfo)。読み取った下書きでは、壁のある側へ
// 向け直す(orientSlideInDoorsToWalls)。利用者のプランの形で押さえる。
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
function ctx(walls, items) {
  const c = vm.createContext({
    DATA: { walls, items },
    isWindowLikeType: (t) => t === 'window',
    isDoorLikeOpeningType: (t) => /^door-/.test(t),
  });
  vm.runInContext(['isOpeningItemType', 'getOpeningCenterCandidates', 'getOpeningWallInfo',
    'isSlideInDoorType', 'slideDoorPocketInfo', 'orientSlideInDoorsToWalls'].map(sliceFunction).join('\n'), c);
  return c;
}
// 東西の壁 0..4095 (y=3640)。片引き戸A(開口 940..1790)と、右隣の片引き戸B(2320..3140)。
// A を右へ引くと B の開口にかかる。左へ引けば壁の中。
const wall = { id: 'w', floor: 1, x1: 0, y1: 3640, x2: 4095, y2: 3640, thick: 120 };
const doorA = () => ({ id: 'A', type: 'door-slide-s', floor: 1, x: 940, y: 3565, w: 850, d: 150, rot: 0 });
const doorB = () => ({ id: 'B', type: 'door-slide-s', floor: 1, x: 2320, y: 3565, w: 820, d: 150, rot: 0 });

test('引き込む側にほかの開口があると、その分だけ壁が足りない', () => {
  const a = doorA(), b = doorB();
  const c = ctx([wall], [a, b]);
  const right = c.slideDoorPocketInfo(a, 1), left = c.slideDoorPocketInfo(a, -1);
  assert.ok(right.missingMm > 300 && right.missingMm < 340, '右: ' + right.missingMm);
  assert.equal(left.missingMm, 0);
});

test('壁の端の先へ引くときは、壁を延ばせば足りると分かる', () => {
  const short = Object.assign({}, wall, { x2: 2000 });
  const b = doorB(); b.x = 1000;               // 開口 1000..1820、右の引き代は 1820..2640
  const c = ctx([short], [b]);
  const info = c.slideDoorPocketInfo(b, 1);
  assert.ok(info.missingMm > 600);
  assert.equal(info.extendable, true);
});

test('読み取った片引き戸は、壁のある側へ引くように向け直す', () => {
  const a = doorA(), b = doorB();
  const c = ctx([wall], [a, b]);
  c.orientSlideInDoorsToWalls([a, b]);
  assert.equal(a.flipX, true, 'A は左(始点側)へ引くべき');
  assert.equal(!!b.flipX, false, 'B は右のままで壁に納まる');
});
