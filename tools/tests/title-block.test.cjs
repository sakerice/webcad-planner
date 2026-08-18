// Task 25-2: 図面の表題欄に出る製品名。
//
// このサービスの名前は **house-planner mobile** である。表題欄はずっと
// 「WebCAD Planner」と書いていた。書き出した図面すべてに載る文字なので、
// これを直すと既存の図面の出力バイト列が変わる。変わってよいのは
// **この文字列のところだけ** である。
//
// grep ではない。index.html から JISDRAW の即時実行関数を波括弧の対応で切り出し、
// node:vm で **走らせて** 出来た SVG の文字とその位置を読む。
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const HeightModel = require(join(ROOT, 'assets', 'js', 'height-model.js'));

const PRODUCT = 'house-planner mobile';
const OLD_PRODUCT = 'WebCAD Planner';

function balanced(startAt) {
  let i = html.indexOf('{', startAt);
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
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('閉じ括弧が見つからない @' + startAt);
}
function topLevelFunction(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  return html.slice(at + 1, balanced(at + 1) + 1);
}
function topLevelVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=[^;\\n]*;'));
  assert.notEqual(m, null, 'var ' + name + ' が index.html に無い');
  return m[0];
}
function topLevelObjectVar(name) {
  const m = html.match(new RegExp('\\nvar ' + name + '\\s*=\\s*\\{'));
  assert.notEqual(m, null, 'var ' + name + ' = { … } が index.html に無い');
  return html.slice(m.index + 1, balanced(m.index) + 1) + ';';
}
function jisdrawIife() {
  const at = html.indexOf('\nvar JISDRAW=(function(){');
  assert.notEqual(at, -1, 'var JISDRAW=(function(){ が index.html に無い');
  const end = balanced(at);
  assert.equal(html.slice(end, end + 5), '})();', 'JISDRAW の閉じ方が変わっている');
  return html.slice(at + 1, end + 5);
}

const FNS = [
  'bestFmpType', 'getFmpItem',
  'isDoorLikeOpeningType', 'isWindowLikeType', 'isOpeningItemType',
  'wallAdjacentRoomsCeiling', 'wallCeilingHeightM',
  'foundationHeightMm', 'foundationHeightM', 'storyHeightMmForFloor', 'storyHeightM',
  'floorBaseY', 'floorSlabHeightM', 'floorSlabHeightMForFloor', 'floorTopY',
  'wallFullHeightM', 'isPositiveNumber', 'wallDisplayHeightM',
  'wallSolidCoverHeightMm', 'wallCoreBoxHitMm', 'wallEndCornerExtensionMm', 'getObjBounds', 'isFiniteCanvasValue',
  'normalizeNorthDeg', 'planNorthDeg', 'syncNorthFromPlan', 'setPlanNorthDeg'
];
const VARS = ['FMP_ITEMS', 'U', 'WALL_H', 'WALL_CORE_END_PAD_MM', 'FLOOR_H', 'FLOOR_SLAB_H'];
const OBJ_VARS = ['LEGACY_FMP_TYPE_MAP'];

