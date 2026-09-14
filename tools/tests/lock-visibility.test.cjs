// 編集ロック中でも「3Dで一時的に非表示」は使えること。
//
// なぜ在るのか
// ------------
// 3D表示の一時切り替えを、パネルの他の入力と一緒に disabled にしていた。
// 照明・キッチン・浴室などは「住設」カテゴリでまとめてロックできるので、
// そこをロックしたユーザーには「照明だけ3Dから外せない」という形で出た。
// まとめて戻す clearAll3DHidden は最初からロックを見ていないので、
// 片方だけがロックを見ている状態でもあった。
//
// ロックが止めるのは削除・移動・寸法/座標変更（ロック中の注記もそう名乗る）。
// 見えているかどうかは間取りの形を変えないので、ロック中でも通す。
//
// grep ではなく、切り出した関数を node:vm で**走らせて**確かめる。
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
// ── パネルの HTML: 3つの経路すべてがロック中も操作できる印を持つ ──────────
test('3D表示の操作はロック中でも有効（壁・部屋・アイテムの3経路とも）', () => {
  const ctx = vm.createContext({});
  vm.runInContext(topLevelFunction('selectedVisibilityControlHtml'), ctx);
  const wall = ctx.selectedVisibilityControlHtml({ x1: 0, y1: 0, x2: 1000, y2: 0 });
  const room = ctx.selectedVisibilityControlHtml({ type: 'room' });
  const light = ctx.selectedVisibilityControlHtml({ type: 'light-ceiling' });
  for (const [name, out] of [['壁', wall], ['部屋', room], ['照明', light]]) {
    assert.match(out, /data-lock-control/, name + 'の3D表示がロック中に無効化される');
  }
  // 名乗りは変えない（ユーザーが探す文言）
  assert.match(light, /3Dで一時的に非表示/);
  assert.match(wall, /一時的に非表示/);
});

// ── 実際の書き込み: ロック中に何が通り、何が止まるか ──────────────────────
function propCtx(selected) {
  const calls = { draw: 0, rebuild: 0, saved: 0 };
  const ctx = vm.createContext({
    ST: { selected: selected },
    ren: { fake: true },
    console: console,
    isObjectLocked: function (o) { return !!(o && o.locked); },
    setObjectLocked: function (o, v) { o.locked = !!v; },
    syncLockBatchUi: function () {},
    saveState: function () { calls.saved++; },
    draw2d: function () { calls.draw++; },
    rebuild3D: function () { calls.rebuild++; },
    updateProps: function () {},
    isAppearanceColorInputActive: function () { return false; },
    markAppearanceColorDirty: function () {},
    scheduleAppearancePreviewUpdate: function () {},
    isLightItemType: function (t) { return /^light-/.test(t); },
    isWindowLikeType: function (t) { return t === 'window' || t === 'window-door'; },
    normalizeWindowVerticalProps: function () {},
    windowSillMm: function () { return 0; },
    isPositiveNumber: function (n) { return typeof n === 'number' && n > 0; },
    getExteriorWallSetting: function () { return {}; }
  });
  vm.runInContext(topLevelFunction('updateSelectedProp'), ctx);
  ctx.$calls = calls;
  return ctx;
}

test('ロックした照明でも 3D の一時非表示は ON/OFF できる', () => {
  const light = { id: 7, type: 'light-ceiling', w: 600, d: 600, locked: true };
  const ctx = propCtx(light);
  ctx.updateSelectedProp('hidden3D', true);
  assert.equal(light.hidden3D, true, 'ロック中に非表示にできない');
  ctx.updateSelectedProp('hidden3D', false);
  assert.equal(light.hidden3D, false, 'ロック中に戻せない');
  assert.ok(ctx.$calls.rebuild >= 2, '3Dが組み直されていない');
});

test('壁の3D表示の上書きもロック中に通る', () => {
  const wall = { id: 3, x1: 0, y1: 0, x2: 1000, y2: 0, locked: true };
  const ctx = propCtx(wall);
  ctx.updateSelectedProp('vis3D', 'hide');
  assert.equal(wall.vis3D, 'hide');
});

// ロックの意味そのものは壊さない。ここが緩むと「ロックしたのに動いた」になる。
test('ロック中は寸法・座標・色は止まったまま', () => {
  const item = { id: 9, type: 'sofa', w: 2000, d: 900, x: 100, y: 200, locked: true };
  const ctx = propCtx(item);
  ctx.updateSelectedProp('w', 2500);
  ctx.updateSelectedProp('x', 500);
  ctx.updateSelectedProp('color', '#ff0000');
  assert.equal(item.w, 2000);
  assert.equal(item.x, 100);
  assert.equal(item.color, undefined);
  assert.equal(ctx.$calls.saved, 0, 'ロック中に undo 履歴が積まれている');
});

test('ロックを外す操作自体はロック中でも通る', () => {
  const item = { id: 9, type: 'sofa', locked: true };
  const ctx = propCtx(item);
  ctx.updateSelectedProp('locked', false);
  assert.equal(item.locked, false);
});
