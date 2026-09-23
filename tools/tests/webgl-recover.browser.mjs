// WebGLコンテキストを失ったら、3Dを作り直す。
//
// 報告:「2つのタブを行き来していると、明るかったほうも突然暗くなる」。
//
// 端末は裏のタブのWebGLコンテキストを捨てる。iPad Safari で house-planner を
// 2つのタブに開いていれば、ふつうに起きる。捨てられたまま戻ると3Dは**真っ黒**
// になり、そこから自力では戻らない。失われたコンテキストの上に作った物
// （レンダラ・合成器・環境マップ・GPUへ上げたテクスチャ）は1つも使えない。
//
// 直す前の実測: 画面の明るさ 178 → 0。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto((process.env.APP_URL || 'http://localhost:8932/') + '?preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
  await page.evaluate(() => setView('3d-ext'));
  await page.waitForTimeout(7000);

  // 画面の明るさ。真っ黒になったかどうかは、これで分かる。
  const brightness = () => page.evaluate(() => {
    ren.render(sc3, isInt ? camInt : camExt);
    const tmp = document.createElement('canvas');
    tmp.width = 200; tmp.height = 140;
    const g = tmp.getContext('2d');
    g.drawImage(ren.domElement, 0, 0, tmp.width, tmp.height);
    const d = g.getImageData(0, 0, tmp.width, tmp.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    return sum / (d.length / 4);
  });

  const canvasesBefore = await page.evaluate(() => document.querySelectorAll('#c3d-wrap canvas').length);
  const before = await brightness();
  assert.ok(before > 80, '3Dが最初から暗い（この検査の前提が崩れている）: ' + before.toFixed(1));

  // 端末がコンテキストを捨てたときと同じことをする
  const lost = await page.evaluate(() => {
    const ext = ren.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  assert.ok(lost, 'この環境ではコンテキストを落とせない（検査にならない）');
  await page.waitForTimeout(1200);
  assert.ok(await page.evaluate(() => ren.getContext().isContextLost()), 'コンテキストが落ちていない');

  // タブへ戻ってきたときにアプリがやること
  assert.ok(await page.evaluate(() => recover3DIfContextLost()), '作り直しが行われなかった');
  await page.waitForTimeout(6000);

  assert.equal(await page.evaluate(() => ren.getContext().isContextLost()), false,
    'コンテキストが失われたまま');
  const after = await brightness();
  assert.ok(after > before * 0.7,
    '作り直したのに暗いまま（' + before.toFixed(1) + ' → ' + after.toFixed(1) + '）');

  // 二重に組まない。描画ループも文書への購読も1度だけ。
  assert.equal(await page.evaluate(() => document.querySelectorAll('#c3d-wrap canvas').length), canvasesBefore,
    '作り直しで canvas が増えた（古いものが残っている）');

  assert.deepEqual(errors, [], 'ページで例外が出ている: ' + errors.join(' / '));
  console.log('WebGL: コンテキストを失っても、タブへ戻れば3Dが戻る');
} finally {
  await browser.close();
}
