// 壁の id・面の鍵・図面の鍵を data-… 属性から読むハンドラを、実際に押して確かめる。
//
// なぜ要るか: プランの値(壁の id など)を onclick の JS に書くと、他人が決めた文字で
// スクリプトが動く。2026-11 に、値を data-wall-id・data-face-key・data-kind/data-key へ移し、
// ハンドラは wallIdFromEl(this)・faceKeyFromEl(this)・this.dataset から読むようにした。
// HTML の文字列を比べただけでは、押したときに正しい壁・面・図面に効くかは分からない。
//
// 見ること(壁の id が数のプランと、引用符・空白を含む文字のプランの両方で):
//   1. 壁の設定欄の面ごとの設定: 「個別設定を利用」を押すと、その面の mode が custom になる。
//      色を変えるとその面の色が変わる。左右反転・解除のボタンが、その面のテクスチャに効く。
//      ほかの面・ほかの壁は変わらない。外観の面と内観の面の両方。
//   2. 外観カラー設定の壁ごとの欄: 2枚目の壁の色を変えると、その壁だけ色が変わる。
//      壁の名前のボタンを押すと、その壁が選ばれる。
//   3. 図面の一覧: 平面図(鍵は階の数)と立面図(鍵は方角の文字)を押すと、その図面になる。
//   4. 3D の作り直しで物を飛ばしたとき、window.__build3dSkipped に数えて console.error を出す
//      (画面テストがこの数で見張っているので、見張りが働いていることを確かめる)。
//
// sh tools/run_browser_tests.sh data-attr-handlers
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch3dSkips, assertNo3dSkips } from './build3d-skips.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const BASE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

// 壁の id を、引用符・空白・山括弧を含む文字にしたプラン(壁ごと・面ごとの設定の鍵も付け替える)
function stringIdPlan() {
  const p = clone(BASE);
  const ex = p.exteriorWallSettings, ins = p.interiorWallSettings;
  p.walls.forEach((w, i) => {
    const ok = String(w.id), nk = `壁 "${i}" '${i}' <a>`;
    for (const s of [ex, ins]) {
      if (!s) continue;
      if (s.walls && Object.prototype.hasOwnProperty.call(s.walls, ok)) { s.walls[nk] = s.walls[ok]; delete s.walls[ok]; }
      for (const k of Object.keys(s.faces || {})) if (k.startsWith(ok + '_')) { s.faces[nk + k.slice(ok.length)] = s.faces[k]; delete s.faces[k]; }
    }
    w.id = nk;
  });
  return p;
}

const browser = await chromium.launch();
const errors = [];

