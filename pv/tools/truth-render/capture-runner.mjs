// index.html のページ内で連番キャプチャを駆動する。
// window.__PV_CAPTURE__ が既に露出している前提。

import { sampleCameraPath } from './camera-path.mjs';
import { validateShotSpec, frameTimes, guideFrameIndices } from './shot-spec.mjs';

const params = new URLSearchParams(location.search || '');
const shotName = params.get('pvShot');
const serverPort = params.get('pvServer') || '8932';
const server = `http://127.0.0.1:${serverPort}`;

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
  const res = await fetch(`${server}/frame`, {
    method: 'POST',
    headers: { 'X-PV-Shot': shot, 'X-PV-Kind': kind, 'X-PV-Index': String(index) },
    body: dataUrlToBlob(dataUrl),
  });
  if (!res.ok) throw new Error(`frame ${kind}/${index} rejected: ${res.status}`);
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

async function captureAt(spec, t, index, kinds, assertFrameSize) {
  const pose = sampleCameraPath(spec.camera.keys, t);
  window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
  window.__PV_CAPTURE__.renderNow();
  await settle();
  for (const kind of kinds) {
    const dataUrl = await window.__PV_CAPTURE__.captureGuide(kind);
    assertFrameSize(kind, index, dataUrl);
    await postFrame(spec.id, kind, index, dataUrl);
  }
}

async function runDeterminismProbe(spec, assertFrameSize) {
  log('determinism probe: pose A -> B -> A');
  const times = [0, 1, 2];
  for (let i = 0; i < times.length; i++) {
    const pose = sampleCameraPath(spec.camera.keys, times[i]);
    window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
    window.__PV_CAPTURE__.renderNow();
    await settle();
    const dataUrl = await window.__PV_CAPTURE__.captureGuide('base');
    assertFrameSize('probe', i, dataUrl);
    await postFrame(spec.id, 'probe', i, dataUrl);
  }
  await fetch(`${server}/done`, { method: 'POST', headers: { 'X-PV-Shot': spec.id } });
  log('determinism probe complete');
}

async function runSequence(spec, assertFrameSize) {
  const times = frameTimes(spec);
  const guideAt = new Set(guideFrameIndices(spec));
  const extraGuides = spec.guides.filter(g => g !== 'base');
  for (let i = 0; i < times.length; i++) {
    const kinds = guideAt.has(i) ? ['base', ...extraGuides] : ['base'];
    await captureAt(spec, times[i], i, kinds, assertFrameSize);
    if (i % 10 === 0) log(`frame ${i + 1}/${times.length}`);
  }
  await fetch(`${server}/done`, { method: 'POST', headers: { 'X-PV-Shot': spec.id } });
  log(`complete: ${times.length} frames`);
}

async function main() {
  if (!shotName) { log('no pvShot given; idle'); return; }
  const res = await fetch(`/pv/tools/truth-render/specs/${shotName}.json`);
  if (!res.ok) throw new Error(`spec not found: ${shotName}`);
  const spec = validateShotSpec(await res.json());

  await ensureViewRenderable(spec);

  // spec.resolution が実際に消費されるのはここだけ。#c3d-wrap の見た目サイズは
  // ブラウザウィンドウ任せなので、固定しないとフレームのアスペクト比・寸法が
  // ショット中に揺れ、狙った画角も再現できない。setCaptureViewport 自体が
  // 途中で失敗してもユーザーの画面をリサイズしたまま残さないよう、
  // 呼び出しごと try に入れて必ず finally で元に戻す。
  let prevViewport;
  const assertFrameSize = createFrameSizeGuard();
  try {
    prevViewport = window.__PV_CAPTURE__.setCaptureViewport(
      spec.resolution.width,
      spec.resolution.height
    );
    if (spec.id === 'probe-determinism') await runDeterminismProbe(spec, assertFrameSize);
    else await runSequence(spec, assertFrameSize);
  } finally {
    if (prevViewport) window.__PV_CAPTURE__.restoreCaptureViewport(prevViewport);
  }
}

main().catch(e => { console.error('[pv-capture] failed', e); });
