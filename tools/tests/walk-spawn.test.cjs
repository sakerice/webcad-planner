// ウォークスルーの開始位置と、ミニマップの文字かぶり。
//
// なぜ在るのか
// ------------
// 開始位置は「玄関ドアから内側0.9m」の決め打ちで、内開きの扉が開いた先と
// 重なっていた。実測(既定間取り): 開始直後の視界が平均輝度 4.8/255・
// 画素の100%が暗部・正面9cmに面、という真っ暗な状態だった。
// ミニマップは「○F タップで移動」を間取りの上に重ねて描いていた。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = require('./app-source.cjs').appSource();

function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
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

// ── 開始位置 ──────────────────────────────────────────────────────────
function obstructedCtx(items) {
  const ctx = vm.createContext({
    DATA: { items: items, rooms: [] },
    WALK_PLAYER_RADIUS_MM: 280,
    walkBlockedAt: () => false,
    roomFloorAt: () => 0,           // 探る点の床の高さ(当たり判定は上で無効にしてある)
    isPlanAnnotationType: (t) => t === 'memo' || t === 'ruler',
    isLightItemType: (t) => /^light-/.test(t),
    isPlacementSurfaceItem: () => false,
    isSwingDoorType: (t) => t === 'door-swing',
    isOpeningItemType: (t) => /^door-|^window/.test(t),
    getItemTopElevation: (it) => it.h == null ? 800 : it.h,
    // 足元 1m 四方を占める、という単純な当たり
    isInsideItem: (it, x, y) => Math.abs(x - it.x) <= 500 && Math.abs(y - it.y) <= 500
  });
  vm.runInContext([topLevelVar('WALK_SPAWN_MIN_OBSTACLE_MM'),
    topLevelVar('WALK_SPAWN_FLOORLIKE_TYPES'),
    topLevelFunction('walkSpawnObstructed')].join('\n'), ctx);
  return ctx;
}

test('内開きの扉が開いた先には立たない', () => {
  const c = obstructedCtx([{ type: 'door-swing', floor: 1, x: 1000, y: 1000 }]);
  assert.equal(c.walkSpawnObstructed(1000, 1000, 1), true);
});

test('引戸と窓は障害に数えない（床を占めないため）', () => {
  for (const t of ['door-slide', 'window']) {
    const c = obstructedCtx([{ type: t, floor: 1, x: 1000, y: 1000 }]);
    assert.equal(c.walkSpawnObstructed(1000, 1000, 1), false, t + ' を障害にしている');
  }
});

test('敷地・基礎・屋根は障害に数えない（階全体を覆うため逃げ場が消える）', () => {
  for (const t of ['site-rect', 'foundation', 'roof']) {
    const c = obstructedCtx([{ type: t, floor: 1, x: 1000, y: 1000 }]);
    assert.equal(c.walkSpawnObstructed(1000, 1000, 1), false, t + ' を障害にしている');
  }
});

test('腰高より低いもの（ラグ等）は跨げる', () => {
  const c = obstructedCtx([{ type: 'custom-block', floor: 1, x: 1000, y: 1000, h: 100 }]);
  assert.equal(c.walkSpawnObstructed(1000, 1000, 1), false);
});

test('肩幅ぶん離れていない家具も障害に数える', () => {
  // 点そのものは家具の外(560mm離れ)だが、肩幅280mmを足すと触れる
  const c = obstructedCtx([{ type: 'sofa', floor: 1, x: 1000, y: 1000 }]);
  assert.equal(c.walkSpawnObstructed(1560, 1000, 1), true);
});

// ── 開始時の向き ──────────────────────────────────────────────────────
test('狙いから90度を超える向きは選ばない（玄関から屋外を向かない）', () => {
  const ctx = vm.createContext({
    // 「後ろ」だけが延々と開けている＝玄関から屋外、という状況
    walkBlockedAt: (x, z) => !(z > 0),
    roomFloorAt: () => 0
  });
  vm.runInContext(topLevelFunction('walkBestFacing'), ctx);
  const prefer = 0;                       // 家の中は yaw 0 の側
  const yaw = ctx.walkBestFacing(0, 0, 1, prefer);
  const diff = Math.abs(((yaw - prefer + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff <= Math.PI / 2 + 1e-9, '狙いから ' + Math.round(diff * 180 / Math.PI) + '度 離れた向きを選んだ');
});

// ── ミニマップ ────────────────────────────────────────────────────────
test('間取りがどんな形でも、ミニマップの文字の帯には入らない', () => {
  const band = Number(topLevelVar('WALK_MAP_LABEL_BAND').match(/=\s*(\d+)/)[1]);
  for (const [w, d] of [[9100, 9100], [20000, 3000], [3000, 20000], [500, 500], [1, 1]]) {
    const ctx = vm.createContext({
      WALK: { floor: 1 },
      DATA: { walls: [{ floor: 1, x1: 0, y1: 0, x2: w, y2: d }] },
      WALK_MAP_LABEL_BAND: band,
      document: { getElementById: () => ({ width: 220, height: 176 }) }
    });
    vm.runInContext(topLevelFunction('walkMapTransform'), ctx);
    const t = ctx.walkMapTransform();
    assert.ok(t.oy >= band - 1e-9,
      `間取り ${w}x${d} の上端が ${t.oy.toFixed(1)}px で、文字の帯 ${band}px に食い込んでいる`);
  }
});
