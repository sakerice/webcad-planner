const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

function captureFnBody() {
  const i = html.indexOf('function capturePlan2dDataUrl');
  assert.notEqual(i, -1, 'capturePlan2dDataUrl が見つからない');
  const rest = html.slice(i);
  const end = rest.indexOf('\nfunction ');
  return end === -1 ? rest : rest.slice(0, end);
}

test('capturePlan2dDataUrl が存在する', () => {
  assert.match(html, /function capturePlan2dDataUrl\(/);
});

test('注記の除外は既存の isPlanAnnotationType を使う（判定を二重に持たない）', () => {
  const body = captureFnBody();
  assert.match(body, /isPlanAnnotationType|planCaptureOptions|PLAN_CAPTURE/);
});

test('天井高ラベルは HeightModel から取る', () => {
  assert.match(html, /HeightModel\.ceilingLabel\(/);
});

test('キャプチャオプションは必ず後始末される（finally で戻す）', () => {
  const body = captureFnBody();
  assert.match(body, /finally/);
});

test('描画関数はフォークせず、draw2d は1つだけ', () => {
  const defs = html.match(/function draw2d\s*\(/g) || [];
  assert.equal(defs.length, 1);
  // キャプチャは既存の draw2d を呼ぶ（複製した描画関数を持たない）
  assert.match(captureFnBody(), /draw2d\(\)/);
});

test('メモ・定規・ウォークルートはキャプチャ中の描画対象から外れる', () => {
  // drawItem2d が注記判定とキャプチャオプションの両方を参照している
  const i = html.indexOf('function drawItem2d(');
  const body = html.slice(i, i + 1200);
  assert.match(body, /isPlanAnnotationType\([^)]*\)[\s\S]{0,80}planCaptureShows\('annotations'\)|planCaptureShows\('annotations'\)[\s\S]{0,80}isPlanAnnotationType/);
});

test('グリッド・下階ゴースト・選択表示はキャプチャオプションを見る', () => {
  const i = html.indexOf('function draw2d()');
  const body = html.slice(i, html.indexOf('function drawMultiSelectionOverlays'));
  assert.match(body, /planCaptureShows\('grid'\)/);
  assert.match(body, /planCaptureShows\('ghostFloor'\)/);
  assert.match(body, /planCaptureShows\('selection'\)/);
  // 選択ハンドルは描画関数側で止める（呼び出し箇所を数える設計にしない）
  const handles = html.slice(html.indexOf('function drawHandles('), html.indexOf('function drawWallHandles('));
  assert.match(handles, /planCaptureShows\('selection'\)/);
});

test('天井高ラベルは通常の 2D 表示には出ない（キャプチャ時のみ）', () => {
  const i = html.indexOf('function planCaptureCeilingLabels');
  assert.notEqual(i, -1, 'planCaptureCeilingLabels が見つからない');
  const body = html.slice(i, i + 260);
  // PLAN_CAPTURE が無い（＝通常描画）ときは false を返すこと
  assert.match(body, /PLAN_CAPTURE/);
  assert.match(body, /return\s+!!\(/);
});

test('既存の静止画AIレンダーは既定では平面図を含めない', () => {
  assert.match(html, /id="ai-render-plan-check"/);
  const checkbox = html.slice(html.indexOf('id="ai-render-plan-check"'), html.indexOf('id="ai-render-plan-check"') + 200);
  assert.doesNotMatch(checkbox.split('>')[0], /\schecked/);
  const gen = html.slice(html.indexOf('async function generateAiRenderPackage'), html.indexOf('async function copyAiRenderPrompt'));
  assert.match(gen, /aiRenderIncludesPlan\(\)/);
});

// ── Task 7c-1 / 7c-3: 構図と解像度 ───────────────────────────────────────
// ここから下の検査は grep ではなく**数値**を見る。index.html から関数を切り出して
// node の vm で実際に走らせ、実データ (assets/default_plan.json) を食わせて、
// 主題がフレームの何割を占めるかを測る。ソースに文字列が在るかどうかは、
// この計画で既に4回、未修正のコードに対して通っている。
const vm = require('node:vm');

// 関数を波括弧の対応で切り出す。文字列とコメントの中の括弧は数えない。
function topLevelFunction(name) {
  const sig = '\nfunction ' + name + '(';
  const at = html.indexOf(sig);
  assert.notEqual(at, -1, 'function ' + name + ' が index.html に無い');
  const start = at + 1;
  let i = html.indexOf('{', start);
  assert.notEqual(i, -1);
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
function sandbox(parts, extra) {
  const ctx = vm.createContext(Object.assign({ console: console }, extra || {}));
  vm.runInContext(parts.join('\n'), ctx);
  return ctx;
}
// 切り出しは各テストの中で行う（読み込み時に落とすと、他のテストが赤かどうかを
// 見られなくなる）。
function geometryWith(data) {
  return sandbox([
    topLevelVar('CONTEXT_EXTERIOR_TYPES'),
    topLevelVar('PLAN_FIT_MARGIN'),
    topLevelFunction('isContextExteriorItemType'),
    topLevelFunction('isPlanAnnotationType'),
    topLevelFunction('isFiniteCanvasValue'),
    topLevelFunction('getObjBounds'),
    topLevelFunction('isPlanSubjectObject'),
    topLevelFunction('planSubjectBoundsMm'),
    topLevelFunction('planFitViewFor'),
    topLevelFunction('planSubjectFrameRatio'),
    topLevelFunction('planSubjectClipped')
  ], { DATA: data });
}
const PLAN = JSON.parse(readFileSync(join(__dirname, '..', '..', 'assets', 'default_plan.json'), 'utf8'));
const FRAME = { w: 1400, h: 900 };   // Task 7b が実測に使ったビューポート

test('主題の箱に敷地・道路・隣家・電柱は入らない（入れると家は必ず小さく写る）', () => {
  const house = { id: 'r1', type: 'room', x: 0, y: 0, w: 4000, d: 3000, floor: 1 };
  const g = geometryWith({
    walls: [], rooms: [house],
    items: [
      { id: 's', type: 'site-rect', x: -10000, y: -10000, w: 40000, d: 30000, floor: 1 },
      { id: 'rd', type: 'road', x: -12000, y: 12000, w: 40000, d: 4000, floor: 1 },
      { id: 'nb', type: 'neighbor-house', x: 20000, y: 0, w: 8000, d: 8000, floor: 1 },
      { id: 'up', type: 'utility-pole', x: -8000, y: -8000, w: 300, d: 300, floor: 1 },
      { id: 'mm', type: 'memo', x: 30000, y: 30000, w: 1000, d: 1000, floor: 1 }
    ]
  });
  const b = g.planSubjectBoundsMm(1);
  assert.deepEqual({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
    { minX: 0, minY: 0, maxX: 4000, maxY: 3000 });
});

test('主題の箱は壁と家具を含む（家具が箱の外に出ない）', () => {
  const g = geometryWith({
    walls: [{ id: 1, x1: 0, y1: 0, x2: 5000, y2: 0, floor: 1 }],
    rooms: [{ id: 'r', type: 'room', x: 0, y: 0, w: 3000, d: 3000, floor: 1 }],
    items: [{ id: 9, type: 'sofa', x: 3500, y: 3500, w: 1000, d: 500, floor: 1 }]
  });
  const b = g.planSubjectBoundsMm(1);
  assert.equal(b.maxX, 5000, '壁の端点が箱に入っていない');
  assert.equal(b.maxY, 4000, '家具が箱に入っていない');
});

test('fit した構図では、実データの主題がフレームの過半を占める', () => {
  const g = geometryWith(PLAN);
  const measured = {};
  [1, 2, 3].forEach(function (f) {
    const b = g.planSubjectBoundsMm(f);
    assert.notEqual(b, null, 'floor ' + f + ' の主題が空');
    const v = g.planFitViewFor(b, FRAME.w, FRAME.h);
    measured[f] = g.planSubjectFrameRatio(b, v, FRAME.w, FRAME.h);
  });
  // 実測: 1F 0.722 / 2F 0.714 / 3F 0.795（1400x900）
  [1, 2, 3].forEach(function (f) {
    assert.ok(measured[f] > 0.6, 'floor ' + f + ' の占有率が低い: ' + measured[f].toFixed(4));
  });
});

test('保存されたパン・ズームのままでは主題が下限を下回る（＝これが直す不良）', () => {
  const g = geometryWith(PLAN);
  const saved = PLAN.viewState.twoD;
  const b = g.planSubjectBoundsMm(2);
  const r = g.planSubjectFrameRatio(b, saved, FRAME.w, FRAME.h);
  // 面積比では 17.3%、長い方の軸では 46.2%。どちらでも下限 (0.6) を下回るが、
  // 軸で測るのは面積比が縦横比に引きずられるため（縦持ちのフレームに横長の家を
  // 正しく合わせても面積では2〜3割にしかならず、正しい構図まで落としてしまう）。
  assert.ok(r < 0.6, '保存視点の占有率が高すぎる（不良を再現できていない）: ' + r);
});

test('小さすぎるを判定する閾値が、実測の失敗と実測の成功の間にある', () => {
  const m = html.match(/var PLAN_SUBJECT_MIN_FRAME_RATIO\s*=\s*([0-9.]+)\s*;/);
  assert.notEqual(m, null, 'PLAN_SUBJECT_MIN_FRAME_RATIO が無い');
  const t = Number(m[1]);
  const g = geometryWith(PLAN);
  const b = g.planSubjectBoundsMm(2);
  const bad = g.planSubjectFrameRatio(b, PLAN.viewState.twoD, FRAME.w, FRAME.h);
  const good = g.planSubjectFrameRatio(b, g.planFitViewFor(b, FRAME.w, FRAME.h), FRAME.w, FRAME.h);
  assert.ok(t > bad, '閾値が実測の不良 (' + bad.toFixed(4) + ') を通してしまう');
  assert.ok(t < good, '閾値が実測の正常 (' + good.toFixed(4) + ') を落としてしまう');
});

test('フレームからはみ出していれば、大きく写っていても見切れとして弾く', () => {
  const g = geometryWith({
    walls: [], items: [],
    rooms: [{ id: 'r', type: 'room', x: 0, y: 0, w: 10000, d: 10000, floor: 1 }]
  });
  const b = g.planSubjectBoundsMm(1);
  // 主題がちょうどフレーム全面を覆う視点を作り、そこから右へ半分ずらす。
  const full = g.planFitViewFor(b, 1000, 1000);
  const shifted = { panX: full.panX + 500, panY: full.panY, zoom: full.zoom };
  // 軸の占有率では見切れを検出できない: 縦は埋まったままなので値が動かない。
  // だからこそ見切れは独立に判定する。片方だけに任せるとどちらかを見逃す。
  assert.ok(!g.planSubjectClipped(b, full, 1000, 1000), '収まっているのに見切れ判定');
  assert.ok(g.planSubjectClipped(b, shifted, 1000, 1000),
    '半分はみ出しているのに見切れと判定されない');
});

test('fit は主題をフレームの中央に置く', () => {
  const g = geometryWith(PLAN);
  const b = g.planSubjectBoundsMm(2);
  const v = g.planFitViewFor(b, FRAME.w, FRAME.h);
  const sc = v.zoom * 0.05;
  const cx = v.panX + (b.minX + b.maxX) / 2 * sc;
  const cy = v.panY + (b.minY + b.maxY) / 2 * sc;
  assert.ok(Math.abs(cx - FRAME.w / 2) < 0.5, 'x が中央でない: ' + cx);
  assert.ok(Math.abs(cy - FRAME.h / 2) < 0.5, 'y が中央でない: ' + cy);
});

test('キャプチャは主題に合わせた構図と倍率を受け取れる', () => {
  const body = captureFnBody();
  assert.match(body, /opt\.fit/);
  assert.match(body, /opt\.scale|planCaptureScale/);
});

test('構図と倍率とキャンバス寸法は finally で必ず戻す', () => {
  const body = captureFnBody();
  const fin = body.slice(body.indexOf('finally'));
  ['panX', 'panY', 'zoom'].forEach(function (k) {
    assert.match(fin, new RegExp('ST\\.' + k + '='), k + ' を戻していない');
  });
  assert.match(fin, /canvas\.width=/, 'キャンバス寸法を戻していない');
});

// 7c-3: 解像度。3D経路 2800x1800 に対し平面図 1400x900 だった。
test('平面図の撮影倍率は3D経路と同じ計算から出る（表を2つ持たない）', () => {
  const g = sandbox([topLevelFunction('aiCaptureBoostedRatio')], {});
  // 1400x900 の等倍キャンバスから 3D と同じ 2800x1800 が出ること
  assert.equal(g.aiCaptureBoostedRatio(1, 1400, 900) * 1400, 2800);
  assert.equal(g.aiCaptureBoostedRatio(1, 1400, 900) * 900, 1800);
  // 端末の上限（1辺4096・約12MP）は3D側と同じ形で効くこと
  const r = g.aiCaptureBoostedRatio(1, 3000, 2000);
  assert.ok(r * 3000 <= 4096 + 1e-6, '1辺の上限を超えた: ' + r * 3000);
  assert.ok((r * 3000) * (r * 2000) <= 12000000 + 1, '面積の上限を超えた');
  // 上限より表示倍率の方が大きい端末では、表示倍率を下回らせない（3D側の既存の
  // 挙動。等倍以下に落として撮る方が事故だという判断が元からある）。
  assert.equal(g.aiCaptureBoostedRatio(2, 3000, 2000), 2);
  // 3D側がこの1か所を呼ぶこと（式を書き写していないこと）
  const cap = html.slice(html.indexOf('function captureCurrent3DDataUrl'),
                         html.indexOf('function captureCurrent3DDataUrl') + 1600);
  assert.match(cap, /aiCaptureBoostedRatio\(/);
});

// 変異テストで見つかった穴。「未 fit なら下限を下回る」だけを見ていると、
// 面積比に戻しても同じ値域なのでテストが通ってしまう(実測: 面積 0.173 /
// 軸 0.462、下限 0.6 のどちら側でもない)。軸で測ることの意味は
// **縦横比に引きずられないこと**にあるので、そこを直接固定する。
// このアプリは house-planner mobile であり、縦持ちのフレームに横長の家を
// 正しく合わせた構図が落とされてはならない。
test('縦長フレームに横長の家を正しく合わせた構図は、下限を超える', () => {
  const g = geometryWith({
    walls: [], items: [],
    rooms: [{ id: 'r', type: 'room', x: 0, y: 0, w: 9000, d: 3000, floor: 1 }]
  });
  const b = g.planSubjectBoundsMm(1);
  const W = 400, H = 900;                    // スマホ縦持ち相当
  const view = g.planFitViewFor(b, W, H);
  const r = g.planSubjectFrameRatio(b, view, W, H);
  assert.ok(!g.planSubjectClipped(b, view, W, H), 'fit したのに見切れ判定');
  assert.ok(r >= 0.6,
    '正しく合わせた縦持ちの構図が下限を下回った: ' + r.toFixed(4) +
    '（面積比で測るとここが落ちる）');
});
