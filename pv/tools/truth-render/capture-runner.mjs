// index.html のページ内で連番キャプチャを駆動する。
// window.__PV_CAPTURE__ が既に露出している前提。

import { sampleCameraPath } from './camera-path.mjs';
import { validateShotSpec, frameTimes, guideFrameIndices, shotMode, daylightRequest } from './shot-spec.mjs';

// URL パラメータは読み取り時に評価する。モジュール読み込み時に固定すると、
// ブラウザ外(node --test)からこのモジュールを import しただけで location
// 参照が落ち、キャプチャ手順そのものをテストできなくなる。
function pvParams() {
  return new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
}
function serverBase() {
  return `http://127.0.0.1:${pvParams().get('pvServer') || '8932'}`;
}

const log = (...a) => console.log('[pv-capture]', ...a);

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)[1];
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

async function postFrame(shot, kind, index, dataUrl) {
  const res = await fetch(`${serverBase()}/frame`, {
    method: 'POST',
    headers: { 'X-PV-Shot': shot, 'X-PV-Kind': kind, 'X-PV-Index': String(index) },
    body: dataUrlToBlob(dataUrl),
  });
  if (!res.ok) throw new Error(`frame ${kind}/${index} rejected: ${res.status}`);
}

async function postJson(shot, path, value) {
  const res = await fetch(`${serverBase()}${path}`, {
    method: 'POST',
    headers: { 'X-PV-Shot': shot, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`${path} rejected: ${res.status}`);
}

// /done はサーバ側 (capture_server.py) が instance-legend.json + instance/ の
// 中身から独立に読み直し、シーンが本当に揃っていたか (check_scene_readiness)
// を検査したうえで応答する。ここで res.ok を見ずに握り潰すと、まさに今回の
// 事故 (家具未ロードのまま完走・DONE 発行) と同じ形で「サーバは検知したのに
// runner が黙って success 扱いする」経路が残ってしまう。DONE マーカーは
// このリクエストが成功したときしかサーバ側で書かれない。
async function postDone(spec) {
  const res = await fetch(`${serverBase()}/done`, {
    method: 'POST',
    headers: { 'X-PV-Shot': spec.id },
  });
  if (!res.ok) {
    const detail = (typeof res.text === 'function') ? await res.text().catch(() => '') : '';
    throw new Error(
      `shot "${spec.id}": server rejected /done (status ${res.status}) -- ` +
      `the post-capture scene-readiness check failed` + (detail ? `: ${detail}` : ''));
  }
}

// instance-legend.json は Layer 3 が「どの家具が消えたか」を名指しするための
// 唯一の手がかりである。これが書かれないと report.py は部材チェックを一つも
// 行わないまま PASS を出しうる（そのため report.py 側でも欠落を致命扱いに
// している）。instance ガイドを撮るショットでは必ず1回書く。
async function postInstanceLegend(spec) {
  const legend = window.__PV_CAPTURE__.getInstanceLegend();
  if (!Array.isArray(legend) || legend.length === 0) {
    throw new Error(
      'instance legend is empty after capturing the instance guide — ' +
      'Layer 3 would be unable to name which furniture vanished');
  }
  await postJson(spec.id, '/instance-legend', { version: 2, instances: legend });
  log(`instance-legend.json written (${legend.length} instances)`);
}

// spec が指すプランが実際にアプリへ読み込まれているかを確かめる。
// アプリは IndexedDB の保存プラン・共同編集プラン・取り込みファイルのいずれかを
// 復元していることがあり、その場合 spec が名指しした家とは**別の家**が
// レンダされる。走り切ってファイルも揃い、ゲートも通り、しかし検証したのは
// 別の建物、という最悪の失敗になるため、撮り始める前に必ず突き合わせる。
function assertPlanMatchesSpec(spec) {
  const actual = window.__PV_CAPTURE__.getPlanId();
  if (actual !== spec.plan) {
    throw new Error(
      `plan mismatch: shot spec asks for "${spec.plan}" but the app has ` +
      `"${actual}" loaded. The truth render would be of a different house. ` +
      'Clear the saved plan (or open the capture page in a fresh profile) and retry.');
  }
  log(`plan verified: ${actual}`);
}

// 内観3D(3d-int)は間取りを上から読ませるため天井を作らず、太陽も消灯している。
// つまり「窓から入る日射」はレンダに一切含まれていない。それを知らずに映像生成へ
// 「窓から差し込む午後の光」を頼んだ結果、モデルが好きな場所に光源を発明した。
// spec が内観採光を要求したら、アプリ側フックに天井のシャドウオクルーダーと
// 実光源の太陽を入れさせ、**本当に効いたか**を戻り値で確かめる。ここで確かめないと、
// 太陽が点かないまま(=以前と同じ光の無い絵で)全フレームを撮り切ってしまう。
function assertDaylightApplied(spec, applied) {
  const head = `shot "${spec.id}": interior daylight was requested but`;
  if (!applied || typeof applied !== 'object') {
    throw new Error(`${head} the app returned no daylight state at all`);
  }
  if (applied.enabled !== true) {
    throw new Error(`${head} the app reports it is not enabled`);
  }
  if (!(applied.sunIntensity > 0)) {
    throw new Error(
      `${head} the sun is still off (intensity ${JSON.stringify(applied.sunIntensity)}). ` +
      'Every frame would again contain no daylight.');
  }
  if (applied.sunCastShadow !== true) {
    throw new Error(
      `${head} the sun casts no shadows. Sunlight would pass straight through the ` +
      'ceiling and walls instead of entering through the windows.');
  }
  if (!(applied.ceilingOccluders > 0)) {
    throw new Error(
      `${head} no ceiling occluders were built. Daylight would pour straight down ` +
      'into a room whose ceiling is not drawn — exactly the defect this guards against.');
  }
}

function applyDaylight(spec) {
  const want = daylightRequest(spec);
  if (!want) return null;
  if (typeof window.__PV_CAPTURE__.setInteriorDaylight !== 'function') {
    throw new Error(
      `shot "${spec.id}" asks for interior daylight, but the capture hook in index.html ` +
      'does not expose setInteriorDaylight (stale page or older build).');
  }
  const applied = window.__PV_CAPTURE__.setInteriorDaylight(want);
  assertDaylightApplied(spec, applied);
  log(`interior daylight on: sun intensity ${applied.sunIntensity} (scale ${applied.sunScale}), ` +
      `${applied.ceilingOccluders} ceiling occluder(s), shadow camera span ${applied.shadowCameraSpanM}m`);
  return applied;
}

// shot.json の中身。spec そのものに加え、内観採光を使ったショットでは
// 「実際にシーンへ効いた採光」(太陽の強度・向き・天井オクルーダー枚数)を
// daylight.applied として残す。動画を見比べなくても、成果物のファイルだけで
// 日射があったかどうかが判る状態にしておくため。
function shotDoc(spec, daylight, extra) {
  const doc = { ...spec, ...(extra || {}) };
  if (daylight) doc.daylight = { ...spec.daylight, applied: daylight };
  return doc;
}

// PNG の IHDR チャンクから width/height を読む。PNG は先頭8バイトの署名の直後に
// 必ず IHDR チャンクが来る（length:4, type:"IHDR":4, width:4, height:4、
// いずれもビッグエンディアン）と規格で決まっているため、先頭24バイトだけで
// 十分に幅・高さが分かる。base64 は4文字ごとに3バイトへ対応するので、
// 24バイト分(先頭32文字で十分だが安全のため64文字)を切り出しても、それだけで
// 独立してデコードできる有効な base64 断片になる — 末尾のパディング欠如を
// 気にする必要がない。<img>/createImageBitmap を経由するデコードは非同期で
// ブラウザの画像デコーダに依存し、それ自体が別の失敗経路になり得るため、
// ここでは同期的でブラウザ非依存なバイト解析を選ぶ。
function pngDimensionsFromDataUrl(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const head = dataUrl.slice(commaIdx + 1, commaIdx + 1 + 64);
  let bin;
  try {
    bin = atob(head);
  } catch (e) {
    return null;
  }
  if (bin.length < 24) return null;
  const b = new Uint8Array(24);
  for (let i = 0; i < 24; i++) b[i] = bin.charCodeAt(i);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (b[i] !== sig[i]) return null;
  }
  const chunkType = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunkType !== 'IHDR') return null;
  const width = b[16] * 16777216 + b[17] * 65536 + b[18] * 256 + b[19];
  const height = b[20] * 16777216 + b[21] * 65536 + b[22] * 256 + b[23];
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

// ショット内の全フレーム(base だけでなく全 guide 種別)が同一ピクセル寸法である
// ことを強制する。captureCurrent3DDataUrl 側にはリトライで縮小画像を返す
// フォールバック分岐があり、それが1フレームだけ発火すると Layer 3 の比較が
// 気づかれずに崩れるため、寸法が決定できない/一致しないケースは直ちに例外で
// 落とす。黙って通す・自動修復するのではなく、ここで止めるのが目的。
function createFrameSizeGuard() {
  let expected = null;
  return function assertFrameSize(kind, index, dataUrl) {
    const dims = pngDimensionsFromDataUrl(dataUrl);
    if (!dims) {
      throw new Error(`frame ${kind}/${index}: could not determine pixel dimensions from captured PNG`);
    }
    if (!expected) {
      expected = dims;
      return;
    }
    if (dims.width !== expected.width || dims.height !== expected.height) {
      throw new Error(
        `frame ${kind}/${index}: pixel size changed mid-shot ` +
        `(expected ${expected.width}x${expected.height}, got ${dims.width}x${dims.height})`
      );
    }
  };
}

// レンダラの状態が確実に落ち着くまで待つ。1フレームでは shadowMap の
// 更新が間に合わないことがあるため2フレーム分待つ。
//
// ブラウザはページが hidden（他タブに切り替わった/最小化された等）のとき
// requestAnimationFrame を一切呼ばない。renderNow() はここで明示的・同期的に
// 呼んでいるので、rAF の発火自体には依存していない — rAF は「表示中なら
// 正確なフレーム間隔で待てる」という最適化に過ぎない。そのため、2連続 rAF と
// タイムアウトを競走させ、どちらか早い方で解決する。表示中は rAF が勝ち、
// 非表示（無人運用中の長尺ショットで起こりうる）ではタイマーが勝って進行が
// 止まらない。片方が解決したらもう片方は捨てる（タイマーは clearTimeout、
// 二重解決は resolved フラグで防ぐ）。
const FRAME_SETTLE_FALLBACK_MS = 100; // 2フレーム分を安全側に見た時間。60fpsなら2フレームは約33msだが、
                                       // 低速な環境でも確実に賄えるよう2〜3倍の余裕を持たせている。
function settle() {
  return new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const timer = setTimeout(finish, FRAME_SETTLE_FALLBACK_MS);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        finish();
      });
    });
  });
}

