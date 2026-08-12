// Task 21-4: 定規ツールの数値をあとから入れ直せることを、**実行して**確かめる。
//
// grep ではない。index.html から関数を切り出して node:vm で走らせ、
// 定規アイテムの座標と、描画で呼ばれた canvas の操作を読む。
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
  let i = html.indexOf('{', start);
  let depth = 0, mode = null;
  for (; i < html.length; i++) {
    const c = html[i], n = html[i + 1];
    if (mode === 'line') { if (c === '\n') mode = null; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
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

const VARS = ['RULER_THICKNESS_MM', 'RULER_MIN_LEN_MM', 'RULER_MAX_LEN_MM'];
const FNS = ['rulerLengthMm', 'rulerEndPointsMm', 'updateSelectedRulerLength'];

function makeCtx(item, opts) {
  const o = opts || {};
  const ops = [];
  const rec = (name) => function () { ops.push(name); };
  const ctx2d = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    lineJoin: '', miterLimit: 0, globalAlpha: 1,
    save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    stroke: rec('stroke'), fill: rec('fill'),
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), rect: rec('rect'),
    roundRect: rec('roundRect'),
    fillText: rec('fillText'), strokeText: rec('strokeText'),
    measureText: function () { return { width: 40 }; }
  };
  const saved = [];
  const drawn = [];
  const c = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String,
    ctx: ctx2d,
    ST: { selected: item, zoom: 2, showDim: true },
    DATA: { items: item ? [item] : [], rooms: [], walls: [] },
    saveState: function () { saved.push(1); },
    draw2d: function () { drawn.push(1); },
    updateProps: function () {},
    isObjectLocked: function () { return !!o.locked; },
    rebuild3D: function () {},
    ren: null,
  });
  vm.runInContext(VARS.map(topLevelVar).concat(FNS.map(topLevelFunction)).join('\n'), c);
  return { ctx: c, ops, saved, drawn };
}
function run(h, src) { return vm.runInContext(src, h.ctx); }

// 置いたときと同じ作り: 中心 ± 向き×長さ/2。ここでは条文ではなく幾何から独立に立てる。
function ruler(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const rot = Math.atan2(dy, dx) * 180 / Math.PI;
  return { type: 'ruler', id: 'r', floor: 1, rot,
    x: (x1 + x2) / 2 - len / 2, y: (y1 + y2) / 2 - 120 / 2, w: len, d: 120 };
}

// ══ 21-4 定規の数値をあとから入れ直せる ═══════════════════════════════
test('21-4(最重要): 測定長さを入れ直すと、その長さになる', () => {
  const it = ruler(1000, 2000, 4000, 2000);
  const h = makeCtx(it);
  assert.equal(Math.round(run(h, 'rulerLengthMm(ST.selected)')), 3000);
  run(h, 'updateSelectedRulerLength(5250)');
  assert.equal(Math.round(run(h, 'rulerLengthMm(ST.selected)')), 5250);
});

test('21-4(最重要): 入れ直しても1点目は1mmも動かず、2点目だけが伸びる', () => {
  [[1000, 2000, 4000, 2000], [0, 0, 3000, 4000], [5000, 1000, 2000, 3000]].forEach((p) => {
    const it = ruler(p[0], p[1], p[2], p[3]);
    const h = makeCtx(it);
    const before = run(h, 'rulerEndPointsMm(ST.selected)');
    assert.ok(Math.abs(before.a.x - p[0]) < 1e-6 && Math.abs(before.a.y - p[1]) < 1e-6,
      '前提: 1点目は置いたところ ' + JSON.stringify(before.a));
    run(h, 'updateSelectedRulerLength(7000)');
    const after = run(h, 'rulerEndPointsMm(ST.selected)');
    assert.ok(Math.abs(after.a.x - p[0]) < 1e-6 && Math.abs(after.a.y - p[1]) < 1e-6,
      '1点目が動いた: ' + JSON.stringify(after.a));
    // 2点目は同じ向きに、指定の長さだけ離れたところ。
    const ux = (p[2] - p[0]) / Math.hypot(p[2] - p[0], p[3] - p[1]);
    const uy = (p[3] - p[1]) / Math.hypot(p[2] - p[0], p[3] - p[1]);
    assert.ok(Math.abs(after.b.x - (p[0] + ux * 7000)) < 1e-6, 'x: ' + after.b.x);
    assert.ok(Math.abs(after.b.y - (p[1] + uy * 7000)) < 1e-6, 'y: ' + after.b.y);
  });
});

test('21-4: 入れ直しは Undo に積まれ、2Dを描き直す', () => {
  const it = ruler(1000, 2000, 4000, 2000);
  const h = makeCtx(it);
  run(h, 'updateSelectedRulerLength(2500)');
  assert.equal(h.saved.length, 1, 'saveState が呼ばれていない = Undo で戻せない');
  assert.ok(h.drawn.length >= 1, 'draw2d が呼ばれていない = 画面が追随しない');
});

test('21-4: 数でない値・範囲の外は効かない（黙って壊れた定規にしない）', () => {
  const it = ruler(1000, 2000, 4000, 2000);
  const h = makeCtx(it);
  run(h, 'updateSelectedRulerLength("abc")');
  assert.equal(Math.round(run(h, 'rulerLengthMm(ST.selected)')), 3000, '数でない値が通った');
  run(h, 'updateSelectedRulerLength(0)');
  assert.equal(run(h, 'rulerLengthMm(ST.selected)'), 1, '下限へ丸めていない');
  run(h, 'updateSelectedRulerLength(1e9)');
  assert.equal(run(h, 'rulerLengthMm(ST.selected)'), 200000, '上限へ丸めていない');
});

test('21-4: ロックした定規は数値でも動かない', () => {
  const it = ruler(1000, 2000, 4000, 2000);
  const h = makeCtx(it, { locked: true });
  run(h, 'updateSelectedRulerLength(9000)');
  assert.equal(Math.round(run(h, 'rulerLengthMm(ST.selected)')), 3000);
  assert.equal(h.saved.length, 0);
});
