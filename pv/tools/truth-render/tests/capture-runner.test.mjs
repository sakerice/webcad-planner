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

const { main, ensureModelsLoaded } = await import('../capture-runner.mjs');

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
                   // legendAt(n), if given, returns the legend snapshot for the
                   // n-th (0-indexed) instance/edge capture in the run --
                   // mirrors how the real captureGuide('instance'|'edge')
                   // reassigns window.__PV_CAPTURE__'s internal legend on every
                   // such call, which is what lets a mid-shot id->colour remap
                   // happen at all.
                   legendAt = null,
                   failAtGuide = null,
                   // pendingModelLoads() が空になるまでの呼び出し回数。実物の
                   // _modelLoading と同じく、呼ぶたびに読み直す配列を返す。
                   pendingModelUrls = [],
                   pendingModelCallsBeforeReady = 0,
                   // /done へのサーバ応答を差し替える。scene readiness check が
                   // サーバ側で落ちたケースを模す。
                   doneOk = true,
                   doneStatus = 422,
                   doneText = 'scene readiness FAIL: only 0/1 (0%) declared GLB furniture instances ever appear',
                 } = {}) {
  const initial = { view: '2d', floor: 1, orbit: { enableDamping: true, autoRotate: true } };
  const state = { view: initial.view, floor: initial.floor, orbit: { ...initial.orbit } };
  const captured = [];
  const requests = [];
  const poses = [];
  let instanceCaptureCount = 0;
  let currentLegend = legend;
  let pendingModelCalls = 0;

  window.__PV_CAPTURE__ = {
    ensure3D: () => state.view.startsWith('3d'),
    pendingModelLoads: () => {
      pendingModelCalls++;
      return pendingModelCalls <= pendingModelCallsBeforeReady ? [...pendingModelUrls] : [];
    },
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
      if (kind === 'instance' || kind === 'edge') {
        currentLegend = legendAt ? legendAt(instanceCaptureCount) : legend;
        instanceCaptureCount++;
      }
      return Promise.resolve(pngDataUrl());
    },
    getInstanceLegend: () => currentLegend,
  };

  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || 'GET',
                    headers: init.headers || {}, body: init.body };
    requests.push(entry);
    if (entry.url.includes('/specs/')) return { ok: true, json: async () => shotSpec };
    if (entry.url.endsWith('/done')) {
      if (doneOk) return { ok: true };
      return { ok: false, status: doneStatus, text: async () => doneText };
    }
    return { ok: true };
  };

  location.search = '?pvCapture=1&pvShot=T-test&pvServer=8932';
  return { state, initial, captured, requests, poses };
}

const posts = (requests, path) =>
  requests.filter(r => r.method === 'POST' && r.url.endsWith(path));

const frameKinds = requests =>
  posts(requests, '/frame').map(r => r.headers['X-PV-Kind']);

test('shot.json は検証済み spec の実体としてまず1回 POST される', async () => {
  const h = harness();
  await main();
  const shotPosts = posts(h.requests, '/shot');
  // 撮影開始前に spec そのものを1回、撮影完了後に capture メタデータ付きで
  // もう1回 -- 合計2回になる(次のテストが2回目の中身を見る)。
  assert.equal(shotPosts.length, 2);
  const written = JSON.parse(shotPosts[0].body);
  assert.equal(written.id, 'T-test');
  assert.equal(written.floor, 2);
  assert.deepEqual(written.camera.keys[0].pos, [0, 1, 0]);
  assert.equal(shotPosts[0].headers['X-PV-Shot'], 'T-test');
});

test('shot.json は完走後に所要時間とフレーム数を添えてもう一度 POST される', async () => {
  // 「105秒かかるはずが10秒で完走した」を人間が見比べずに artefact だけで
  // 気づけるようにするための2つの数値。
  const h = harness();
  await main();
  const shotPosts = posts(h.requests, '/shot');
  assert.equal(shotPosts.length, 2);
  const final = JSON.parse(shotPosts[1].body);
  assert.equal(final.id, 'T-test');
  assert.ok(Number.isInteger(final.capture.tookMs) && final.capture.tookMs >= 0,
    `capture.tookMs should be a non-negative integer, got ${JSON.stringify(final.capture)}`);
  // spec: fps=2, duration=1 -> frameTimes は2枚。
  assert.equal(final.capture.frameCount, 2);
});

