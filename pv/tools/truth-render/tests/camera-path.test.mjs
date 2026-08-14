import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleCameraPath } from '../camera-path.mjs';

const key = (t, x, fov = 60) => ({ t, pos: [x, 0, 0], target: [x, 0, -1], fov });

test('キー時刻ちょうどではキー値をそのまま返す', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  for (const k of keys) {
    const s = sampleCameraPath(keys, k.t);
    assert.deepEqual(s.pos, k.pos);
    assert.deepEqual(s.target, k.target);
  }
});

test('キーが2点なら線形補間する', () => {
  const keys = [key(0, 0), key(4, 4)];
  assert.equal(sampleCameraPath(keys, 1).pos[0], 1);
  assert.equal(sampleCameraPath(keys, 3).pos[0], 3);
});

test('等間隔で共線のキーは直線上を動く（反射端点の証拠）', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  assert.ok(Math.abs(sampleCameraPath(keys, 0.5).pos[0] - 0.5) < 1e-12);
  assert.ok(Math.abs(sampleCameraPath(keys, 1.5).pos[0] - 1.5) < 1e-12);
});

test('範囲外の時刻は端にクランプされる', () => {
  const keys = [key(0, 0), key(1, 1), key(2, 2)];
  assert.deepEqual(sampleCameraPath(keys, -5).pos, [0, 0, 0]);
  assert.deepEqual(sampleCameraPath(keys, 99).pos, [2, 0, 0]);
});

test('fov も補間される', () => {
  const keys = [key(0, 0, 40), key(2, 2, 80)];
  assert.equal(sampleCameraPath(keys, 1).fov, 60);
});

test('キーが空なら例外を投げる', () => {
  assert.throws(() => sampleCameraPath([], 0), /non-empty/);
});