const VIEW_READY_TIMEOUT_MS = 5000;

// spec.floor はアプリ自身のフロア切替経路(setFloor -> onFloorChange)に委譲する。
// setView('3d-int') は内観のカメラ位置・境界ボックスを ST.floor から算出するため
// (index.html の setView 内 `flWalls=DATA.walls.filter(w=>w.floor===ST.floor)` 参照)、
// フロアが正しく切り替わっていないと 3D ビュー自体が別の階を映してしまう。
// そのため必ずビュー切替より前にフロアを確定させる。setFloor の呼び出しが
// 実際に反映されたかどうかは戻り値を信用せず、getFloor で改めて読み返して確認する。
function ensureFloorApplied(spec) {
  window.__PV_CAPTURE__.setFloor(spec.floor);
  const actual = window.__PV_CAPTURE__.getFloor();
  if (actual !== spec.floor) {
    throw new Error(`floor did not take effect: requested ${spec.floor}, app is at ${actual}`);
  }
}

// アプリは 2D 平面図で起動することがあり、その状態では ensure3D() は
// ビューを切り替えず即座に false を返す。まず spec.view へ明示的に
// 切り替え、その上でレンダリング可能になるまで実際の状態をポーリングする。
// 固定 setTimeout の代わりに settle() を挟んで rAF ベースで待つ。
async function ensureViewRenderable(spec) {
  ensureFloorApplied(spec);
  window.__PV_CAPTURE__.setView(spec.view);
  const start = Date.now();
  for (;;) {
    if (window.__PV_CAPTURE__.ensure3D()) return;
    if (Date.now() - start > VIEW_READY_TIMEOUT_MS) {
      throw new Error(`view "${spec.view}" never became renderable within ${VIEW_READY_TIMEOUT_MS}ms`);
    }
    await settle();
  }
}

