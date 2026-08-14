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

// 1枚目の安定待ち (settleFirstFrame) はキャプチャ結果の平均輝度を読む。ここは
// three の実描画ではなく「手順」を見る場なので、Image と canvas を最小限だけ
// 用意し、輝度は data URL ごとに決まる固定値として返す。既定では同じ絵が
// 返る = 即座に安定する。安定しない状況を作りたいテストは luminanceSeq を
// 差し替える。
globalThis.__testLuminance = { seq: null, calls: 0 };
globalThis.Image = class {
  set src(v) {
    this._src = v;
    setTimeout(() => this.onload && this.onload(), 0);
  }
};
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (x, y, w, h) => {
        const L = globalThis.__testLuminance;
        const seq = L.seq;
        const v = seq ? seq[Math.min(L.calls++, seq.length - 1)] : 128;
        const d = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
        return { data: d };
      },
    }),
  }),
};

const { main, ensureModelsLoaded } = await import('../capture-runner.mjs');

function be32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

// nonce は IHDR の後ろに置く。assertFrameSize が読むのは先頭 24 バイトだけなので
// 寸法の検査には影響せず、「カメラが動けばフレームのバイト列も変わる」という
// 実物の性質だけを模せる。nonce を同じ値に固定すれば「動いたのに絵が変わらない」
// 実際の不具合を再現できる。
function pngDataUrl(width = 1280, height = 720, nonce = 0) {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height)];
  while (bytes.length < 44) bytes.push(0);
  bytes.push(...be32(nonce));
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
                   // setInteriorDaylight が返す「実際に効いた状態」の上書き。
                   // 太陽が点かなかった / 天井オクルーダーが0枚だった等を模す。
                   daylightState = null,
                   // setInteriorDaylight を持たない古い index.html を模す。
                   // true にすると captureGuide が毎回同じバイト列を返す =
                   // 「カメラは動いたのに絵が変わらない」実際の不具合の再現。
                   freezeFrames = false,
                   omitDaylightHook = false,
                   // 有効化した後に、非同期の再構築(GLB完了 -> scheduleGltfRebuild3D)
                   // が天井のオクルーダー化を巻き戻した状況を模す。この時点以降の
                   // 観測は「天井はあるがオクルーダーは0枚」を返す。
                   revertOccludersAt = null,
                 } = {}) {
  const initial = { view: '2d', floor: 1, orbit: { enableDamping: true, autoRotate: true } };
  const state = { view: initial.view, floor: initial.floor, orbit: { ...initial.orbit } };
  const captured = [];
  const requests = [];
  const poses = [];
  // 呼び出し順そのものを見るための時系列。採光を入れるのがフレーム取得より
  // 前でなければ、光の無いフレームが混ざる。
  const events = [];
  let instanceCaptureCount = 0;
  let currentLegend = legend;
  let pendingModelCalls = 0;
  let frameNonce = 0;

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
    renderNow: () => { events.push('render'); },
    captureGuide: kind => {
      captured.push(kind);
      events.push(`guide:${kind}`);
      if (failAtGuide && kind === failAtGuide) return Promise.reject(new Error('capture blew up'));
      if (kind === 'instance' || kind === 'edge') {
        currentLegend = legendAt ? legendAt(instanceCaptureCount) : legend;
        instanceCaptureCount++;
      }
      return Promise.resolve(pngDataUrl(1280, 720, freezeFrames ? 0 : ++frameNonce));
    },
    getInstanceLegend: () => currentLegend,
  };

  if (!omitDaylightHook) {
    // 観測は「その瞬間のシーン」を読む。撮影の途中で巻き戻ったかどうかを
    // 時点ごとに変えられるようにしておく(本物の失敗はまさにこれだった)。
    const WHENS = ['right after enabling', 'before the first frame', 'after the last frame'];
    const revertedBy = when =>
      revertOccludersAt !== null && WHENS.indexOf(when) >= WHENS.indexOf(revertOccludersAt);
    const sceneState = (cfg, when) => ({
      enabled: true,
      sunScale: cfg.sunScale,
      timeOfDay: 'day',
      sunSim: false,
      sunIntensity: 0.78 * cfg.sunScale,
      sunCastShadow: true,
      sunPosition: [13.9, 24.6, 12.1],
      shadowMapSize: [2048, 2048],
      shadowCameraSpanM: 15.74,
      ceilings: 2,
      ceilingOccluders: revertedBy(when) ? 0 : 2,
      ...(daylightState || {}),
    });
    // 本物と同じく、要求(cfg)を受けて「実際にシーンへ効いた状態」を返す。
    window.__PV_CAPTURE__.setInteriorDaylight = cfg => {
      if (!cfg) {
        state.daylight = null;
        events.push('daylight:off');
        return { enabled: false, sunScale: 0, sunIntensity: 0, sunCastShadow: false, ceilings: 0, ceilingOccluders: 0 };
      }
      state.daylight = { ...cfg };
      events.push('daylight:on');
      return sceneState(cfg, 'right after enabling');
    };
    // 状態を変えずに測り直す。runner は最初のフレームの直前と最後のフレームの
    // 直後に呼ぶ。
    window.__PV_CAPTURE__.inspectInteriorDaylight = when => {
      events.push(`daylight:inspect:${when}`);
      if (!state.daylight) return { enabled: false, sunScale: 0, sunIntensity: 0, sunCastShadow: false, ceilings: 0, ceilingOccluders: 0 };
      return sceneState(state.daylight, when);
    };
  }

  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || 'GET',
                    headers: init.headers || {}, body: init.body };
    requests.push(entry);
    if (entry.url.endsWith('/frame')) events.push('post:frame');
    if (entry.url.includes('/specs/')) return { ok: true, json: async () => shotSpec };
    if (entry.url.endsWith('/done')) {
      if (doneOk) return { ok: true };
      return { ok: false, status: doneStatus, text: async () => doneText };
    }
    return { ok: true };
  };

  location.search = '?pvCapture=1&pvShot=T-test&pvServer=8932';
  return { state, initial, captured, requests, poses, events };
}

