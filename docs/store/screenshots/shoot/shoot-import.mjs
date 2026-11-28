// App Store 用「間取り図を読み込むと 3D で再現される」の撮影。headless Chromium(Metal)。
//
// 使い方（このフォルダで）:
//   PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node shoot-import.mjs rehearse
//       手元の配信物（APP_URL、既定 http://127.0.0.1:8943/）で、画像を選ぶ → 範囲を選ぶ → 送る直前まで。AI は呼ばない。
//   PLAYWRIGHT_MODULE=... APP_URL=https://cad-planner.srapps.us/ node shoot-import.mjs live
//       本番で 1 回だけ読み取りを走らせ、a〜e を撮り、取り込んだあとのプランを imported-plan.json に保存する。
//       本番の AI を呼ぶ（1 日の上限と費用がある）。むやみに回さない。
//   PLAYWRIGHT_MODULE=... node shoot-import.mjs replay
//       手元の配信物で imported-plan.json を読み込み、d・e だけを撮り直す。AI は呼ばない。
//
// 撮影のときだけしていること:
//   - window.Capacitor を置く。pr-ads.js の adsMode() が 'app'（アプリ版）になり、Web 版の広告枠（A8.net）が出ない。
//     アプリ版と同じ見え方にするための正規の切り替え。Capacitor を見ているのは pr-ads.js だけ。
//   - 共同編集（/api/rooms）と MCP の通信は止める。rehearse / replay では /api/ai も止める。
const pw = await import(process.env.PLAYWRIGHT_MODULE || '/Users/nariiwa/Projects/echoglass/node_modules/playwright-core/index.mjs');
const chromium = pw.chromium || pw.default.chromium;
const fs = await import('node:fs');
const OUT = new URL('.', import.meta.url).pathname;
const MODE = process.argv[2] || 'rehearse';
const APP = process.env.APP_URL || 'http://127.0.0.1:8943/';
const SHOT_DIR = process.env.SHOT_DIR || OUT;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, locale: 'ja-JP' };
const HINT = process.env.HINT ?? '';