// 家具はGLTFLoaderで非同期に読み込まれる。ensureViewRenderable() が見ている
// 「ビューが描画可能」は three.js のレンダラ/シーン自体の準備でしかなく、
// 個々の家具モデルのダウンロード完了とは無関係 -- 実際、これが原因で空の部屋を
// 撮り切ってしまう事故が起きた(furniture未ロードのまま10秒でDONEが出た)。
// window.__PV_CAPTURE__.pendingModelLoads() はアプリ本体が持つ唯一の権威的な
// 保留リスト(_modelLoading)をそのまま返す。ここではそれが空になるまで待つ
// だけで、何が「揃った」と見なすかの判断はアプリ側に委ねる。
// ビュー待ちより長いタイムアウトを与える: GLBは数MB単位でネットワーク越しに
// 落ちてくることがあり、レンダラの初期化より一桁遅くて当然のため。
// timeoutMs を引数化してテストから短縮できるようにしている(既定値は本番用の
// export MODEL_LOAD_TIMEOUT_MS のまま)。
export const MODEL_LOAD_TIMEOUT_MS = 30000;

export async function ensureModelsLoaded(spec, timeoutMs = MODEL_LOAD_TIMEOUT_MS) {
  const start = Date.now();
  for (;;) {
    const pending = window.__PV_CAPTURE__.pendingModelLoads();
    if (!pending.length) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `shot "${spec.id}": furniture models still loading after ${timeoutMs}ms: ` +
        pending.join(', '));
    }
    await settle();
  }
}

