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

// アプリは 2D 平面図で起動することがあり、その状態では ensure3D() は
// ビューを切り替えず即座に false を返す。まず spec.view へ明示的に
// 切り替え、その上でレンダリング可能になるまで実際の状態をポーリングする。
// 固定 setTimeout の代わりに settle() を挟んで rAF ベースで待つ。
async function ensureViewRenderable(spec) {
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

async function captureAt(spec, t, index, kinds) {
  const pose = sampleCameraPath(spec.camera.keys, t);
  window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
  window.__PV_CAPTURE__.renderNow();
  await settle();
  for (const kind of kinds) {
    const dataUrl = await window.__PV_CAPTURE__.captureGuide(kind);
    await postFrame(spec.id, kind, index, dataUrl);
  }
}

async function runDeterminismProbe(spec) {
  log('determinism probe: pose A -> B -> A');
  const times = [0, 1, 2];
  for (let i = 0; i < times.length; i++) {
    const pose = sampleCameraPath(spec.camera.keys, times[i]);
    window.__PV_CAPTURE__.setPose(pose.pos, pose.target, pose.fov);
    window.__PV_CAPTURE__.renderNow();
    await settle();
    const dataUrl = await window.__PV_CAPTURE__.captureGuide('base');
    await postFrame(spec.id, 'probe', i, dataUrl);
  }
  await fetch(`${server}/done`, { method: 'POST', headers: { 'X-PV-Shot': spec.id } });
  log('determinism probe complete');
}

async function runSequence(spec) {
  const times = frameTimes(spec);
  const guideAt = new Set(guideFrameIndices(spec));
  const extraGuides = spec.guides.filter(g => g !== 'base');
  for (let i = 0; i < times.length; i++) {
    const kinds = guideAt.has(i) ? ['base', ...extraGuides] : ['base'];
    await captureAt(spec, times[i], i, kinds);
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
  try {
    prevViewport = window.__PV_CAPTURE__.setCaptureViewport(
      spec.resolution.width,
      spec.resolution.height
    );
    if (spec.id === 'probe-determinism') await runDeterminismProbe(spec);
    else await runSequence(spec);
  } finally {
    if (prevViewport) window.__PV_CAPTURE__.restoreCaptureViewport(prevViewport);
  }
}

main().catch(e => { console.error('[pv-capture] failed', e); });
