// 広い画面で保存したプランを狭い画面で開いたとき、間取りが画面の外に描かれて消えたように見えないこと。
//
// プランは平面図の表示位置・拡大率(viewState.twoD)を持ち、開くとそのまま戻す。幅 1280 などで保存した
// 表示位置を幅 375 で戻すと、間取りが x 753px より右に描かれ、方眼だけが見える。
// 開いた直後に、いま表示している階の間取りが平面図の見える所に少しも入っていないときだけ、
// 「全体表示」(resetView)と同じ表示に切り替える。一部でも見えていれば保存した位置のまま。
//
// 1. 幅の広い画面で記録した表示位置のプラン(saved-2f.json)を 375x667 で開くと、間取りが画面に入る
//    (起動時の復元と、ファイルから開くの 2 つの入口で)
// 2. 間取りが一部見えている表示位置のプランは、開いても表示位置が変わらない
// 3. 同じ大きさで保存して開き直すと、表示位置が変わらない(寄せた表示が保たれる)
// 4. 白紙のプランでは何も起きず、エラーも出ない
// 5. 開いたあとの取り消し(undo)・階の切り替えでは発動しない
//
// SHOT_DIR を渡すと、375x667 で開いた画面を撮って置く(SHOT_TAG で名前の頭を変える)。
//
// sh tools/run_browser_tests.sh plan-offscreen-fit
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAVED_2F = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/compat/saved-2f.json'), 'utf8'));
const SHOT_DIR = process.env.SHOT_DIR || '';
const SHOT_TAG = process.env.SHOT_TAG || 'shot';
const VIEW = { width: 375, height: 667 };