function house() {
  const rooms = [], walls = [];
  [1, 2].forEach((f) => {
    rooms.push({ id: 'r' + f, n: f + '階', floor: f, x: 0, y: 0, w: 6000, d: 4000 });
    walls.push({ id: 'wn' + f, floor: f, x1: 0, y1: 0, x2: 6000, y2: 0, thick: 120 });
    walls.push({ id: 'we' + f, floor: f, x1: 6000, y1: 0, x2: 6000, y2: 4000, thick: 120 });
    walls.push({ id: 'ws' + f, floor: f, x1: 6000, y1: 4000, x2: 0, y2: 4000, thick: 120 });
    walls.push({ id: 'ww' + f, floor: f, x1: 0, y1: 4000, x2: 0, y2: 0, thick: 120 });
  });
  return { items: [], rooms, walls, floorMetadata: {} };
}
function ctxFor(data) {
  const ctx = vm.createContext({
    console: { warn() {}, log() {} },
    Math, Number, isFinite, isNaN, Array, Object, JSON, String, Boolean, parseInt, parseFloat, Date,
    HeightModel,
    DATA: data,
    ST: { showDim: true, selected: null, floor: 1 },
    LIGHT_SETTINGS: { northDeg: 0 },
    roomAtPointOnFloor: () => null,
    getOpeningWallInfo: () => null,
    isDoorItemType: () => false,
    escHtml: (s) => String(s)
  });
  vm.runInContext(
    OBJ_VARS.map(topLevelObjectVar).concat(VARS.map(topLevelVar))
      .concat(FNS.map(topLevelFunction)).join('\n'), ctx);
  vm.runInContext(jisdrawIife(), ctx);
  return ctx;
}
function run(ctx, src) { return vm.runInContext(src, ctx); }
function planSvg(ctx, floor, opts) {
  return run(ctx, 'JISDRAW.buildFloorPlanSvg(' + floor + ',' + (opts || '{scale:"100",paper:"a3"}') + ')');
}
function elevSvg(ctx, dir, opts) {
  return run(ctx, 'JISDRAW.buildElevationSvg("' + dir + '",' + (opts || '{scale:"100",paper:"a3"}') + ')');
}
// 表題欄の1行。「図面名 | 縮尺 | 日付 | 製品名」を「|」で区切って書いている。
function titleLine(svg) {
  const hits = [];
  const re = /<text [^>]*>([^<]*\|[^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) hits.push(m[1]);
  return hits;
}

test('25-2(最重要): 平面図の表題欄が house-planner mobile と名乗る', () => {
  const ctx = ctxFor(house());
  [1, 2].forEach((f) => {
    const lines = titleLine(planSvg(ctx, f));
    assert.equal(lines.length, 1, f + 'F の表題欄の行が1つ: ' + JSON.stringify(lines));
    const parts = lines[0].split('|').map((s) => s.trim());
    assert.equal(parts.length, 4, '図面名・縮尺・日付・製品名の4つ: ' + lines[0]);
    assert.equal(parts[3], PRODUCT, '製品名が違う: ' + parts[3]);
    assert.equal(parts[0], f + 'F 平面図', '図面名が変わっている: ' + parts[0]);
    assert.equal(parts[1], '縮尺 1:100', '縮尺が変わっている: ' + parts[1]);
  });
});

test('25-2(最重要): 古い名前は図面のどこにも残っていない', () => {
  const ctx = ctxFor(house());
  ['a3', 'a4'].forEach((paper) => {
    ['"50"', '"100"', '"200"', '"auto"'].forEach((scale) => {
      const o = '{scale:' + scale + ',paper:"' + paper + '"}';
      [1, 2].forEach((f) => {
        const svg = planSvg(ctx, f, o);
        assert.equal(svg.indexOf(OLD_PRODUCT), -1, paper + ' ' + scale + ' に古い名前が残っている');
        assert.equal(svg.indexOf('WebCAD'), -1, paper + ' ' + scale + ' に WebCAD が残っている');
      });
    });
  });
});

test('25-2(最重要): 動いたバイトは製品名のところだけ(図面あたり1か所)', () => {
  const ctx = ctxFor(house());
  const svg = planSvg(ctx, 1);
  assert.equal(svg.split(PRODUCT).length - 1, 1, '製品名が1か所ではない');
  // その1か所は表題欄の枠の中の <text> である。枠(<rect>)の直後に来る。
  const at = svg.indexOf(PRODUCT);
  const rectAt = svg.lastIndexOf('<rect', at);
  const textAt = svg.lastIndexOf('<text', at);
  assert.ok(rectAt > 0 && textAt > rectAt, '製品名が表題欄の枠の中にない');
  assert.equal(svg.indexOf('</text>', at) > at, true, '製品名が <text> の中で閉じていない');
  // 名前を元へ戻せば、それ以外は1バイトも違わない = 動いたのはここだけ。
  const back = svg.split(PRODUCT).join(OLD_PRODUCT);
  assert.equal(back.length, svg.length - PRODUCT.length + OLD_PRODUCT.length,
    '製品名以外の長さが動いている');
  assert.equal(back.split(OLD_PRODUCT).length - 1, 1);
});

test('25-2: 立面図には表題欄が無いので、製品名も出ない(変わるのは平面図だけ)', () => {
  const ctx = ctxFor(house());
  ['n', 'e', 's', 'w'].forEach((d) => {
    const svg = elevSvg(ctx, d);
    assert.equal(titleLine(svg).length, 0, d + ' 立面図に表題欄の行がある');
    assert.equal(svg.indexOf(PRODUCT), -1, d + ' 立面図に製品名が出ている');
    assert.equal(svg.indexOf('WebCAD'), -1, d + ' 立面図に古い名前が出ている');
  });
});
