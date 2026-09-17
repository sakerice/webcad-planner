// 見上げたときに天井がちらつかないこと。
//
// なぜ在るのか
// ------------
// 高さモデルv2では「壁の高さ = 仕上げ床 → 仕上げ天井」なので、天井の面は
// **上に在るもの(上階の床スラブ・屋根)の下端とちょうど同じ高さ**に来る。これは
// そういう作りであってずれではないが、同じ高さの2枚は画素ごとにどちらが手前かが
// 入れ替わり、視点が動くとちらつく。ウォークスルーで顕著だった(報告: 天井の
// ちらつきが激しい)。
//
// 幾何を動かして隙間を作ると、今度は天井の高さと器具の取付面がその分だけ嘘に
// なるので、描画の深度だけを天井側へ寄せている(withCeilingDepthBias)。
//
// 何を測るか
// ----------
// 静止画1枚ではちらつきは写らない。**カメラを1mmだけ動かして同じ絵を2回描き、
// 色が入れ替わった画素を数える。** 争っていれば大きく入れ替わり、決着していれば
// 動かない。実測: 深度を寄せる前 68.1% → 後 0.00%。
import assert from 'node:assert/strict';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = _pw.default || _pw;
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.CeilingDesigner);
  await page.evaluate(() => {
    closePresetChoice();
    document.querySelector('#preset-choice-modal [onclick*="2f"]').click();
  });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((b) => /ウォークスルー/.test(b.textContent));
    if (!b) throw new Error('ウォークスルーのボタンが無い');
    b.click();
  });
  await page.waitForTimeout(6000);

  const measured = await page.evaluate(() => {
    const cam = (typeof camWalk !== 'undefined' && camWalk) || camExt;
    const scene = (typeof scWalk !== 'undefined' && scWalk) || sc3;
    const room = DATA.rooms.find((q) => q.floor === 1 && q.w > 2800 && q.d > 2800
      && roomHasCoverAbove(q) && !roomCeilingProfile(q));
    if (!room) throw new Error('見上げる部屋が無い');
    const cx = (room.x + room.w / 2) * U, cz = (room.y + room.d / 2) * U;
    // 部屋の真ん中に立って天井を見上げる。描いた直後に読むので、
    // preserveDrawingBuffer が無くても画素が取れる。
    const shot = (dy) => {
      cam.position.set(cx, floorTopY(1) + 1.5 + dy, cz);
      cam.lookAt(cx, floorTopY(1) + 3.0, cz + 0.01);
      cam.updateProjectionMatrix();
      ren.render(scene, cam);
      const gl = ren.getContext(), w = ren.domElement.width, h = ren.domElement.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const a = shot(0), b = shot(0.001);
    let lit = 0, flipped = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0 && b[i + 3] === 0) continue;
      lit++;
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 24) flipped++;
    }
    const ceilings = [];
    scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.ceiling) ceilings.push(!!o.material.polygonOffset); });
    return { lit, flipped, ceilings: ceilings.length, biased: ceilings.filter(Boolean).length,
      ceilY: floorBaseY(1) + roomCeilingHeightM(room), floorBase2: floorBaseY(2) };
  });

  // 前提: 何も描けていない絵で「ちらつき0」と言わない。
  assert.ok(measured.lit > 100000, '描けている画素が少なすぎる: ' + measured.lit);
  assert.ok(measured.ceilings > 0, '天井のメッシュが1枚も無い（空振りの検査になっている）');
  // 前提: 天井の面と上のものが同じ高さに来ていること自体は、この作りでは正しい。
  assert.ok(Math.abs(measured.ceilY - measured.floorBase2) < 0.001,
    '天井の面と上階の床の始まりがずれている（この検査の前提が変わった）: ' + measured.ceilY + ' / ' + measured.floorBase2);
  assert.equal(measured.biased, measured.ceilings, '深度を寄せていない天井がある');
  const ratio = measured.flipped / measured.lit;
  assert.ok(ratio < 0.01, 'カメラを1mm動かすと ' + (ratio * 100).toFixed(1) + '% の画素が入れ替わる（天井がちらつく）');
  assert.deepEqual(errors, []);
  console.log('天井のちらつき: 入れ替わった画素 ' + (ratio * 100).toFixed(2) + '% / 天井メッシュ ' + measured.ceilings + '枚すべて深度を寄せている');
} finally {
  await browser.close();
}
