// レビューで見つけた作りの問題の再発防止。
//   ・外の判定(getWallOutsideGrid)は壁の厚みを見る(芯線で接していない角から漏れない)
//   ・部屋の細い重なりは、壁に隠れるときだけ数えない
//   ・勾配天井が沿う屋根は、部屋にかかるいちばん低い段の屋根
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

// 4000角の箱。北の壁の東端は、東の壁の芯より 70mm 手前(芯線で接していない)。
function leakyBox() {
  return [
    { floor: 1, x1: 0, y1: 0, x2: 3930, y2: 0, thick: 120 },        // 北(東端が 70mm 足りない)
    { floor: 1, x1: 4000, y1: 60, x2: 4000, y2: 4000, thick: 120 },  // 東(北端も 60mm 下がっている)
    { floor: 1, x1: 4000, y1: 4000, x2: 0, y2: 4000, thick: 120 },
    { floor: 1, x1: 0, y1: 4000, x2: 0, y2: 0, thick: 120 },
  ];
}
function outsideCtx(walls) {
  const c = vm.createContext({ DATA: { walls }, Math, Array });
  vm.runInContext([
    'var _wallOutsideGridCache={};',
    'function wallNetworkSignature(){return "s";}',
    'function getFloorWallBounds(){return {minX:0,minY:0,maxX:4000,maxY:4000};}',
    sliceFunction('segOrient'), sliceFunction('isOnSeg'), sliceFunction('segmentsIntersect'),
    sliceFunction('getWallOutsideGrid'), sliceFunction('isPointOutsideWallNetworkRaw'),
  ].join('\n'), c);
  return c;
}

test('壁が芯線で接していない角(厚みで閉じている)から、外が家の中へ流れ込まない', () => {
  const c = outsideCtx(leakyBox());
  assert.equal(c.isPointOutsideWallNetworkRaw(2000, 2000, 1), false, '箱の中が外になっている');
  assert.equal(c.isPointOutsideWallNetworkRaw(-500, 2000, 1), true);
});

test('人が通れる幅の本当の開口からは、従来どおり外が入る', () => {
  const walls = leakyBox();
  walls[2] = { floor: 1, x1: 4000, y1: 4000, x2: 1000, y2: 4000, thick: 120 }; // 南の西 1000mm が開口
  const c = outsideCtx(walls);
  assert.equal(c.isPointOutsideWallNetworkRaw(2000, 2000, 1), true);
});

function overlapCtx(walls) {
  const c = vm.createContext({ DATA: { walls }, Math });
  vm.runInContext([topLevelVar('ROOM_OVERLAP_EPS_MM'), topLevelVar('ROOM_OVERLAP_WALL_TOL_MM'),
    sliceFunction('segmentInsideRectLengthMm'), sliceFunction('overlapStripHiddenByWall'),
    sliceFunction('roomsOverlapInPlan')].join('\n'), c);
  return c;
}
const below = { floor: 1, x: 0, y: 3650, w: 1860, d: 910 };
const above = { floor: 2, x: 0, y: 2790, w: 1860, d: 910 };   // 下の部屋に 50mm かかる

test('細い重なりでも、沿う壁が無ければ重なりとして数える', () => {
  assert.equal(overlapCtx([]).roomsOverlapInPlan(below, above), true);
});

test('細い重なりに沿って壁が立っていれば(壁の中に隠れる)、重なりとして数えない', () => {
  const wall = { floor: 1, x1: 0, y1: 3640, x2: 1860, y2: 3640, thick: 120 };
  assert.equal(overlapCtx([wall]).roomsOverlapInPlan(below, above), false);
});

test('太い重なりは、壁があっても重なりとして数える', () => {
  const deep = { floor: 2, x: 0, y: 2790, w: 1860, d: 1400 };
  const wall = { floor: 1, x1: 0, y1: 3640, x2: 1860, y2: 3640, thick: 120 };
  assert.equal(overlapCtx([wall]).roomsOverlapInPlan(below, deep), true);
});

test('中心に上の段の屋根がかかっていても、端にかかる下の段の屋根(下屋)に天井が沿う', () => {
  const upper = { id: 'up', type: 'roof', floor: 3, x: 0, y: 0, w: 4000, d: 3000 };
  const lean = { id: 'lean', type: 'roof', floor: 2, x: 0, y: 3000, w: 4000, d: 1000 };
  const room = { floor: 1, x: 0, y: 0, w: 4000, d: 4000 };
  const covers = (rf, x, y) => x >= rf.x && x <= rf.x + rf.w && y >= rf.y && y <= rf.y + rf.d;
  const c = vm.createContext({
    DATA: { items: [upper, lean] }, roofItemOverRoom: () => upper,
    roofCoversPlanPoint: covers, roofCeilingWorldYAt: () => 5, floorTopY: () => 0,
  });
  vm.runInContext(sliceFunction('roofsOverRoom'), c);
  assert.equal(c.roofsOverRoom(room).map((r) => r.id).join(','), 'lean');
});