async function openWith(plan, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console.error: ${m.text().slice(0, 300)}`); });
  watch3dSkips(page, errors, label);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', { name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 10, null, T);
  await page.waitForTimeout(300);
  return { context, page };
}

// 面の設定を全部読む(比べるため)
const facesSnapshot = (page) => page.evaluate(() => JSON.stringify({
  ex: DATA.exteriorWallSettings && DATA.exteriorWallSettings.faces,
  int: DATA.interiorWallSettings && DATA.interiorWallSettings.faces,
}));

async function checkFaceCards(page, label) {
  // 外面と内面の両方がある1階の壁を選ぶ
  const wallIndex = await page.evaluate(() => DATA.walls.findIndex((w) => (w.floor || 1) === 1 && getWallExteriorSpans(w).length > 0 && getWallInteriorFaces(w).length > 0));
  assert.ok(wallIndex >= 0, `${label}: 外面と内面のある壁が無い`);
  const wallId = await page.evaluate((i) => { const w = DATA.walls[i]; ST.selected = w; ST.floor = w.floor || 1; updateProps(); return w.id; }, wallIndex);
  const cards = page.locator('#props-body .face-card');
  const n = await cards.count();
  assert.ok(n >= 2, `${label}: 面の欄が ${n} 個しか無い`);

  for (const kind of ['interior', 'exterior']) {
    const store = kind === 'interior' ? 'interiorWallSettings' : 'exteriorWallSettings';
    // その種類の最初の面の欄(内面は「内面 1」、外面は「外面 1」)
    const title = kind === 'interior' ? '内面 1' : '外面 1';
    const card = page.locator('#props-body .face-card', { has: page.locator('.face-card-title', { hasText: title }) }).first();
    const key = await card.getAttribute('data-face-key');
    const cardWallId = await card.getAttribute('data-wall-id');
    assert.equal(cardWallId, String(wallId), `${label} ${kind}: 欄の data-wall-id が選んだ壁と違う`);
    assert.ok(key && key.startsWith(String(wallId) + '_'), `${label} ${kind}: 面の鍵 ${key} が壁の id で始まらない`);
    const before = JSON.parse(await facesSnapshot(page));

    // 「個別設定を利用」
    await card.locator('label.face-rule', { hasText: '個別設定を利用' }).locator('input').check();
    const mode = await page.evaluate(([s, k]) => { const f = DATA[s].faces; return Object.prototype.hasOwnProperty.call(f, k) ? f[k].mode : null; }, [store, key]);
    assert.equal(mode, 'custom', `${label} ${kind}: 個別設定を押しても、その面が custom にならない`);

    // 色(欄は描き直されるので、鍵で探し直す)
    const card2 = page.locator(`#props-body .face-card[data-face-key="${key.replace(/["\\]/g, '\\$&')}"]`);
    assert.equal(await card2.count(), 1, `${label} ${kind}: 描き直した欄が鍵で見つからない`);
    await card2.locator('.face-custom-row input[type="color"]').first().fill('#123456');
    const color = await page.evaluate(([s, k]) => DATA[s].faces[k].color, [store, key]);
    assert.equal(color, '#123456', `${label} ${kind}: 色を変えても、その面の色が変わらない`);

    // テクスチャを付け(画像の取り込みは別の道なので、値だけ入れて描き直す)、左右反転と解除を押す
    await page.evaluate(([s, k]) => { DATA[s].faces[k].texture = 'data:image/png;base64,iVBORw0KGgo='; updateProps(); }, [store, key]);
    await card2.locator('button', { hasText: '左右反転' }).click();
    assert.equal(await page.evaluate(([s, k]) => DATA[s].faces[k].textureFlipX, [store, key]), true, `${label} ${kind}: 左右反転が効かない`);
    await card2.locator('button', { hasText: '解除' }).click();
    assert.equal(await page.evaluate(([s, k]) => DATA[s].faces[k].texture, [store, key]), null, `${label} ${kind}: 解除が効かない`);

    // ほかの面は変わっていない
    const after = JSON.parse(await facesSnapshot(page));
    const side = kind === 'interior' ? 'int' : 'ex';
    for (const s of ['ex', 'int']) {
      const keys = new Set([...Object.keys(before[s] || {}), ...Object.keys(after[s] || {})]);
      for (const k of keys) {
        if (s === side && k === key) continue;
        const b = (before[s] || {})[k], a = (after[s] || {})[k];
        // まだ無かった面の入れ物が、描くときに既定の値で作られるのは変化ではない
        if (b === undefined && a && a.mode === 'inherit' && !a.color && !a.texture) continue;
        assert.deepEqual(a, b, `${label} ${kind}: 押していない面 ${k} が変わった`);
      }
    }
  }
  console.log(`ok  ${label}: 面ごとの設定(内面・外面)の個別設定・色・反転・解除が、押した面だけに効いた`);
}

async function checkExteriorWallRows(page, label) {
  await page.evaluate(() => {
    const s = ensureExteriorWallSettings();
    s.whole.linked = false; s.floors[1].linked = false;
    ST.selected = null; updateProps();
    toggleExteriorColorPanel();   // 利用者が「外観カラー設定」を開くのと同じ道
  });
  await page.locator('#exterior-wall-panel-body').waitFor({ state: 'visible', timeout: 10000 });
  const rows = page.locator('#exterior-wall-panel-body [data-wall-id]');
  const n = await rows.count();
  assert.ok(n >= 2, `${label}: 外観カラー設定に壁ごとの欄が ${n} 個しか無い`);
  const firstId = await rows.nth(0).getAttribute('data-wall-id');
  const secondId = await rows.nth(1).getAttribute('data-wall-id');
  const colorOf = (id) => page.evaluate((id) => { const w = DATA.walls.find((x) => String(x.id) === id); return { ws: getExteriorWallSetting(w).color || null, wall: w.exteriorColor || null, type: typeof w.id }; }, id);
  const first0 = await colorOf(firstId);
  await rows.nth(1).locator('input[type="color"]').fill('#abcdef');
  const second = await colorOf(secondId);
  assert.equal(second.ws, '#abcdef', `${label}: 2枚目の壁の設定の色が変わらない`);
  assert.equal(second.wall, '#abcdef', `${label}: 2枚目の壁の exteriorColor が変わらない`);
  assert.deepEqual(await colorOf(firstId), first0, `${label}: 押していない1枚目の壁の色が変わった`);
  // 壁の名前のボタン → その壁を選ぶ(id の型はプランのまま)
  await page.evaluate(() => renderExteriorWallPanel('exterior'));
  await page.locator('#exterior-wall-panel-body [data-wall-id]').nth(1).locator('button').first().click();
  const sel = await page.evaluate(() => ST.selected && { id: String(ST.selected.id), type: typeof ST.selected.id, isWall: DATA.walls.includes(ST.selected) });
  assert.deepEqual(sel, { id: secondId, type: second.type, isWall: true }, `${label}: 壁の名前を押しても、その壁が選ばれない`);
  console.log(`ok  ${label}: 外観カラー設定の壁ごとの色と壁の選択が、押した壁だけに効いた`);
}