// instance / edge のキャプチャは呼ぶたびに window.__PV_CAPTURE__.getInstanceLegend()
// を更新する (index.html の captureGuide 参照)。runner はショットの最後に
// getInstanceLegend() を1回だけ読んで instance-legend.json として POST する
// (postInstanceLegend)。つまり実際に書き出される legend は「最後に instance/edge
// を撮ったときの id→色対応」であり、途中のフレームで撮った instance guide
// PNG 群がその対応と食い違っていないという保証は、これまでコード上どこにも
// 無かった。instance id は three.js シーンを traverse した順に採番されるため、
// シーングラフの構成が撮影中に変わる（フロア切替の副作用、非決定的な走査順、
// 将来的なコード変更など）と、途中のフレームだけ別の id→色対応で焼かれた
// instance PNG が残り、最後に POST される legend はそれを正しく読めない —
// 全 per-instance スコアが黙って壊れる、という誰も気づけない失敗になる。
// そのためここで、instance/edge を撮るたびに得られる legend を直前までの
// ものと突き合わせ、id→色の対応が変わっていたら即座に例外で止める。
function legendColourMap(legend) {
  const map = {};
  for (const entry of legend) map[entry.id] = entry.color;
  return map;
}

function createLegendGuard() {
  let expected = null;
  return function assertLegendStable(index, legend) {
    if (!Array.isArray(legend) || legend.length === 0) return; // まだ何も撮っていない
    const map = legendColourMap(legend);
    if (!expected) { expected = map; return; }
    const expectedIds = Object.keys(expected);
    const gotIds = Object.keys(map);
    if (expectedIds.length !== gotIds.length) {
      throw new Error(
        `instance id->colour mapping changed mid-shot at frame ${index}: ` +
        `expected ${expectedIds.length} instances, got ${gotIds.length}. ` +
        'A silent remap would corrupt every per-instance fidelity score.');
    }
    for (const id of expectedIds) {
      if (map[id] !== expected[id]) {
        throw new Error(
          `instance id->colour mapping changed mid-shot at frame ${index}: ` +
          `id ${id} was ${expected[id]}, is now ${map[id]}. ` +
          'A silent remap would corrupt every per-instance fidelity score.');
      }
    }
  };
}