const daylightSpec = (overrides = {}) =>
  spec({ daylight: { interiorSun: true, sunScale: 1 }, ...overrides });

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

// ── 内観採光 ───────────────────────────────────────────────────────
// 内観3Dは天井を作らず太陽も消していた。窓からの日射が1枚も写っていない
// フレーム列に対して映像生成へ「窓から差し込む光」を頼んだ結果、モデルが
// 勝手に光源を発明した。以下は「頼んだ採光が本当に効いてから撮り始める」
// ことを、呼び出し順と失敗経路の両方で固定する。
test('採光を要求しないショットでは setInteriorDaylight を一切呼ばない', async () => {
  const h = harness();
  await main();
  assert.deepEqual(h.events.filter(e => e.startsWith('daylight')), []);
  assert.equal(h.state.daylight, undefined);
});

test('採光を要求したら、最初のフレームより前に入り、最後に戻る', async () => {
  const h = harness({ shotSpec: daylightSpec() });
  await main();
  const marks = h.events.filter(e => e.startsWith('daylight') || e === 'guide:base');
  assert.equal(marks[0], 'daylight:on', `採光は撮影開始前に入るべき: ${h.events.join(' ')}`);
  assert.equal(marks[marks.length - 1], 'daylight:off', `採光は撮影後に戻すべき: ${h.events.join(' ')}`);
  assert.ok(marks.includes('guide:base'));
  assert.equal(h.state.daylight, null);
});

test('実際に効いた採光が shot.json に残る', async () => {
  // 動画を見比べずに、成果物のファイルだけで日射の有無が判るようにする。
  const h = harness({ shotSpec: daylightSpec() });
  await main();
  const shotPosts = posts(h.requests, '/shot');
  assert.equal(shotPosts.length, 2);
  for (const p of shotPosts) {
    const doc = JSON.parse(p.body);
    assert.equal(doc.daylight.interiorSun, true);
    assert.equal(doc.daylight.applied.sunIntensity, 0.78);
    assert.equal(doc.daylight.applied.sunCastShadow, true);
    assert.equal(doc.daylight.applied.ceilingOccluders, 2);
  }
});

