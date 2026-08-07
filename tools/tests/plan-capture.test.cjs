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
