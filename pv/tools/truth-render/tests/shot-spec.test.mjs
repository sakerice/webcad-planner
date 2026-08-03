import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateShotSpec, frameTimes, guideFrameIndices, GUIDE_KINDS } from '../shot-spec.mjs';

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