async function captureAt(spec, t, index, kinds, assertFrameSize, assertLegendStable) {
  const pose = sampleCameraPath(spec.camera.keys, t);
  window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
  window.__PV_CAPTURE__.renderNow();
  await settle();
  for (const kind of kinds) {
    const dataUrl = await window.__PV_CAPTURE__.captureGuide(kind);
    assertFrameSize(kind, index, dataUrl);
    if (kind === 'instance' || kind === 'edge') {
      assertLegendStable(index, window.__PV_CAPTURE__.getInstanceLegend());
    }
    await postFrame(spec.id, kind, index, dataUrl);
  }
}

function sameVec3(a, b) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

async function runDeterminismProbe(spec, assertFrameSize) {
  log('determinism probe: pose A -> B -> A');
  // 時刻は spec の camera.keys から取る。以前は [0,1,2] を直書きしていたため、
  // fps・duration・キー時刻をどう書いてもプローブは同じ3枚しか撮らなかった。
  // check_determinism.py は 0000 と 0002 の byte 一致・0001 との相違を見るので、
  // 「1枚目と3枚目が同一姿勢、2枚目が別姿勢」という前提そのものをここで検査する。
  const keys = spec.camera.keys;
  if (keys.length !== 3) {
    throw new Error(
      `determinism probe needs exactly 3 camera keys (A, B, A), got ${keys.length}`);
  }
  if (!sameVec3(keys[0].pos, keys[2].pos) || !sameVec3(keys[0].target, keys[2].target) ||
      keys[0].fov !== keys[2].fov) {
    throw new Error('determinism probe: the first and last camera keys must be the same pose');
  }
  if (sameVec3(keys[0].pos, keys[1].pos) && sameVec3(keys[0].target, keys[1].target)) {
    throw new Error('determinism probe: the middle camera key must be a different pose');
  }
  const times = keys.map(k => k.t);
  for (let i = 0; i < times.length; i++) {
    const pose = sampleCameraPath(spec.camera.keys, times[i]);
    window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
    window.__PV_CAPTURE__.renderNow();
    await settle();
    const dataUrl = await window.__PV_CAPTURE__.captureGuide('base');
    assertFrameSize('probe', i, dataUrl);
    await postFrame(spec.id, 'probe', i, dataUrl);
  }
  log('determinism probe complete');
  return times.length;
}

async function runSequence(spec, assertFrameSize) {
  const times = frameTimes(spec);
  const guideAt = new Set(guideFrameIndices(spec));
  // base を撮るかどうかも spec.guides に従う。以前は spec が base を挙げて
  // いなくても常に撮っていたため、spec がキャプチャ内容の記述として信用
  // できなかった。
  const wantsBase = spec.guides.includes('base');
  const extraGuides = spec.guides.filter(g => g !== 'base');
  if (!wantsBase && extraGuides.length === 0) {
    throw new Error('shot spec: guides is empty; there is nothing to capture');
  }
  const assertLegendStable = createLegendGuard();
  for (let i = 0; i < times.length; i++) {
    const kinds = [];
    if (wantsBase) kinds.push('base');
    if (guideAt.has(i)) kinds.push(...extraGuides);
    if (kinds.length) await captureAt(spec, times[i], i, kinds, assertFrameSize, assertLegendStable);
    if (i % 10 === 0) log(`frame ${i + 1}/${times.length}`);
  }
  if (spec.guides.includes('instance')) await postInstanceLegend(spec);
  log(`complete: ${times.length} frames`);
  return times.length;
}

