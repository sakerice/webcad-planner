// 出隅(L字)で壁のコアが角を閉じているか。
//
// 壁は芯線から thick/2 の箱として立つ。直交する2枚の芯線の端を同じ点に置くと、
// 横壁の箱は x0..len / y-60..+60、縦壁の箱は x-60..+60 / y0..len になり、
// x-60..0 かつ y-60..0 の「厚/2 × 厚/2」が **どちらにも入らない**。
// 角が四角く欠け、平面図でも3Dでも階段状に見える。
//
// grep では通ってしまうので、index.html から関数を切り出して node:vm で
// 実際に走らせ、延長量を数値で見る。
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

function ctxWith(walls) {
  const ctx = vm.createContext({ DATA: { walls: walls }, Math: Math,
                                Number: Number, isFinite: isFinite });
  vm.runInContext(
    [topLevelVar('WALL_H'), topLevelVar('WALL_CORE_END_PAD_MM'),
     topLevelFunction('isPositiveNumber'),
     topLevelFunction('wallSolidCoverHeightMm'),
     topLevelFunction('wallCoreBoxHitMm'),
     topLevelFunction('wallEndCornerExtensionMm')].join('\n'), ctx);
  return ctx;
}
function ext(ctx, w, atEnd) {
  ctx.__w = w;
  ctx.__e = atEnd;
  return vm.runInContext('wallEndCornerExtensionMm(__w,__e)', ctx);
}

const T = 120;
function wall(x1, y1, x2, y2, id) {
  return { id: id, x1: x1, y1: y1, x2: x2, y2: y2, floor: 1, thick: T };
}

test('L字の出隅は、相手の厚みの半分だけ伸ばして角を閉じる', () => {
  const a = wall(0, 0, 4000, 0, 'A');       // 東西。始端が出隅
  const b = wall(0, 3000, 0, 0, 'B');       // 南北。終端が出隅
  const ctx = ctxWith([a, b]);
  assert.equal(ext(ctx, a, false), T / 2, 'A の始端が伸びていない = 角が欠ける');
  assert.equal(ext(ctx, b, true), T / 2, 'B の終端が伸びていない = 角が欠ける');
  // 出隅でない側(自由端)は伸ばさない
  assert.equal(ext(ctx, a, true), 0);
  assert.equal(ext(ctx, b, false), 0);
});

test('T字は伸ばさない。伸ばすと相手の反対側の面から断面が顔を出す', () => {
  const through = wall(0, 0, 4000, 0, 'THRU');
  const branch = wall(2000, 0, 2000, 3000, 'BR');   // 途中に突き当たる
  const ctx = ctxWith([through, branch]);
  assert.equal(ext(ctx, branch, false), 0,
    'T字で伸ばすと外壁のファサードに内壁の断面が帯として出る');
});

test('通し壁が2枚に分かれた点への突き当たりも伸ばさない(既に埋まっている)', () => {
  // 南外壁が x=2000 で2枚に分かれ、そこへ背骨の壁が北から突き当たる形。
  // 「相手も端で出会っている」だけを見ると誤って伸ばしてしまうケース。
  const sw = wall(0, 5000, 2000, 5000, 'SW');
  const se = wall(2000, 5000, 4000, 5000, 'SE');
  const spine = wall(2000, 0, 2000, 5000, 'SPINE');
  const ctx = ctxWith([sw, se, spine]);
  assert.equal(ext(ctx, spine, true), 0,
    '既に南外壁で埋まっているので伸ばしてはいけない');
});

test('面合わせ(端点を相手の外面まで描いたプラン)では伸ばさない', () => {
  // 旧既定プランや手描きのプランは、壁の端点を相手の**外面**まで描いてある。
  // そこへ一律 厚/2 を足すと外装面から60mm突き出す(実測57箇所)。
  // 延長量は「相手の外面までの実距離」なので、既に届いていれば0になる。
  const b = wall(0, 0, 0, 3000, 'B');
  const a = wall(-60, 0, 4000, 0, 'A');      // 始端がBの外面(x=-60)に乗っている
  const ctx = ctxWith([a, b]);
  assert.equal(ext(ctx, a, false), 0, '面まで届いている端をさらに伸ばしている');
});

