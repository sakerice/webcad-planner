// capture-runner.mjs はブラウザ内モジュールだが、キャプチャ手順そのもの
// (何を POST するか / アプリの状態をどう戻すか) はブラウザ非依存である。
// window.__PV_CAPTURE__ と fetch を差し替えて手順を直接動かす。
//
// three.js の実描画は当然ここでは動かない。検証対象は「呼び出しの順序と副作用」
// であって、描かれた絵ではない。
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.location = { search: '' };
globalThis.window = globalThis;

const { main } = await import('../capture-runner.mjs');

function be32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function pngDataUrl(width = 1280, height = 720) {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height)];
  while (bytes.length < 48) bytes.push(0);
  return 'data:image/png;base64,' + Buffer.from(Uint8Array.from(bytes)).toString('base64');
}

function spec(overrides = {}) {
  return {
    id: 'T-test',
    plan: 'assets/default_plan.json',
    view: '3d-int',
    floor: 2,
    fps: 2,
    duration: 1,
    resolution: { width: 1280, height: 720 },
    camera: {
      keys: [
        { t: 0, pos: [0, 1, 0], target: [0, 1, -1], fov: 60 },
        { t: 1, pos: [1, 1, 0], target: [1, 1, -1], fov: 60 },
      ],
    },
    guides: ['base', 'edge', 'instance'],
    guideStride: 1,
    ...overrides,
  };
}

function probeSpec(overrides = {}) {
  return spec({
    id: 'T-probe',
    mode: 'determinism-probe',
    fps: 1,
    duration: 2,
    camera: {
      keys: [
        { t: 0, pos: [0, 1, 0], target: [0, 1, -1], fov: 75 },
        { t: 1, pos: [2, 1, -1], target: [2, 1, -2], fov: 75 },
        { t: 2, pos: [0, 1, 0], target: [0, 1, -1], fov: 75 },
      ],
    },
    guides: ['base'],
    ...overrides,
  });
}

function harness({ shotSpec = spec(), planId = 'assets/default_plan.json',
                   legend = [{ id: 1, color: '#ff0000', type: 'fmp-Sofa02' }],
                   failAtGuide = null } = {}) {
  const initial = { view: '2d', floor: 1, orbit: { enableDamping: true, autoRotate: true } };
  const state = { view: initial.view, floor: initial.floor, orbit: { ...initial.orbit } };
  const captured = [];
  const requests = [];
  const poses = [];

  window.__PV_CAPTURE__ = {
    ensure3D: () => state.view.startsWith('3d'),
    setView: v => { state.view = v; },
    getView: () => state.view,
    setFloor: f => { state.floor = f; },
    getFloor: () => state.floor,
    getPlanId: () => planId,
    captureOrbitState: () => ({ ...state.orbit }),
    restoreOrbitState: prev => { state.orbit = { ...prev }; },
    setCaptureViewport: () => ({ width: '640px', height: '360px' }),
    restoreCaptureViewport: () => { state.viewportRestored = true; },
    setPose: (pos, target, fov) => {
      poses.push({ pos: [...pos], target: [...target], fov });
      // 本物と同じく damping/autoRotate を落とす。復元されなければ検出できる。
      state.orbit.enableDamping = false;
      state.orbit.autoRotate = false;
    },
    renderNow: () => {},
    captureGuide: kind => {
      captured.push(kind);
      if (failAtGuide && kind === failAtGuide) return Promise.reject(new Error('capture blew up'));
      return Promise.resolve(pngDataUrl());
    },
    getInstanceLegend: () => legend,
  };

  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || 'GET',
                    headers: init.headers || {}, body: init.body };
    requests.push(entry);
    if (entry.url.includes('/specs/')) return { ok: true, json: async () => shotSpec };
    return { ok: true };
  };

  location.search = '?pvCapture=1&pvShot=T-test&pvServer=8932';
  return { state, initial, captured, requests, poses };
}

const posts = (requests, path) =>
  requests.filter(r => r.method === 'POST' && r.url.endsWith(path));

const frameKinds = requests =>
  posts(requests, '/frame').map(r => r.headers['X-PV-Kind']);

test('shot.json は検証済み spec の実体として1回だけ POST される', async () => {
  const h = harness();
  await main();
  const shotPosts = posts(h.requests, '/shot');
  assert.equal(shotPosts.length, 1);
  const written = JSON.parse(shotPosts[0].body);
  assert.equal(written.id, 'T-test');
  assert.equal(written.floor, 2);
  assert.deepEqual(written.camera.keys[0].pos, [0, 1, 0]);
  assert.equal(shotPosts[0].headers['X-PV-Shot'], 'T-test');
});