async function open(q, { allowAi }) {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--lang=ja-JP'] });
  const ctx = await browser.newContext(IPHONE);
  await ctx.addInitScript(() => { window.Capacitor = window.Capacitor || {}; });
  await ctx.route(/\/api\/(rooms|mcp)/, (r) => r.fulfill({ status: 503, body: '{}' }));
  if (!allowAi) await ctx.route(/\/api\/ai\//, (r) => r.fulfill({ status: 503, body: '{}' }));
  const page = await ctx.newPage();
  const log = [];
  page.on('pageerror', (e) => log.push('pageerror ' + e.message));
  page.on('dialog', (d) => d.dismiss());
  page.on('request', (r) => { if (/\/api\/ai\//.test(r.url())) console.log('[ai request]', r.method(), new URL(r.url()).pathname); });
  await page.goto(APP + q);
  await page.waitForFunction(() => window.DATA && DATA.walls.length > 0, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { browser, page, log };
}
async function settle3d(page, extra = 3000) {
  await page.waitForFunction(() => window.ren && typeof hasPendingGltfModels === 'function' && !hasPendingGltfModels() && !window._gltfRebuildTimer, null, { timeout: 240000 }).catch(() => console.log('settle timeout'));
  await page.waitForFunction(() => { const l = document.getElementById('app-loading'); return !l || !l.classList.contains('show'); }, null, { timeout: 120000 }).catch(() => console.log('loading timeout'));
  await page.waitForTimeout(extra);
}
async function view(page, v) { await page.evaluate((v) => setView(v), v); await settle3d(page); }
async function floor(page, f) { await page.evaluate((f) => { const s = document.getElementById('floor-sel'); if (s) { s.value = String(f); s.dispatchEvent(new Event('change')); } }, f); await page.waitForTimeout(1200); }
async function shot(page, name) { await page.screenshot({ path: SHOT_DIR + name + '.png' }); console.log('saved', name); }
async function cam(page, pos, target) { await page.evaluate(([p, t]) => { applyStashedCamera({ pos: p, target: t }); if (typeof render3DNow === 'function') render3DNow(); }, [pos, target]); await page.waitForTimeout(2500); }
// 家が画面に収まる外観のカメラ（前回の撮影 20 番と同じ向き。中心は家の外形から出す）
async function houseCenter(page) {
  return page.evaluate(() => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    DATA.walls.forEach((w) => { x0 = Math.min(x0, w.x1, w.x2); x1 = Math.max(x1, w.x1, w.x2); y0 = Math.min(y0, w.y1, w.y2); y1 = Math.max(y1, w.y1, w.y2); });
    return [((x0 + x1) / 2) * U, ((y0 + y1) / 2) * U, (x1 - x0) * U, (y1 - y0) * U];
  });
}
const extCam = (k, t) => [[t[0] + 12.5 * k, t[1] + 8.5 * k, t[2] + 17.8 * k], t];
async function hideNeighbors(page) { await page.evaluate(() => { DATA.items.filter((i) => String(i.type).startsWith('neighbor-')).forEach((i) => (i.hidden3D = true)); }); }

// 起動 → 「間取り図の画像から下書きを作る」→ 画像を選ぶ。a を撮る。
async function pickImage(page) {
  await page.waitForSelector('#preset-choice-modal .preset-blank-btn', { timeout: 30000 });
  await page.locator('#preset-choice-modal .preset-blank-btn', { hasText: '間取り図の画像から下書きを作る' }).click();
  await page.waitForSelector('#plan-import-modal.show');
  await page.setInputFiles('#plan-import-file', OUT + 'sample-floorplan.png');
  await page.waitForSelector('#plan-import-canvas', { state: 'visible' });
  if (HINT) await page.fill('#plan-import-hint', HINT);
  // 入力欄の枠（フォーカス）を外し、補足の文頭が見えるようにする
  await page.evaluate(() => { const h = document.getElementById('plan-import-hint'); h.blur(); h.scrollLeft = 0; });
  await page.waitForTimeout(1500);
  // 図面のプレビューを画面の中ほどに出す
  await page.evaluate(() => document.getElementById('plan-import-canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
}

// 操作の案内（平面図の「タップで選択…」と内観3Dの「1本指:視点回転…」）は時間で消えないので、撮影のときだけ隠す。
async function hideHints(page) { await page.addStyleTag({ content: '#help-box,#joy-hint{visibility:hidden!important}' }); }

async function shootAfterImport(page, prefix) {
  await hideHints(page);
  // d: 取り込んだあとの平面図（1階・2階）
  await floor(page, 1); await page.evaluate(() => { resetView(); draw2d(); }); await page.waitForTimeout(1500);
  await shot(page, prefix + 'd');
  await floor(page, 2); await page.evaluate(() => { resetView(); draw2d(); }); await page.waitForTimeout(1500);
  await shot(page, prefix + 'd2');
  await floor(page, 1);
  // e: 外観 3D（隣家を隠し、家が収まるカメラ）
  await hideNeighbors(page);
  await view(page, '3d-ext');
  const [cx, cz, w, d] = await houseCenter(page);
  const k = Math.max(1.2, Math.max(w, d) / 8.2 * 1.75);
  const [p, t] = extCam(k, [cx, 2.6, cz]);
  await cam(page, p, t);
  await shot(page, prefix + 'e');
  // e2: 内観 3D（1階の俯瞰）
  await view(page, '3d-int');
  await cam(page, [cx + 7, 19, cz + 14], [cx, 0, cz]);
  await shot(page, prefix + 'e2');
}

if (MODE === 'rehearse') {
  const { browser, page, log } = await open('', { allowAi: false });
  await pickImage(page);
  await shot(page, process.env.A_NAME || 'rehearse-a');
  console.log('run button enabled:', await page.evaluate(() => !document.getElementById('plan-import-run').disabled));
  console.log(log.join('\n'));
  await browser.close();
} else if (MODE === 'live') {
  const { browser, page, log } = await open('', { allowAi: true });
  await pickImage(page);
  await shot(page, 'import-a');
  const quota = await page.evaluate(() => document.getElementById('plan-import-quota').textContent);
  console.log('quota:', quota);
  const t0 = Date.now();
  await page.click('#plan-import-run');
  // b: 読み取り中（進み具合の帯と、作ったものの数が出ている所）
  await page.waitForSelector('#plan-import-progress:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => /壁 \d+/.test(document.getElementById('plan-import-progress-made').textContent), null, { timeout: 600000 })
    .catch(() => console.log('progress-made never appeared'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('plan-import-progress').scrollIntoView({ block: 'center' }));
  await shot(page, 'import-b');
  // c: 結果（取り込む前）
  await page.waitForFunction(() => { const s = document.getElementById('plan-import-step3'); const st = document.getElementById('plan-import-status').textContent; return (s && s.style.display !== 'none') || /できませんでした|失敗|使い切り/.test(st); }, null, { timeout: 15 * 60000 });
  console.log('read took', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  const status = await page.evaluate(() => document.getElementById('plan-import-status').textContent);
  console.log('status:', status);
  const ok = await page.evaluate(() => document.getElementById('plan-import-step3').style.display !== 'none');
  if (!ok) { await shot(page, 'import-error'); console.log(log.join('\n')); await browser.close(); process.exit(2); }
  const resultText = await page.evaluate(() => ({ summary: document.getElementById('plan-import-summary').textContent, rooms: document.getElementById('plan-import-rooms').textContent, notes: document.getElementById('plan-import-notes').textContent }));
  fs.writeFileSync(OUT + 'import-result.txt', JSON.stringify(resultText, null, 2));
  await page.evaluate(() => document.getElementById('plan-import-step3').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(800);
  await shot(page, 'import-c');
  // 取り込む（確認が出れば「取り込む」）
  await page.click('#plan-import-apply');
  await page.waitForTimeout(800);
  if (await page.locator('#plan-import-confirm:not([hidden])').count()) await page.click('#plan-import-confirm-yes');
  await page.waitForFunction(() => !document.getElementById('plan-import-modal').classList.contains('show'), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  fs.writeFileSync(OUT + 'imported-plan.json', await page.evaluate(() => JSON.stringify(DATA, (k, v) => (k === '_texObj' ? undefined : v), 2)));
  console.log('saved imported-plan.json');
  await shootAfterImport(page, 'import-');
  console.log(log.join('\n'));
  await browser.close();
} else if (MODE === 'replay') {
  const { browser, page, log } = await open('?preset=2f', { allowAi: false });
  await page.evaluate(() => { if (typeof closePresetChoice === 'function') closePresetChoice(); });
  await page.setInputFiles('#import-file', OUT + 'imported-plan.json');
  await page.waitForTimeout(4000);
  await shootAfterImport(page, process.env.PREFIX ?? 'import-');
  console.log(log.join('\n'));
  await browser.close();
}
