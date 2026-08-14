// Task 12-4: 壁を15度刻みで置けるようにし、線上ドラッグで平行移動できるようにする。
//
// grep ではなく、index.html の snapWallAnglePoint / hitWallHandle / applyWallDrag を
// node:vm で**実際に走らせ**、返ってきた座標と DRAG の結果を測る。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
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
  throw new Error(name + ' の本体が閉じていない');
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}

const FNS = ['snapV', 'wallThicknessMm', 'addWallSnapCandidate', 'collectWallSnapAxes',
  'snapNumberToWallCandidates', 'snapWallPointToAxes', 'getWallAxisSnapThreshold',
  'snapWallAnglePoint', 'applyWallTranslate', 'hitWallHandle', 'applyWallDrag'];

// w2c は「世界mm → キャンバスpx」。本物は ST.pan/zoom を読むので、同じ規約の
// 最小実装を渡す(倍率 ST.zoom*0.05 px/mm は index.html 側の定数と同じ)。
function ctxFor(opts) {
  const o = opts || {};
  const data = { floors: {}, rooms: [], items: [], walls: o.walls || [] };
  const ST = { floor: 1, snap: o.snap === undefined ? 0 : o.snap, zoom: 20, panX: 0, panY: 0,
    selected: null, _snapState: null };
  const ctx = vm.createContext({
    console: console, DATA: data, ST: ST, Math: Math, Number: Number,
    isFinite: isFinite, isNaN: isNaN, Array: Array, Object: Object, JSON: JSON,
    EDGE_SNAP_THRESH: 80,
    DRAG: { active: false, saved: false, handle: null, startCX: 0, startCY: 0, origItem: null },
    w2c: function (x, y) { return { cx: ST.panX + x * (ST.zoom * 0.05), cy: ST.panY + y * (ST.zoom * 0.05) }; },
    c2w: function (cx, cy) { return { x: (cx - ST.panX) / (ST.zoom * 0.05), y: (cy - ST.panY) / (ST.zoom * 0.05) }; },
    isObjectLocked: function () { return false; },
    saveState: function () {},
    updateProps: function () {},
    planCaptureShows: function () { return true; },
    isShiftLike: function () { return false; }
  });
  vm.runInContext([topLevelVar('WALL_ANGLE_STEP_DEG')].concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  return ctx;
}

function angleOf(anchor, p) {
  let d = Math.atan2(p.y - anchor.y, p.x - anchor.x) * 180 / Math.PI;
  if (d < 0) d += 360;
  return d;
}

test('12-4: 壁は15度刻みで置ける（直角以外の角度が実際に出る）', () => {
  const ctx = ctxFor({});
  const anchor = { x: 0, y: 0 };
  const seen = new Set();
  // 半径3mの円周上を1度ずつ狙う。刻みが15度なら24通りの角度だけが返る。
  for (let deg = 0; deg < 360; deg++) {
    const rad = deg * Math.PI / 180;
    const p = ctx.snapWallAnglePoint(anchor, { x: 3000 * Math.cos(rad), y: 3000 * Math.sin(rad) }, {},
      { floor: 1, thickness: 120 });
    seen.add(Math.round(angleOf(anchor, p)) % 360);
  }
  const got = Array.from(seen).sort((a, b) => a - b);
  assert.equal(got.length, 24, '出た角度は ' + got.length + ' 通り: ' + got.join(','));
  got.forEach((d) => assert.equal(d % 15, 0, d + ' 度は15の倍数ではない'));
  // 直角しか置けなかった頃の振る舞い(0/90/180/270 のみ)ではないこと
  assert.ok(got.filter((d) => d % 90 !== 0).length === 20, '斜めの角度が足りない: ' + got.join(','));
});

test('12-4: 15度・30度・45度がそのままの角度で返る（丸めで崩れない）', () => {
  const ctx = ctxFor({ snap: 100 });
  const anchor = { x: 0, y: 0 };
  [15, 30, 45, 60, 75, 105, 135, 165, 195, 255, 300, 345].forEach((deg) => {
    const rad = deg * Math.PI / 180;
    // 刻みからわずかに外した点を狙っても、その刻みへ乗ること
    const p = ctx.snapWallAnglePoint(anchor,
      { x: 4000 * Math.cos(rad + 0.05), y: 4000 * Math.sin(rad + 0.05) }, {},
      { floor: 1, thickness: 120 });
    assert.ok(Math.abs(angleOf(anchor, p) - deg) < 1e-6,
      deg + ' 度を狙って ' + angleOf(anchor, p) + ' 度が返った');
  });
});

test('12-4: 直角のときの振る舞いは変えない（相手の壁の端点へ吸い付く）', () => {
  // x=2000 に南北の壁がある。東へ引くと、その端点(x=2000)へ吸い付く。
  const ctx = ctxFor({ walls: [{ id: 1, floor: 1, x1: 2000, y1: 0, x2: 2000, y2: 3000, thick: 120 }] });
  const p = ctx.snapWallAnglePoint({ x: 0, y: 0 }, { x: 1995, y: 20 }, {}, { floor: 1, thickness: 120 });
  assert.equal(p.y, 0, '真横に置かれていない');
  assert.equal(p.x, 2000, '相手の壁の端点へ吸い付いていない: ' + p.x);
});

test('12-4: 端点を掴めば端点だけ、線上を掴めば壁ごと動く（掴み分け）', () => {
  const w = { id: 1, floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120 };
  const ctx = ctxFor({ walls: [w] });
  const px = 20 * 0.05;                       // 1px = 1mm/px の逆数。ST.zoom=20 → 1mm=1px
  // 端点(0,0) の上
  assert.equal(ctx.hitWallHandle(w, 0, 0), 'wall-a');
  assert.equal(ctx.hitWallHandle(w, 4000 * px, 0), 'wall-b');
  // 線上のまんなか
  assert.equal(ctx.hitWallHandle(w, 2000 * px, 0), 'wall-move');
  // 線から十分離れたところ(壁の見た目の幅の外)は掴まない
  assert.equal(ctx.hitWallHandle(w, 2000 * px, 200), null);
});

test('12-4: 線上ドラッグで壁が平行移動する（向きと長さは変わらない）', () => {
  const w = { id: 1, floor: 1, x1: 500, y1: 700, x2: 4500, y2: 2700, thick: 120 };
  const ctx = ctxFor({ walls: [w], snap: 0 });
  ctx.ST.selected = w;
  ctx.DRAG.handle = 'wall-move';
  ctx.DRAG.startCX = 0; ctx.DRAG.startCY = 0;
  ctx.DRAG.origItem = JSON.parse(JSON.stringify(w));
  const scale = ctx.ST.zoom * 0.05;
  ctx.applyWallDrag(300 * scale, -150 * scale, {});
  assert.deepEqual([w.x1, w.y1, w.x2, w.y2], [800, 550, 4800, 2550]);
  // 平行移動なのでベクトルは不変
  assert.equal(w.x2 - w.x1, 4000);
  assert.equal(w.y2 - w.y1, 2000);
});

test('12-4: 端点ドラッグは今までどおり端点だけを動かす（もう片方は動かない）', () => {
  const w = { id: 1, floor: 1, x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120 };
  const ctx = ctxFor({ walls: [w], snap: 0 });
  ctx.ST.selected = w;
  ctx.DRAG.handle = 'wall-b';
  ctx.DRAG.startCX = 0; ctx.DRAG.startCY = 0;
  ctx.DRAG.origItem = JSON.parse(JSON.stringify(w));
  const scale = ctx.ST.zoom * 0.05;
  ctx.applyWallDrag(5000 * scale, 0, {});
  assert.equal(w.x1, 0, '始点が動いた');
  assert.equal(w.y1, 0, '始点が動いた');
  assert.equal(w.x2, 5000);
});
