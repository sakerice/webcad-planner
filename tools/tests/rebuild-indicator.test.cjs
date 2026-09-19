// 3Dの再構築が重いときに、待っていることを画面に出すかどうかの判定。
//
// なぜ在るのか
// ------------
// 「3Dで一時的に非表示」を押しても、なかなか反映されない、という報告。
// 待たせている間インジケーターを出す仕組みは既にあったのに、入口が
// isTouchInputDevice() で始まっていて、マウスのPCでは間取りがどれだけ
// 大きくても同期のまま走っていた（実測: 219アイテムの間取りで1回 700ms 超）。
//
// grep ではなく、判定そのものを node:vm で走らせて、実測値に応じて
// 答えが変わることを見る。
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
  assert.notEqual(m, null, 'var ' + name + ' が無い');
  return m[0];
}

// 間取りの大きさは同じまま、変わるのは「実測値」と「入力機器」だけにする。
function ctxFor(opts) {
  const items = [];
  for (let i = 0; i < 220; i++) items.push({ type: 'sofa' });
  const ctx = vm.createContext({
    ST: { view: opts.view || '3d-int' },
    DATA: { walls: new Array(80).fill({}), rooms: new Array(23).fill({}), items: items },
    GLTF_MAP: {},
    isFmpItemType: function () { return false; },
    isTouchInputDevice: function () { return !!opts.touch; }
  });
  vm.runInContext([topLevelVar('HEAVY_3D_REBUILD_MS'),
    'var _last3DRebuildMs=' + (opts.lastMs || 0) + ';',
    topLevelFunction('isLikelyHeavy3DRebuild')].join('\n'), ctx);
  return ctx;
}

test('実測が閾値を超えたら、マウスのPCでもインジケーターを出す', () => {
  const ctx = ctxFor({ touch: false, lastMs: 700 });
  assert.equal(ctx.isLikelyHeavy3DRebuild(), true);
});

test('速いと分かっている間取りには、毎回オーバーレイを出さない', () => {
  const ctx = ctxFor({ touch: false, lastMs: 12 });
  assert.equal(ctx.isLikelyHeavy3DRebuild(), false);
  // タッチ端末でも、実測が速いなら出さない（数え上げの当て推量より実測が強い）
  const t = ctxFor({ touch: true, lastMs: 12 });
  assert.equal(t.isLikelyHeavy3DRebuild(), false);
});

test('まだ一度も測っていないときは従来の当て推量（タッチ端末＋大きい間取り）', () => {
  assert.equal(ctxFor({ touch: true, lastMs: 0 }).isLikelyHeavy3DRebuild(), true);
  assert.equal(ctxFor({ touch: false, lastMs: 0 }).isLikelyHeavy3DRebuild(), false);
});

test('2Dを見ているときは3Dの再構築を待たせない', () => {
  assert.equal(ctxFor({ touch: true, lastMs: 900, view: '2d' }).isLikelyHeavy3DRebuild(), false);
});

// 実測値を書く側が消えたら、上の判定は永久に 0 のままになり静かに死ぬ。
test('再構築にかかった時間を実際に書き残している', () => {
  const body = topLevelFunction('perform3DRebuild');
  assert.match(body, /_last3DRebuildMs\s*=/);
  assert.match(body, /build3D\(\)/);
});

// フレームが来ない環境(背面タブ・ヘッドレス)では rAF が呼ばれない。
// そこに重い処理を預けたままにすると、画面はオーバーレイに覆われて止まる。
// 実測: ヘッドレス Chromium で 120 秒待っても進まなかった。
test('先送りした処理は、描画が来ない環境でもタイマーで必ず進む', () => {
  const body = topLevelFunction('runAfterNextPaint');
  assert.match(body, /requestAnimationFrame/);
  assert.match(body, /setTimeout\(once,\s*\d+\)/, '保険のタイマーが無い');
  // 二重実行しないこと
  assert.match(body, /done/);

  // 実際に走らせる: rAF が一度も呼ばれなくても、1回だけ実行される
  let ran = 0;
  const ctx = vm.createContext({
    requestAnimationFrame: undefined,
    setTimeout: (fn) => { fn(); },
    count: () => { ran++; }
  });
  vm.runInContext(topLevelFunction('runAfterNextPaint') + '\nrunAfterNextPaint(count);', ctx);
  assert.equal(ran, 1, 'rAF の無い環境で ' + ran + ' 回実行された');
});

// 重い再構築を同期のまま走らせたら、インジケーターを出しても意味が無い。
test('重いときは一度画面へ返してから再構築する', () => {
  const body = topLevelFunction('rebuild3D');
  assert.match(body, /isLikelyHeavy3DRebuild\(\)/);
  assert.match(body, /showAppLoading\(/);
  assert.match(body, /runAfterNextPaint\(/);
  assert.match(body, /hideAppLoading\(\)/);
});
