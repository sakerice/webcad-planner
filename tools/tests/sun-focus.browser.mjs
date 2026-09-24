// 図面を触ったら、入力欄から焦点を外す。
//
// 報告: 「何かをきっかけに夕暮れ等が適用されてしまう」。
//
// canvas は tabindex を持たないので、クリックしても焦点を受け取らない。
// 日の光の時刻スライダーを一度つまむと焦点はスライダーに残り、そのあと物を
// 選んで矢印キーで動かそうとすると、**物は動かず日の時刻だけが動く**。
// 押しっぱなしにすれば数時間ぶん進み、昼のはずが夕暮れになる。
//
// 直す前の実測: スライダーをつまむ → 図面をクリック → ← を10回 で、
// 物は1mmも動かず 13:36 → 13:06 になった。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto((process.env.APP_URL || 'http://localhost:8932/') + '?preset=2f');
  await page.waitForFunction(() => window.DATA && DATA.walls && DATA.walls.length > 4, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });

  // ── 時刻スライダーを本物のマウスでつまむ ──────────────────────────
  await page.evaluate(() => toggleLightPanel());
  await page.waitForSelector('#sun-hour', { state: 'visible', timeout: 5000 });
  const box = await page.locator('#sun-hour').boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height / 2);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sun-hour',
    'スライダーをつまんでも焦点が載らない（この検査の前提が崩れている）');

  // ── 図面をクリックして物を選ぶ ────────────────────────────────────
  const picked = await page.evaluate(() => {
    // 動かせる物を1つ選ぶ（施錠されていないもの）
    const it = DATA.items.find((i) => (i.floor || 1) === ST.floor && !i.locked &&
      i.type !== 'site-rect' && i.type !== 'foundation' && i.type !== 'roof');
    if (!it) return null;
    const c = document.getElementById('c2d');
    const r = c.getBoundingClientRect();
    const ev = (t) => new MouseEvent(t, { bubbles: true, clientX: r.left + 10, clientY: r.top + 10, button: 0 });
    c.dispatchEvent(ev('mousedown')); c.dispatchEvent(ev('mouseup'));
    ST.selected = it; updateProps();
    return { id: it.id, x: it.x, hour: LIGHT_SETTINGS.hour };
  });
  assert.ok(picked, '動かせる物が1つも無い');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'sun-hour',
    '図面を触ったのに、焦点が時刻スライダーに残っている');

  // ── 矢印キーは、物を動かす。日の時刻は動かさない ──────────────────
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
  const after = await page.evaluate((id) => ({
    hour: LIGHT_SETTINGS.hour,
    x: (DATA.items.find((i) => i.id === id) || {}).x,
  }), picked.id);

  assert.equal(after.hour, picked.hour,
    '矢印キーで日の時刻が動いた（' + picked.hour + ' → ' + after.hour + '）。昼のはずが夕暮れになる');
  assert.ok(after.x < picked.x,
    '矢印キーで物が動いていない（' + picked.x + ' → ' + after.x + '）');

  assert.deepEqual(errors, [], 'ページで例外が出ている: ' + errors.join(' / '));
  console.log('日の光: 図面を触れば焦点が外れ、矢印キーは物だけを動かす');
} finally {
  await browser.close();
}