test('中途半端に離れた端は、相手の外面までの残り距離だけ伸ばす', () => {
  const b = wall(0, 0, 0, 3000, 'B');
  const a = wall(-30, 0, 4000, 0, 'A');      // 外面まで残り30mm
  const ctx = ctxWith([a, b]);
  assert.equal(ext(ctx, a, false), 30);
});

test('斜め(非直角)の突き当たりは伸ばさない(箱では留めが切れない)', () => {
  const through = wall(0, 0, 4000, 0, 'T');
  const diag = wall(500, 0, 3000, 2500, 'D');  // 45度で突き当たる
  const ctx = ctxWith([through, diag]);
  assert.equal(ext(ctx, diag, false), 0,
    '斜め壁に箱を伸ばすと先端の角が相手の面から三角にはみ出す');
});

test('平行な継ぎ足しは角を作らないので伸ばさない', () => {
  const a = wall(0, 0, 2000, 0, 'A');
  const b = wall(2000, 0, 4000, 0, 'B');
  const ctx = ctxWith([a, b]);
  assert.equal(ext(ctx, a, true), 0);
  assert.equal(ext(ctx, b, false), 0);
});

test('どの壁とも出会わない自由端は伸ばさない', () => {
  const a = wall(0, 0, 2000, 0, 'A');
  const ctx = ctxWith([a]);
  assert.equal(ext(ctx, a, false), 0);
  assert.equal(ext(ctx, a, true), 0);
});

test('現実的な間取り(フィクスチャ)の外周4隅がすべて閉じている', () => {
  const plan = JSON.parse(
// 間取りは凍結フィクスチャを読む。出荷する assets/default_plan.json を
// 直接読むと、既定間取りを良くするたびにここが落ちる(役割は tools/tests/fixtures/README.md)。
    readFileSync(join(__dirname, 'fixtures', 'house-2f.json'), 'utf8'));
  const ctx = ctxWith(plan.walls);
  const BW = 8190, BD = 7280;
  const corners = [[0, 0], [BW, 0], [BW, BD], [0, BD]];
  for (const fl of [1, 2]) {
    for (const [cx, cy] of corners) {
      // その隅に端を持つ壁のうち、少なくとも1枚は伸びていなければ角が欠ける
      const at = plan.walls.filter(w =>
        (w.floor || 1) === fl &&
        ((w.x1 === cx && w.y1 === cy) || (w.x2 === cx && w.y2 === cy)));
      assert.ok(at.length >= 2, `${fl}F (${cx},${cy}) に壁が2枚来ていない`);
      const grown = at.some(w =>
        (w.x1 === cx && w.y1 === cy && ext(ctx, w, false) > 0) ||
        (w.x2 === cx && w.y2 === cy && ext(ctx, w, true) > 0));
      assert.ok(grown, `${fl}F (${cx},${cy}) の出隅が閉じていない`);
    }
  }
});

test('平面図(drawWall2d)とJIS図面(wallsToSvg)の両方が同じ延長を使う', () => {
  // 3Dだけ直して平面図を直し忘れる、という取りこぼしを止める
  const draw = topLevelFunction('drawWall2d');
  assert.match(draw, /wallEndCornerExtensionMm\(w,false\)/);
  assert.match(draw, /wallEndCornerExtensionMm\(w,true\)/);
  const svg = html.slice(html.indexOf('function wallsToSvg'),
                         html.indexOf('function wallsToSvg') + 1600);
  assert.match(svg, /wallEndCornerExtensionMm\(w,false\)/);
  assert.match(svg, /wallEndCornerExtensionMm\(w,true\)/);
});