test('instance ガイドを撮るなら instance-legend が1回だけ POST される', async () => {
  const h = harness();
  await main();
  const legendPosts = posts(h.requests, '/instance-legend');
  assert.equal(legendPosts.length, 1);
  const body = JSON.parse(legendPosts[0].body);
  assert.equal(body.instances.length, 1);
  assert.equal(body.instances[0].type, 'fmp-Sofa02');
});

test('instance ガイドを撮らないショットでは legend を書かない', async () => {
  const h = harness({ shotSpec: spec({ guides: ['base', 'edge'] }) });
  await main();
  assert.equal(posts(h.requests, '/instance-legend').length, 0);
});

test('legend が空のまま終わるなら落ちる（黙って書かないのは禁止）', async () => {
  const h = harness({ legend: [] });
  await assert.rejects(main(), /instance legend is empty/);
  assert.equal(posts(h.requests, '/instance-legend').length, 0);
});

test('spec.plan と実際のプランが違えば、両方を名指しして落ちる', async () => {
  const h = harness({ planId: '(a saved or imported plan, not the default plan)' });
  await assert.rejects(main(), err => {
    assert.match(err.message, /plan mismatch/);
    assert.match(err.message, /assets\/default_plan\.json/);
    assert.match(err.message, /a saved or imported plan/);
    return true;
  });
  // 別の家を撮り始めてはならない。
  assert.equal(posts(h.requests, '/frame').length, 0);
  assert.equal(posts(h.requests, '/shot').length, 0);
});

test('spec.guides に base が無ければ base フレームは撮らない', async () => {
  const h = harness({ shotSpec: spec({ guides: ['edge'] }) });
  await main();
  assert.deepEqual([...new Set(frameKinds(h.requests))], ['edge']);
});

test('spec.guides に base があれば全フレームで base を撮る', async () => {
  const h = harness({ shotSpec: spec({ guides: ['base'], guideStride: 1 }) });
  await main();
  assert.deepEqual(frameKinds(h.requests), ['base', 'base']);
});

test('走り終えたらフロア・ビュー・orbit の状態が元へ戻る', async () => {
  const h = harness();
  await main();
  assert.equal(h.state.view, h.initial.view);
  assert.equal(h.state.floor, h.initial.floor);
  assert.deepEqual(h.state.orbit, h.initial.orbit);
});

test('途中で失敗しても状態は元へ戻る', async () => {
  const h = harness({ failAtGuide: 'edge' });
  await assert.rejects(main(), /capture blew up/);
  assert.equal(h.state.view, h.initial.view);
  assert.equal(h.state.floor, h.initial.floor);
  assert.deepEqual(h.state.orbit, h.initial.orbit);
  assert.equal(h.state.viewportRestored, true);
});

test('モードは spec.mode で決まる — id を変えてもプローブのまま', async () => {
  const h = harness({ shotSpec: probeSpec({ id: 'renamed-probe' }) });
  await main();
  assert.deepEqual(frameKinds(h.requests), ['probe', 'probe', 'probe']);
});

test('モードは id から推測されない — probe-determinism という id でも mode 無しなら通常撮影', async () => {
  const h = harness({ shotSpec: spec({ id: 'probe-determinism', guides: ['base'] }) });
  await main();
  assert.deepEqual(frameKinds(h.requests), ['base', 'base']);
});

test('プローブの時刻は camera.keys から取る（[0,1,2] の直書きではない）', async () => {
  // キーを t=0/3/6 に置く。時刻を [0,1,2] と直書きしたままなら、2枚目・3枚目は
  // キーそのものではなく補間された中間姿勢になり、A->B->A にならない。
  const keys = [
    { t: 0, pos: [0, 1, 0], target: [0, 1, -1], fov: 75 },
    { t: 3, pos: [2, 1, -1], target: [2, 1, -2], fov: 75 },
    { t: 6, pos: [0, 1, 0], target: [0, 1, -1], fov: 75 },
  ];
  const h = harness({ shotSpec: probeSpec({ duration: 6, camera: { keys } }) });
  await main();
  assert.equal(posts(h.requests, '/frame').length, 3);
  assert.deepEqual(h.poses.map(p => p.pos), keys.map(k => k.pos));
  assert.deepEqual(h.poses.map(p => p.target), keys.map(k => k.target));
});

test('プローブの1枚目と3枚目が同一姿勢でなければ落ちる', async () => {
  harness({
    shotSpec: probeSpec({
      camera: {
        keys: [
          { t: 0, pos: [0, 1, 0], target: [0, 1, -1], fov: 75 },
          { t: 1, pos: [2, 1, -1], target: [2, 1, -2], fov: 75 },
          { t: 2, pos: [0, 1, 5], target: [0, 1, -1], fov: 75 },
        ],
      },
    }),
  });
  await assert.rejects(main(), /first and last camera keys must be the same pose/);
});