export async function main() {
  const shotName = pvParams().get('pvShot');
  if (!shotName) { log('no pvShot given; idle'); return; }
  const res = await fetch(`/pv/tools/truth-render/specs/${shotName}.json`);
  if (!res.ok) throw new Error(`spec not found: ${shotName}`);
  const spec = validateShotSpec(await res.json());

  // キャプチャはアプリの状態を作り変える。どこで失敗しても finally で
  // 元に戻せるよう、触る前に全部控えておく。
  const prevFloor = window.__PV_CAPTURE__.getFloor();
  const prevView = window.__PV_CAPTURE__.getView();
  const prevOrbit = window.__PV_CAPTURE__.captureOrbitState();

  let prevViewport;
  let daylight = null;
  const assertFrameSize = createFrameSizeGuard();
  try {
    await ensureViewRenderable(spec);
    assertPlanMatchesSpec(spec);
    // 採光の適用はシーンを作り直す(天井の生成)。GLBの待ちより先に置き、
    // 再構築で発生しうるモデル読み込みも下の ensureModelsLoaded が拾えるようにする。
    daylight = applyDaylight(spec);
    // ビューが「描画可能」になっただけでは、build3D() が投げた家具GLBの
    // 非同期ロードが終わっている保証は無い -- これが直った理由: この待ちが
    // 無かったせいで、空の部屋を10秒で撮り切ってDONEを出す事故が実際に起きた
    // (105秒かかるはずの spec が10秒で完走した)。plan照合より後に置くのは、
    // 別の家がロード中のモデルを待っても無意味なため。
    await ensureModelsLoaded(spec);

    // 設計どおり、検証済み spec の実体を出力ディレクトリへ複写する。
    // これが無いと pv/renders/<shot>/ を後から見ても、どの spec・どの階・
    // どのカメラキーで撮ったものかがディスク上のどこにも残らない。
    await postJson(spec.id, '/shot', shotDoc(spec, daylight));

    // spec.resolution が実際に消費されるのはここだけ。#c3d-wrap の見た目サイズは
    // ブラウザウィンドウ任せなので、固定しないとフレームのアスペクト比・寸法が
    // ショット中に揺れ、狙った画角も再現できない。setCaptureViewport 自体が
    // 途中で失敗してもユーザーの画面をリサイズしたまま残さないよう、
    // 呼び出しごと try に入れて必ず finally で元に戻す。
    prevViewport = window.__PV_CAPTURE__.setCaptureViewport(
      spec.resolution.width,
      spec.resolution.height
    );
    // モードは spec に明示させる。以前は spec.id === 'probe-determinism' で
    // 判定していたため、spec ファイルの改名だけで再現性ゲートが黙って
    // ただの連番キャプチャに化けた。
    //
    // 所要時間とフレーム数を控えて shot.json に残す。この2つこそが、今回の
    // 事故を誰にでも見える形で示せたはずの数値 -- 同じ spec が以前は105秒
    // かかっていたのに、家具未ロードのまま10秒で完走した。人間が動画を
    // 見比べて初めて気づいたが、本来は成果物を見るだけで分かるべきだった。
    const startedAt = Date.now();
    const frameCount = (shotMode(spec) === 'determinism-probe')
      ? await runDeterminismProbe(spec, assertFrameSize)
      : await runSequence(spec, assertFrameSize);
    const tookMs = Date.now() - startedAt;
    log(`capture took ${tookMs}ms for ${frameCount} frame(s)`);
    await postJson(spec.id, '/shot', shotDoc(spec, daylight, { capture: { tookMs, frameCount } }));

    // DONE はここで初めて要求する。サーバ側がシーン完全性を検査した後で
    // なければ、"完走してDONEが出た" こと自体を安全とみなせない。
    await postDone(spec);
  } finally {
    // 採光はアプリの見た目そのものを変える(天井を作り、太陽を点ける)。
    // 途中で落ちた場合も含め、ユーザーの画面へは必ず元の内観を返す。
    if (daylight) window.__PV_CAPTURE__.setInteriorDaylight(null);
    if (prevViewport) window.__PV_CAPTURE__.restoreCaptureViewport(prevViewport);
    window.__PV_CAPTURE__.restoreOrbitState(prevOrbit);
    if (prevView !== undefined && prevView !== window.__PV_CAPTURE__.getView()) {
      window.__PV_CAPTURE__.setView(prevView);
    }
    if (prevFloor !== undefined && prevFloor !== window.__PV_CAPTURE__.getFloor()) {
      window.__PV_CAPTURE__.setFloor(prevFloor);
    }
  }
}

// ブラウザで ?pvCapture=1 が付いているときだけ自動起動する。テストからは
// main() を直接呼ぶ。
if (typeof location !== 'undefined' && pvParams().get('pvCapture') === '1') {
  main().catch(e => { console.error('[pv-capture] failed', e); });
}
