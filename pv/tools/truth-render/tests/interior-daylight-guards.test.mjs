// index.html の内観採光スイッチ(PV_INTERIOR_DAYLIGHT)が、
//   ・既定(null)では従来の内観3Dと寸分違わない値を出す
//   ・PVキャプチャで値が入ったときだけ太陽と天井を有効にする
// ことを、実際の index.html から該当行を取り出して評価して確かめる。
//
// three.js の描画そのものはここでは動かない(ブラウザが要る)。ここで固定するのは
// 「どちらの分岐へ落ちるか」— つまりオプトインが本当にオプトインであることだけ。
// 取り出しは行の完全一致で行うので、該当行が書き換われば必ずこのテストが落ちる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'index.html');
const LINES = readFileSync(indexPath, 'utf8').split('\n');

// index.html 内で一意に決まる1行を取り出す。複数ヒット/ゼロヒットは、
// 取り違えたまま「何も検証していないテスト」になるのを防ぐため即失敗にする。
function sourceLine(fragment) {
  const hits = LINES.filter(l => l.includes(fragment));
  assert.equal(hits.length, 1,
    `index.html に "${fragment}" を含む行が ${hits.length} 本ある(1本であるべき)`);
  return hits[0].trim();
}

const SUN_SCALE = sourceLine('var pvSunScale=');
const INTERIOR_MODE = sourceLine('var interiorMode=(');
const SUN_INTENSITY = sourceLine('o.intensity=interiorMode?0:LIGHT_SETTINGS.sun*pvSunScale;');
const SUN_CAST = sourceLine('o.castShadow=!interiorMode;');
const CEILING_MAT = sourceLine('var matCeiling=');
const SHADOW_FIT = sourceLine('if(_sunLight && (!isInt');

const THREE_STUB = { MeshStandardMaterial: function () { this.isCeilingMaterial = true; }, DoubleSide: 2 };
const LIGHT_SETTINGS = { sun: 0.78, sunSim: false, timeOfDay: 'day' };

// applyLightingToScene の SunLight 分岐(sunSim OFF 側)をそのまま評価する。
function sunBranch({ view, isInt, daylight }) {
  const run = new Function('ST', 'isInt', 'PV_INTERIOR_DAYLIGHT', 'LIGHT_SETTINGS', 'o',
    `${SUN_SCALE}\n${INTERIOR_MODE}\n${SUN_CAST}\n${SUN_INTENSITY}\n` +
    'return {interiorMode:interiorMode, pvSunScale:pvSunScale, intensity:o.intensity, castShadow:o.castShadow};');
  return run({ view }, isInt, daylight, LIGHT_SETTINGS, {});
}

// buildRooms3D の天井マテリアル生成をそのまま評価する。
function ceilingMaterial({ isInt, daylight }) {
  const run = new Function('isInt', 'PV_INTERIOR_DAYLIGHT', 'THREE',
    `${CEILING_MAT}\nreturn matCeiling;`);
  return run(isInt, daylight, THREE_STUB);
}

// build3D 末尾の影カメラフィットをそのまま評価する。呼ばれたかどうかは、
// 呼び出しを記録する fitShadowCamera を渡して見る。
function shadowFitCalls({ isInt, daylight }) {
  const calls = [];
  const run = new Function('isInt', 'PV_INTERIOR_DAYLIGHT', '_sunLight', 'fitShadowCamera',
    SHADOW_FIT + '\nreturn null;');
  run(isInt, daylight, { name: 'SunLight' }, l => calls.push(l));
  return calls.length;
}

test('通常の内観3D(スイッチ null): 太陽は消灯・影なし・天井を作らない・影カメラも合わせない', () => {
  const sun = sunBranch({ view: '3d-int', isInt: true, daylight: null });
  assert.equal(sun.interiorMode, true);
  assert.equal(sun.intensity, 0);
  assert.equal(sun.castShadow, false);
  assert.equal(ceilingMaterial({ isInt: true, daylight: null }), null);
  assert.equal(shadowFitCalls({ isInt: true, daylight: null }), 0);
});

test('外観3D(スイッチ null): 太陽の強度はプリセット値そのまま(×1 で値が変わらない)', () => {
  const sun = sunBranch({ view: '3d-ext', isInt: false, daylight: null });
  assert.equal(sun.interiorMode, false);
  assert.equal(sun.pvSunScale, 1);
  // 掛け算を差し込んだせいで外観の明るさが1ビットでも変われば、ここで落ちる。
  assert.equal(sun.intensity, LIGHT_SETTINGS.sun);
  assert.equal(Object.is(sun.intensity, 0.78), true);
  assert.equal(sun.castShadow, true);
  assert.ok(ceilingMaterial({ isInt: false, daylight: null }).isCeilingMaterial);
  assert.equal(shadowFitCalls({ isInt: false, daylight: null }), 1);
});

test('PVキャプチャの内観採光: 内観でも太陽が点き、影を落とし、天井が作られ、影カメラも合う', () => {
  const sun = sunBranch({ view: '3d-int', isInt: true, daylight: { sunScale: 1 } });
  assert.equal(sun.interiorMode, false);
  assert.equal(sun.intensity, LIGHT_SETTINGS.sun);
  assert.equal(sun.castShadow, true);
  assert.ok(ceilingMaterial({ isInt: true, daylight: { sunScale: 1 } }).isCeilingMaterial);
  assert.equal(shadowFitCalls({ isInt: true, daylight: { sunScale: 1 } }), 1);
});

test('sunScale は太陽の強度に効く', () => {
  assert.equal(sunBranch({ view: '3d-int', isInt: true, daylight: { sunScale: 1.5 } }).intensity, 0.78 * 1.5);
  // 壊れた値(0 や欠落)を渡しても暗転しない: 既定は等倍。
  assert.equal(sunBranch({ view: '3d-int', isInt: true, daylight: {} }).intensity, 0.78);
});

test('スイッチの既定値は null(通常の利用者には無効)', () => {
  assert.equal(sourceLine('var PV_INTERIOR_DAYLIGHT='), 'var PV_INTERIOR_DAYLIGHT=null;');
});

test('スイッチを立てるのは PV キャプチャフックの中だけ', () => {
  const hookStart = LINES.findIndex(l => l.includes('PV capture hook (guarded'));
  assert.ok(hookStart > 0, 'PV capture hook のブロックが見つからない');
  const assignments = LINES
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /PV_INTERIOR_DAYLIGHT\s*=[^=]/.test(l));
  assert.ok(assignments.length > 0);
  for (const { l, i } of assignments) {
    assert.ok(i > hookStart || l.trim() === 'var PV_INTERIOR_DAYLIGHT=null;',
      `PV_INTERIOR_DAYLIGHT がフックの外(${i + 1}行目)で書き換えられている: ${l.trim()}`);
  }
});