test('sunScale はそのままアプリへ渡る', async () => {
  const h = harness({ shotSpec: daylightSpec({ daylight: { interiorSun: true, sunScale: 1.5 } }) });
  await main();
  const doc = JSON.parse(posts(h.requests, '/shot')[0].body);
  assert.equal(doc.daylight.applied.sunScale, 1.5);
  assert.equal(doc.daylight.applied.sunIntensity, 0.78 * 1.5);
});

test('太陽が点かなかったら1枚も撮らずに落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec(), daylightState: { sunIntensity: 0 } });
  await assert.rejects(main(), err => {
    assert.match(err.message, /the sun is still off/);
    return true;
  });
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('太陽が影を落とさない設定なら落ちる（光が天井と壁を素通りする）', async () => {
  const h = harness({ shotSpec: daylightSpec(), daylightState: { sunCastShadow: false } });
  await assert.rejects(main(), /casts no shadows/);
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('天井オクルーダーが1枚も無ければ落ちる（真上から日射が降る絵になる）', async () => {
  const h = harness({ shotSpec: daylightSpec(), daylightState: { ceilingOccluders: 0 } });
  await assert.rejects(main(), err => {
    assert.match(err.message, /no ceiling occluders/);
    return true;
  });
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('採光が有効化されなかった(enabled:false)ら落ちる', async () => {
  harness({ shotSpec: daylightSpec(), daylightState: { enabled: false } });
  await assert.rejects(main(), /not enabled/);
});

// 実際に起きた事故そのもの: 有効化の瞬間は正しく、そのあと非同期の再構築
// (GLB読み込み完了 -> scheduleGltfRebuild3D -> rebuild3D)が天井のオクルーダー化を
// 巻き戻し、ゲートは通ったのに「部屋全体が不透明な天井で覆われた俯瞰」が
// 撮れてしまった。有効化時の1回だけの検査では絶対に捕まらない。
test('有効化のあと再構築で巻き戻ったら、1枚も撮らずに落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec(), revertOccludersAt: 'before the first frame' });
  await assert.rejects(main(), err => {
    assert.match(err.message, /no ceiling occluders/);
    return true;
  });
  assert.equal(posts(h.requests, '/frame').length, 0);
  assert.equal(posts(h.requests, '/done').length, 0);
});

test('撮影中に巻き戻ったら、DONE を出さずに落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec(), revertOccludersAt: 'after the last frame' });
  await assert.rejects(main(), err => {
    assert.match(err.message, /no ceiling occluders/);
    return true;
  });
  // フレームは撮れてしまうが、信用できない列として DONE は出さない。
  assert.ok(posts(h.requests, '/frame').length > 0);
  assert.equal(posts(h.requests, '/done').length, 0);
});

test('巻き戻りが無ければ、撮影前後の測り直しは両方とも通る', async () => {
  const h = harness({ shotSpec: daylightSpec() });
  await main();
  assert.deepEqual(
    h.events.filter(e => e.startsWith('daylight:inspect')),
    ['daylight:inspect:before the first frame', 'daylight:inspect:after the last frame']);
  assert.equal(posts(h.requests, '/done').length, 1);
});

test('天井はあるのにオクルーダーが0枚なら、矛盾として名指しで落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec(), daylightState: { ceilings: 2, ceilingOccluders: 0 } });
  await assert.rejects(main(), /no ceiling occluders/);
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('inspectInteriorDaylight を持たない古いページなら名指しで落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec() });
  delete window.__PV_CAPTURE__.inspectInteriorDaylight;
  await assert.rejects(main(), err => {
    assert.match(err.message, /does not expose inspectInteriorDaylight/);
    return true;
  });
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('setInteriorDaylight を持たない古いページなら名指しで落ちる', async () => {
  const h = harness({ shotSpec: daylightSpec(), omitDaylightHook: true });
  await assert.rejects(main(), err => {
    assert.match(err.message, /does not expose setInteriorDaylight/);
    return true;
  });
  assert.equal(posts(h.requests, '/frame').length, 0);
});

test('撮影中に失敗しても採光は戻される', async () => {
  const h = harness({ shotSpec: daylightSpec(), failAtGuide: 'edge' });
  await assert.rejects(main(), /capture blew up/);
  assert.equal(h.state.daylight, null);
  assert.equal(h.events[h.events.length - 1], 'daylight:off');
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

// frame 0 だけ影が乗り切らず明るく出ていた (実測 T96-ldk-overhead-descend:
// frame0 の平均輝度 150.2 / frame1 以降 145.0、画素の 18.6% が 10 以上ずれる。
// 通常のフレーム間変化は 3.09 / 3.3%)。シャドウマップは needsUpdate を立てた
// 次の描画で埋まるので、1枚目の前に捨て描きが要る。frame 0 は生成側が見た目の
// 基準に使う最初の絵なので、ここが素通りすると成果物に直接効く。
test('1枚目を保存する前に、その姿勢のまま絵が安定するまで描き直す', async () => {
  const h = harness();
  await main();
  const firstPost = h.events.indexOf('post:frame');
  assert.ok(firstPost >= 0, 'no frame was ever posted');
  const rendersBefore = h.events.slice(0, firstPost).filter(e => e === 'render').length;
  assert.ok(rendersBefore >= 2,
    'expected the settle renders plus the frame\'s own render before the first saved frame, got ' +
    rendersBefore + ' (events: ' + h.events.slice(0, firstPost + 1).join(', ') + ')');
  // 別姿勢での描き直しは効かない (実測: カメラを動かさない捨て描きでは frame0->1 の
  // 差が 28.76 のまま1ビットも動かなかった)。安定待ちは frame 0 の姿勢で行う。
  assert.ok(h.poses.length >= 2, 'expected at least a settle pose and the frame-0 pose');
  assert.deepEqual(h.poses[0], h.poses[1],
    'the settle must run at frame 0\'s pose, not wherever the camera happened to be');
});

test('絵が安定しないまま上限に達したら、黙って撮らずに落ちる', async () => {
  // 毎回違う輝度を返す = 永遠に安定しない。以前の実装は「何枚か描いたら撮る」
  // だったので、この状況でも未確定のフレームを1枚目として保存してしまう。
  globalThis.__testLuminance = { seq: Array.from({ length: 200 }, (_, i) => i % 199), calls: 0 };
  try {
    harness();
    await assert.rejects(() => main(), /never stopped changing at the first camera pose/);
  } finally {
    globalThis.__testLuminance = { seq: null, calls: 0 };
  }
});

// 実測 (T94-exterior, 96フレーム): frame 24 / 48 / 62 の3枚が直前のフレームと
// sha256 まで一致した。カメラはその間も動いている (frame 23->24 で pos が
// 19.083 -> 19.000)。描画が反映される前のバッファを読み出している。
// 参照動画に静止区間があると生成側はそこで追従をやめて即興を始めるので
// (末尾5秒が静止画だった前回がまさにそれ)、黙って保存させない。
test('姿勢が変わったのに絵が変わらないフレームは、撮り直しても直らなければ落とす', async () => {
  harness({ freezeFrames: true });
  await assert.rejects(() => main(), /byte-identical to frame/);
});

test('固定カメラのショットでは同一フレームが続いても落とさない', async () => {
  // T92 のような意図的な固定カメラは、絵が同じなのが正しい。姿勢が変わって
  // いないので検査対象外でなければならない。
  const still = spec({ guides: ['base'], duration: 1, fps: 2 });
  still.camera.keys = [
    { t: 0, pos: [0, 1, 0], target: [0, 1, -1], fov: 60 },
    { t: 1, pos: [0, 1, 0], target: [0, 1, -1], fov: 60 },
  ];
  const h = harness({ shotSpec: still, freezeFrames: true });
  await main();
  const frames = h.requests.filter(r => r.url.endsWith('/frame'));
  assert.equal(frames.length, 2, 'both frames of the still shot should be saved');
});