async function waitApp(page) {
  await page.waitForFunction(() => window.DATA && DATA.walls, null, { timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
}
// 描画の数フレームを待つ(開いた直後の判定は、キャンバスの大きさが決まったあとのフレームで走る)
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  await page.waitForTimeout(300);
}
// いまの階の間取りが、平面図の欄(#canvas-area)のどこに描かれているか(CSS の画素)
async function planBox(page) {
  return page.evaluate(() => {
    const b = planSubjectBoundsMm(ST.floor);
    const a = document.getElementById('canvas-area');
    const sc = ST.zoom * 0.05;
    return {
      bounds: !!b,
      x0: b ? ST.panX + b.minX * sc : null, x1: b ? ST.panX + b.maxX * sc : null,
      y0: b ? ST.panY + b.minY * sc : null, y1: b ? ST.panY + b.maxY * sc : null,
      w: a.clientWidth, h: a.clientHeight,
      view: { zoom: ST.zoom, panX: ST.panX, panY: ST.panY },
    };
  });
}
function insideArea(box) {
  return box.x0 >= 0 && box.y0 >= 0 && box.x1 <= box.w && box.y1 <= box.h;
}
function sameView(a, b) {
  return Math.abs(a.zoom - b.zoom) < 1e-9 && Math.abs(a.panX - b.panX) < 1e-6 && Math.abs(a.panY - b.panY) < 1e-6;
}
async function openFile(page, plan, name = 'plan.json') {
  await page.setInputFiles('#import-file', { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.waitForFunction((n) => DATA && Array.isArray(DATA.walls) && DATA.walls.length === n && window._defaultPlanPending === false,
    plan.walls.length, { timeout: 20000 });
  // 初めての起動で出る「はじめる間取りを選んでください」を閉じる(撮った画面で図面が見えるように。表示位置には触らない)
  await page.evaluate(() => { if (typeof closePresetChoice === 'function') closePresetChoice(); });
  await settle(page);
}
async function shot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_TAG}-${name}.png`) });
}
async function newPage(browser, errors) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await waitApp(page);
  return { context, page };
}

const browser = await chromium.launch();
const errors = [];
const failures = [];
async function step(name, fn) {
  try { await fn(); console.log('ok  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('NG  ' + name + '\n    ' + e.message); }
}
try {
  // ── 1a. 起動時の復元(前回のプラン)で開く ──
  await step('幅の広い画面の表示位置を持つプランを、起動時の復元で 375x667 に開くと間取りが画面に入る', async () => {
    const { context, page } = await newPage(browser, errors);
    await page.evaluate((p) => StorageAdapter.save(p), SAVED_2F);
    await page.reload();
    await waitApp(page);
    await page.waitForFunction((n) => DATA.walls.length === n && window._defaultPlanPending === false, SAVED_2F.walls.length, { timeout: 30000 });
    await settle(page);
    const box = await planBox(page);
    await shot(page, 'startup-375x667');
    await context.close();
    assert.ok(box.bounds, '間取りの範囲が取れない');
    assert.ok(insideArea(box), '間取りが画面に入っていない: ' + JSON.stringify(box));
  });

  // ── 1b. ファイルから開く ──
  await step('同じプランを、ファイルから 375x667 で開くと間取りが画面に入る', async () => {
    const { context, page } = await newPage(browser, errors);
    await openFile(page, SAVED_2F, 'saved-2f.json');
    const box = await planBox(page);
    await context.close();
    assert.ok(insideArea(box), '間取りが画面に入っていない: ' + JSON.stringify(box));
  });

  // ── 2. 一部見えている ──
  await step('間取りが一部見えている表示位置のプランは、開いても表示位置が変わらない', async () => {
    const { context, page } = await newPage(browser, errors);
    // 間取りの左端が、画面の右から 100px の所に来る表示位置(右の 100px だけ間取りが見える)
    const plan = JSON.parse(JSON.stringify(SAVED_2F));
    const t = plan.viewState.twoD;
    const minX = await page.evaluate((p) => {
      let m = Infinity;
      p.walls.filter((w) => (Number(w.floor) || 1) === 1).forEach((w) => { m = Math.min(m, w.x1, w.x2); });
      return m;
    }, plan);
    t.panX = VIEW.width - 100 - minX * t.zoom * 0.05;
    await openFile(page, plan, 'partial.json');
    const box = await planBox(page);
    await shot(page, 'partial-375x667');
    await context.close();
    assert.ok(box.x0 < box.w && box.x1 > box.w, '前提: 間取りが画面の右端にかかっていない ' + JSON.stringify(box));
    assert.ok(sameView(box.view, t), '表示位置が変わった: ' + JSON.stringify({ got: box.view, saved: t }));
  });

  // ── 3. 同じ大きさで保存して開き直す ──
  await step('同じ大きさで保存して開き直すと、寄せた表示位置のまま開く', async () => {
    const { context, page } = await newPage(browser, errors);
    await openFile(page, SAVED_2F, 'saved-2f.json');
    // 利用者が少し寄せて拡大した表示(間取りは画面に入ったまま)
    const saved = await page.evaluate(() => {
      ST.zoom *= 1.3; ST.panX -= 20; ST.panY += 15; draw2d();
      captureViewState();
      return StorageAdapter.save(DATA).then(() => ({ zoom: ST.zoom, panX: ST.panX, panY: ST.panY }));
    });
    await page.reload();
    await waitApp(page);
    await page.waitForFunction((n) => DATA.walls.length === n && window._defaultPlanPending === false, SAVED_2F.walls.length, { timeout: 30000 });
    await settle(page);
    const box = await planBox(page);
    await context.close();
    assert.ok(sameView(box.view, saved), '表示位置が変わった: ' + JSON.stringify({ got: box.view, saved }));
  });

  // ── 4. 白紙 ──
  await step('白紙のプランでは何も起きず、エラーも出ない', async () => {
    const { context, page } = await newPage(browser, errors);
    const before = errors.length;
    const blank = { walls: [], items: [], rooms: [], startMode: 'blank', viewState: { twoD: { zoom: 1, panX: 4000, panY: 4000 } } };
    await page.setInputFiles('#import-file', { name: 'blank.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(blank)) });
    await page.waitForFunction(() => DATA.walls.length === 0 && DATA.items.length === 0, null, { timeout: 20000 });
    await settle(page);
    const box = await planBox(page);
    await context.close();
    assert.equal(box.bounds, false, '白紙なのに間取りの範囲がある');
    assert.ok(sameView(box.view, blank.viewState.twoD), '白紙で表示位置が変わった: ' + JSON.stringify(box.view));
    assert.equal(errors.length, before, 'エラーが出た: ' + errors.slice(before).join(' / '));
  });

  // ── 5. 開いたあとの undo・階の切り替え ──
  await step('開いたあとの取り消し・階の切り替えでは全体表示に切り替わらない', async () => {
    const { context, page } = await newPage(browser, errors);
    await openFile(page, SAVED_2F, 'saved-2f.json');
    // 何か1つ変えてから、間取りを画面の外へ動かし、取り消す
    const off = await page.evaluate(() => {
      saveState();
      DATA.items[0].x = (Number(DATA.items[0].x) || 0) + 100;
      ST.panX = 5000; ST.panY = 4000; draw2d();
      undoAction();
      return { zoom: ST.zoom, panX: ST.panX, panY: ST.panY };
    });
    await settle(page);
    const afterUndo = (await planBox(page)).view;
    await page.evaluate(() => { onFloorChange(2); });
    await settle(page);
    const afterFloor = (await planBox(page)).view;
    await context.close();
    assert.ok(sameView(afterUndo, off), '取り消しで表示位置が変わった: ' + JSON.stringify({ afterUndo, off }));
    assert.ok(sameView(afterFloor, off), '階の切り替えで表示位置が変わった: ' + JSON.stringify({ afterFloor, off }));
  });

  assert.deepEqual(errors, [], 'ページのエラー');
  assert.deepEqual(failures, [], '落ちた場面');
} finally {
  await browser.close();
}
