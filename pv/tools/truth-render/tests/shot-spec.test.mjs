import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateShotSpec, frameTimes, guideFrameIndices, shotMode, GUIDE_KINDS, MODES } from '../shot-spec.mjs';

const valid = () => ({
  id: 'S08-ldk-push',
  plan: 'assets/default_plan.json',
  view: '3d-int',
  fps: 24,
  duration: 4,
  resolution: { width: 1920, height: 1080 },
  camera: {
    keys: [
      { t: 0, pos: [0, 1.2, 0], target: [0, 1.2, -1], fov: 75 },
      { t: 2, pos: [0, 1.2, -1], target: [0, 1.2, -2], fov: 75 },
      { t: 4, pos: [0, 1.2, -2], target: [0, 1.2, -3], fov: 75 },
    ],
  },
  guides: ['base', 'edge', 'instance'],
  guideStride: 24,
  floor: 2,
});

test('妥当な spec はそのまま返る', () => {
  const s = valid();
  assert.equal(validateShotSpec(s), s);
});

test('id が無ければフィールド名を含む例外', () => {
  const s = valid(); delete s.id;
  assert.throws(() => validateShotSpec(s), /id/);
});

test('view は 3d-int か 3d-ext のみ', () => {
  const s = valid(); s.view = 'plan';
  assert.throws(() => validateShotSpec(s), /view/);
});

test('キーの時刻が昇順でなければ例外', () => {
  const s = valid(); s.camera.keys[1].t = 3.5; s.camera.keys[2].t = 1;
  assert.throws(() => validateShotSpec(s), /ascending/);
});

test('最初のキーは t=0 でなければ例外', () => {
  const s = valid(); s.camera.keys[0].t = 0.5;
  assert.throws(() => validateShotSpec(s), /must start at t=0/);
});

test('最後のキーの時刻は duration と一致しなければ例外', () => {
  const s = valid(); s.duration = 5;
  assert.throws(() => validateShotSpec(s), /duration/);
});

test('未知の guide 種別は例外', () => {
  const s = valid(); s.guides = ['base', 'bogus'];
  assert.throws(() => validateShotSpec(s), /bogus/);
});

test('floor が無ければフィールド名を含む例外', () => {
  const s = valid(); delete s.floor;
  assert.throws(() => validateShotSpec(s), /floor/);
});

test('floor が整数でなければ例外', () => {
  const s = valid(); s.floor = 1.5;
  assert.throws(() => validateShotSpec(s), /floor/);
});

test('floor が0以下なら例外', () => {
  const s = valid(); s.floor = 0;
  assert.throws(() => validateShotSpec(s), /floor/);
  s.floor = -1;
  assert.throws(() => validateShotSpec(s), /floor/);
});

test('floor が正の整数なら通る', () => {
  const s = valid(); s.floor = 3;
  assert.equal(validateShotSpec(s), s);
});

// ── 型検査 ─────────────────────────────────────────────
// JSON の "24" は数値比較で黙って 24 になるため、範囲だけ見る検査は素通りする。

test('fps が文字列なら例外（"24" > 0 は true なので範囲検査では捕まらない）', () => {
  const s = valid(); s.fps = '24';
  assert.throws(() => validateShotSpec(s), /fps must be a number/);
});

test('duration が文字列なら例外', () => {
  const s = valid(); s.duration = '4';
  assert.throws(() => validateShotSpec(s), /duration must be a number/);
});

test('resolution.width が文字列なら例外', () => {
  const s = valid(); s.resolution.width = '1280';
  assert.throws(() => validateShotSpec(s), /resolution\.width must be a positive integer/);
});

test('resolution.height が小数なら例外', () => {
  const s = valid(); s.resolution.height = 1080.5;
  assert.throws(() => validateShotSpec(s), /resolution\.height/);
});

test('plan が文字列でなければ例外', () => {
  const s = valid(); s.plan = 42;
  assert.throws(() => validateShotSpec(s), /plan must be a string/);
});

test('fps が NaN なら例外', () => {
  const s = valid(); s.fps = NaN;
  assert.throws(() => validateShotSpec(s), /fps must be a number/);
});

test('guideStride が小数なら例外（>= 1 は満たすが索引にならない）', () => {
  const s = valid(); s.guideStride = 1.5;
  assert.throws(() => validateShotSpec(s), /guideStride must be an integer/);
});

test('guideStride が文字列なら例外', () => {
  const s = valid(); s.guideStride = '12';
  assert.throws(() => validateShotSpec(s), /guideStride must be an integer/);
});

test('guides が配列でなければ例外', () => {
  const s = valid(); s.guides = 'base';
  assert.throws(() => validateShotSpec(s), /guides must be an array/);
});

// ── mode ───────────────────────────────────────────────

test('mode 未指定なら sequence', () => {
  assert.equal(shotMode(validateShotSpec(valid())), 'sequence');
});

test('mode は既知の値のみ', () => {
  const s = valid(); s.mode = 'probe';
  assert.throws(() => validateShotSpec(s), /mode must be one of/);
});

test('mode determinism-probe は通り、そのまま読める', () => {
  const s = valid(); s.mode = 'determinism-probe';
  assert.equal(shotMode(validateShotSpec(s)), 'determinism-probe');
});

test('MODES は2種', () => {
  assert.deepEqual(MODES, ['sequence', 'determinism-probe']);
});

test('frameTimes は duration*fps 本で 0 始まり', () => {
  const ts = frameTimes(valid());
  assert.equal(ts.length, 96);
  assert.equal(ts[0], 0);
  assert.ok(Math.abs(ts[95] - 95 / 24) < 1e-12);
});

test('guideFrameIndices は stride 刻みで末尾を必ず含む', () => {
  const idx = guideFrameIndices(valid());
  assert.deepEqual(idx, [0, 24, 48, 72, 95]);
});

test('GUIDE_KINDS は6種', () => {
  assert.deepEqual(GUIDE_KINDS, ['base', 'segmentation', 'instance', 'edge', 'depth', 'normal']);
});

// 同梱している spec ファイルそのものが検証を通ること。バリデータを厳しくした
// のに実ファイルを直し忘れる、という取り違えをここで止める。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const specsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs');

for (const name of readdirSync(specsDir).filter(f => f.endsWith('.json'))) {
  test(`同梱 spec ${name} は検証を通る`, () => {
    const s = JSON.parse(readFileSync(join(specsDir, name), 'utf8'));
    assert.equal(validateShotSpec(s), s);
  });
}

test('determinism プローブの spec は mode で明示されている', () => {
  const s = JSON.parse(readFileSync(join(specsDir, 'probe-determinism.json'), 'utf8'));
  assert.equal(shotMode(validateShotSpec(s)), 'determinism-probe');
});