async function checkSheetList(page, label) {
  await page.evaluate(() => openJisDrawingDialog());
  await page.waitForSelector('#jis-sheet-list .jis-sheet-btn', T);
  for (const kind of ['elev', 'plan']) {
    const btn = page.locator(`#jis-sheet-list .jis-sheet-btn[data-kind="${kind}"]`).last();
    const key = await btn.getAttribute('data-key');
    await btn.click();
    const sheet = await page.evaluate(() => JIS_UI.sheet && { kind: JIS_UI.sheet.kind, key: JIS_UI.sheet.key, type: typeof JIS_UI.sheet.key });
    const want = kind === 'plan' ? { kind, key: Number(key), type: 'number' } : { kind, key, type: 'string' };
    assert.deepEqual(sheet, want, `${label}: 図面の一覧で ${kind} を押しても、その図面にならない`);
    assert.equal(await page.locator('#jis-sheet-list .jis-sheet-btn.active').getAttribute('data-key'), key, `${label}: 押した図面に印が付かない`);
  }
  await page.evaluate(() => { const m = document.getElementById('jis-modal') || document.querySelector('.jis-modal'); if (typeof closeJisDrawingDialog === 'function') closeJisDrawingDialog(); else if (m) m.classList.remove('show'); });
  console.log(`ok  ${label}: 図面の一覧で平面図(数の鍵)と立面図(文字の鍵)を押すと、その図面になった`);
}

try {
  for (const [label, plan] of [['壁の id が数', clone(BASE)], ['壁の id が引用符・空白を含む文字', stringIdPlan()]]) {
    const { context, page } = await openWith(plan, label);
    const types = await page.evaluate(() => [...new Set(DATA.walls.map((w) => typeof w.id))]);
    assert.deepEqual(types, [label === '壁の id が数' ? 'number' : 'string'], `${label}: 読み込んだ壁の id の型が想定と違う`);
    await checkFaceCards(page, label);
    await checkExteriorWallRows(page, label);
    await checkSheetList(page, label);
    await assertNo3dSkips(page, label);
    await context.close();
  }

  // 3D で飛ばした物の見張りが働いていること
  {
    const label = '3D で飛ばした数';
    const context = await browser.newContext();
    const page = await context.newPage();
    const seen = [];
    page.on('console', (m) => { if (m.type() === 'error' && /3Dに描けない/.test(m.text())) seen.push(m.text()); });
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && window.ST && window._defaultPlanPending === false, null, T);
    const r = await page.evaluate(() => {
      const before = window.__build3dSkipped || 0;
      let built = 0;
      build3DOneSafely(() => { throw new Error('テストで投げた'); }, { id: 'test-item' }, '物');
      build3DOneSafely(() => { built++; }, { id: 'ok-item' }, '物');
      return { before, after: window.__build3dSkipped, ids: window.__build3dSkippedIds, built };
    });
    assert.deepEqual(r, { before: 0, after: 1, ids: ['物:test-item'], built: 1 }, `${label}: 数え方が違う`);
    await page.waitForTimeout(100);
    assert.equal(seen.length, 1, `${label}: console.error が出ていない`);
    await assert.rejects(assertNo3dSkips(page, label), /1 個の物を飛ばした/, `${label}: 共通部品が飛ばした物に気づかない`);
    console.log(`ok  ${label}: 飛ばすと window.__build3dSkipped に数え、console.error を出し、共通部品が気づく`);
    await context.close();
  }

  assert.deepEqual(errors, [], 'コンソールのエラー・ページの例外:\n' + errors.join('\n'));
} finally {
  await browser.close();
}
console.log('data-… 属性から読むハンドラ: 押した壁・面・図面にだけ効いた');