test('プローブのフレーム数も shot.json の capture.frameCount に残る', async () => {
  const h = harness({ shotSpec: probeSpec() });
  await main();
  const shotPosts = posts(h.requests, '/shot');
  const final = JSON.parse(shotPosts[1].body);
  assert.equal(final.capture.frameCount, 3); // A, B, A の3ポーズ
});

test('家具モデルがロード中のあいだはフレームを撮り始めない', async () => {
  // pendingModelLoads() が2回 non-empty を返してから空になる -- ensure3D の
  // ポーリングと同じ「揃うまで待つ」構造で、固定 sleep には依存しない。
  const h = harness({ pendingModelUrls: ['assets/models/fmp-Sofa02.glb'], pendingModelCallsBeforeReady: 2 });
  await main();
  // 待ち終えたあとは通常どおり完走する。
  assert.equal(posts(h.requests, '/frame').length > 0, true);
  assert.equal(posts(h.requests, '/done').length, 1);
});

test('家具モデルのロードが規定時間内に終わらなければ、何が未完了かを名指しして落ちる', async () => {
  // main() 経由だと本番用の30秒タイムアウトをそのまま実時間で待つことになり
  // テストが重くなるので、ensureModelsLoaded を直接、短いタイムアウトで呼ぶ。
  // main() からの呼び出し経路自体は次のテスト(pendingModelCallsBeforeReady
  // 付きの harness 経由)で確認済み。
  window.__PV_CAPTURE__ = {
    pendingModelLoads: () => ['assets/models/fmp-Sofa02.glb', 'assets/models/fmp-Chair14.glb'],
  };
  await assert.rejects(
    ensureModelsLoaded({ id: 'T-timeout' }, 30),
    err => {
      assert.match(err.message, /furniture models still loading/);
      assert.match(err.message, /fmp-Sofa02\.glb/);
      assert.match(err.message, /fmp-Chair14\.glb/);
      return true;
    });
});

test('家具モデルが揃えばタイムアウト前に抜ける（待ちすぎない）', async () => {
  let calls = 0;
  window.__PV_CAPTURE__ = {
    pendingModelLoads: () => { calls++; return calls <= 2 ? ['assets/models/fmp-Sofa02.glb'] : []; },
  };
  const start = Date.now();
  await ensureModelsLoaded({ id: 'T-ready' }, 30000);
  assert.ok(Date.now() - start < 1000, 'should resolve as soon as pending list empties, not wait for the timeout');
  assert.ok(calls >= 3);
});

test('サーバが /done を拒否したら(シーン完全性チェック失敗)呼び出し元へ理由付きで伝わる', async () => {
  // capture_server.py 側の check_scene_readiness が FAIL を返したケース。
  // DONE を信用できる形でクライアント側にも「失敗」として見えることを保証する。
  const h = harness({ doneOk: false, doneStatus: 422,
    doneText: 'scene readiness FAIL: only 1/32 (3%) declared GLB furniture instances ever appear' });
  await assert.rejects(main(), err => {
    assert.match(err.message, /server rejected \/done/);
    assert.match(err.message, /422/);
    assert.match(err.message, /scene readiness FAIL/);
    return true;
  });
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

test('instance id->色対応が撮影中に変わったら落ちる（サイレントな remap を防ぐ）', async () => {
  // id=1 の色がフレーム0の 'edge'/'instance' キャプチャ (0,1回目) では赤、
  // フレーム1 (2,3回目) では青に変わる -- 三.js のトラバース順が撮影中に
  // ずれた、という想定のシナリオ。これを検出できなければ、フレーム1以降の
  // instance PNG は全く別の id->色対応で焼かれているのに、runner の最後で
  // POST される legend はどちらか一方しか語らない。
  const h = harness({
    legendAt: n => [{ id: 1, color: n < 2 ? '#ff0000' : '#0000ff', type: 'fmp-Sofa02' }],
  });
  await assert.rejects(main(), err => {
    assert.match(err.message, /id->colour mapping changed mid-shot/);
    assert.match(err.message, /id 1/);
    return true;
  });
  // 壊れた対応のまま legend が書き出されてはならない。
  assert.equal(posts(h.requests, '/instance-legend').length, 0);
});

test('instance id->色対応が撮影中ずっと同じなら通る（回帰ガードの偽陽性がないことの確認）', async () => {
  const h = harness({
    legendAt: () => [{ id: 1, color: '#ff0000', type: 'fmp-Sofa02' }],
  });
  await main();
  assert.equal(posts(h.requests, '/instance-legend').length, 1);
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
