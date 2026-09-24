// 間取り図の読み取り画面を、実際のブラウザで通しで動かす。
//
// AIは呼ばない。fetch を差し替えて、Worker が返すのと同じ形の応答を返す。
// ここで見たいのは「AIが正しく読めるか」ではなく、**画面の流れが最後まで
// 通るか**——画像を選ぶ→囲む→読み取る→取り込む、で間取りが実際に入れ替わるか。
//
// 囲む操作は本物のマウスで行う。切り出しは送る画像から施主名や住所を落とす
// ための操作なので、「囲んだ範囲だけが送られる」ことは実際に送信内容を
// 覗いて確かめる。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(process.env.APP_URL || 'http://localhost:8932/');
  await page.waitForFunction(() => window.ST && window.DATA, null, { polling: 200, timeout: 60000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });

  // ── 起動ダイアログから入れること ────────────────────────────────────
  const entry = page.locator('#preset-choice-modal .preset-blank-btn', { hasText: '間取り図の画像から下書きを作る' });
  assert.equal(await entry.count(), 1, '起動ダイアログに入口が無い');
  await entry.click();
  await page.waitForSelector('#plan-import-modal.show', { timeout: 5000 });
  assert.equal(await page.locator('#preset-choice-modal.show').count(), 0, '起動ダイアログが閉じていない');

  // ── 画像を選ぶ ────────────────────────────────────────────────────
  // 400x300 の白地に黒い線を引いたPNGを、その場で作って渡す。
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300);
    g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(40, 40, 200, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#plan-import-file').setInputFiles({
    name: 'madori.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  });
  await page.waitForSelector('#plan-import-step2', { state: 'visible', timeout: 5000 });

  const first = await page.evaluate(() => ({
    crop: PlanImport.state.crop,
    canvasW: document.getElementById('plan-import-canvas').width,
  }));
  assert.deepEqual(first.crop, { x: 0, y: 0, w: 400, h: 300 }, '最初は全体が選ばれている');
  assert.equal(first.canvasW, 400, 'プレビューが描かれていない');

  // ── 囲む（本物のマウスで） ────────────────────────────────────────
  //
  // canvas は object-fit:contain で置いてあるので、箱の中に**余白**ができる。
  // 箱の幅で割ると、余白のぶんだけ始点がずれる（実測で x=30 が 0 に張り付いた）。
  // 画面 → 画像の換算は、アプリが使うのと同じ入れ方で出す。
  const box = await page.locator('#plan-import-canvas').boundingBox();
  const shown = await page.evaluate(() => {
    const c = document.getElementById('plan-import-canvas');
    return { cw: c.width, ch: c.height, iw: PlanImport.state.image.naturalWidth };
  });
  const fit = Math.min(box.width / shown.cw, box.height / shown.ch);
  const pad = { x: box.x + (box.width - shown.cw * fit) / 2, y: box.y + (box.height - shown.ch * fit) / 2 };
  const preview = shown.cw / shown.iw;   // 画像の画素 → canvas の画素
  const at = (px, py) => ({ x: pad.x + px * preview * fit, y: pad.y + py * preview * fit });
  const from = at(30, 30), to = at(260, 220);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  const crop = await page.evaluate(() => PlanImport.state.crop);
  assert.ok(Math.abs(crop.x - 30) < 6 && Math.abs(crop.y - 30) < 6, '囲んだ位置がずれている: ' + JSON.stringify(crop));
  assert.ok(Math.abs(crop.w - 230) < 8 && Math.abs(crop.h - 190) < 8, '囲んだ大きさがずれている: ' + JSON.stringify(crop));
  assert.match(await page.locator('#plan-import-crop-size').textContent(), /送る範囲/);

  // ── 送る中身：囲んだ範囲だけであること ──────────────────────────────
  const sent = await page.evaluate(async () => {
    const url = PlanImport.croppedDataUrl();
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    return { w: img.naturalWidth, h: img.naturalHeight, isPng: url.startsWith('data:image/png;base64,') };
  });
  assert.equal(sent.isPng, true);
  assert.ok(Math.abs(sent.w - 230) < 8 && Math.abs(sent.h - 190) < 8,
    '送る画像が切り出し範囲と違う: ' + JSON.stringify(sent) + ' 元画像の全体(400x300)を送っている疑い');

  // ── 読み取る（fetch を差し替えて Worker の応答を真似る） ──────────────
  await page.evaluate(() => {
    window.__sentBody = null;
    window.fetch = async (url, opts) => {
      // **読み取りの本文だけを覚える。** 取り込みの前後には位置探しや
      // 仕上げの問い合わせも飛ぶので、最後の1件を覚えると別の本文になる。
      if (String(url).includes('/api/ai/import-plan')) window.__sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        plan: {
          walls: [
            { id: 'w1', floor: 1, x1: 0, y1: 0, x2: 7280, y2: 0, thick: 120 },
            { id: 'w2', floor: 1, x1: 7280, y1: 0, x2: 7280, y2: 4095, thick: 120 },
            { id: 'w3', floor: 1, x1: 7280, y1: 4095, x2: 0, y2: 4095, thick: 120 },
            { id: 'w4', floor: 1, x1: 0, y1: 4095, x2: 0, y2: 0, thick: 120 },
          ],
          rooms: [{ id: 'r1', floor: 1, x: 0, y: 0, w: 2730, d: 1820, n: '洋室' }],
          items: [{ id: 'i1', type: 'window', floor: 1, x: 1365, y: 0, w: 1690, d: 150, rot: 0 }],
        },
        summary: { walls: 4, rooms: 1, items: 1, floors: [1] },
        notes: ['右下の収納は寸法が読めなかった'],
        warnings: [],
        usage: { inputTokens: 2600, answerTokens: 2300, thoughtTokens: 8200, outputTokens: 10500, totalTokens: 13100 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  await page.locator('#plan-import-hint').fill('1階の平面図です');
  await page.locator('#plan-import-run').click();
  await page.waitForSelector('#plan-import-step3', { state: 'visible', timeout: 10000 });

  const req = await page.evaluate(() => ({
    hint: window.__sentBody.hint,
    imageHead: String(window.__sentBody.images[0]).slice(0, 22),
  }));
  assert.equal(req.hint, '1階の平面図です', '補足が送られていない');
  assert.equal(req.imageHead, 'data:image/png;base64,', '画像の形が違う');

  assert.match(await page.locator('#plan-import-summary').textContent(), /壁 4 .*部屋 1/);
  const rooms = await page.locator('#plan-import-rooms').textContent();
  assert.match(rooms, /洋室/);
  assert.match(rooms, /2730×1820mm/);
  assert.match(rooms, /約3\.0帖/, '帖数の換算が合っていない');
  assert.match(await page.locator('#plan-import-notes').textContent(), /読めなかった/);
  // 1回いくらかかったかは毎回見せる（使う側からは費用が見えないので）
  assert.match(await page.locator('#plan-import-cost').textContent(), /費用: 約 .*円/,
    '費用が表示されていない');

  // ── 取り込む ──────────────────────────────────────────────────────
  page.on('dialog', (d) => d.accept());
  await page.locator('#plan-import-apply').click();
  await page.waitForSelector('#plan-import-modal.show', { state: 'detached', timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    open: document.getElementById('plan-import-modal').classList.contains('show'),
    walls: DATA.walls.length,
    rooms: DATA.rooms.map((r) => r.n),
    // 取り込んだ壁が、アプリの既定値(色・テクスチャ)を持っているか
    hasColor: !!DATA.walls[0].color,
  }));
  assert.equal(after.open, false, '取り込んだのにダイアログが開いたまま');
  assert.equal(after.walls, 4, '間取りが入れ替わっていない');
  assert.deepEqual(after.rooms, ['洋室']);
  assert.equal(after.hasColor, true, 'アプリの既定値がそろっていない（ensure* を通していない）');

  // 開口は、AIが答えた「中心」から、アプリの決まり（左上の角）へ直っていること。
  // 直さないと幅の半分ぶんずれる（幅1690の窓なら845mm）。3Dで見て気づいた。
  const opening = await page.evaluate(() => {
    const it = DATA.items.find((i) => i.type === 'window');
    const wall = DATA.walls.find((w) => w.y1 === 0 && w.y2 === 0);
    return it && wall ? { cx: it.x + it.w / 2, cy: it.y + it.d / 2, wallY: wall.y1 } : null;
  });
  assert.ok(opening, '窓が取り込まれていない');
  assert.equal(opening.cx, 1365, '窓の中心が、AIの答えた位置(1365)からずれている');
  assert.equal(opening.cy, opening.wallY, '窓が壁の芯に載っていない（中心↔角の変換ができていない）');

  // ── 鍵が無いときの案内 ────────────────────────────────────────────
  await page.evaluate(() => {
    window.fetch = async () => new Response(
      JSON.stringify({ error: 'ai_not_configured', message: 'x' }),
      { status: 503, headers: { 'content-type': 'application/json' } });
  });
  await page.evaluate(() => openPlanImport());
  await page.locator('#plan-import-run').click();
  await page.waitForFunction(
    () => /まだAIの読み取りを使えません/.test(document.getElementById('plan-import-status').textContent),
    null, { timeout: 10000 });

  // ── PDF はそのまま送る（囲む操作を出さない） ──────────────────────
  //
  // PDFはベクターなので、ブラウザで画像に変換するよりAI側で開いたほうが
  // 寸法の文字がはっきり読める。実測でもPDF直送が最良だった。
  await page.evaluate(() => { resetPlanImport(); });
  // 本物の(最小の)PDF。pdf.js が実際に開けるものでないと、ページを画像に
  // する経路をまったく通らない。
  const pdfBytes = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDU1ID4+CnN0cmVhbQoyIHcgMCAwIDAgUkcgMTAwIDMwMCA0MDAgNDAwIHJlIFMgMTUwIDM1MCBtIDQ1MCAzNTAgbCBTCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjE5IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzI0CiUlRU9GCg==', 'base64');
  await page.locator('#plan-import-file').setInputFiles({
    name: 'madori.pdf', mimeType: 'application/pdf', buffer: pdfBytes,
  });
  await page.waitForFunction(() => PlanImport.state.pages && PlanImport.state.pages.length > 0,
    null, { timeout: 30000 });
  assert.equal(await page.locator('#plan-import-crop').isVisible(), false,
    'PDFなのに囲む操作を出している（利用者に不要な手間をかけている）');
  assert.match(await page.locator('#plan-import-status').textContent(), /ページを読み取ります/);
  assert.equal(await page.locator('#plan-import-run').isDisabled(), false, 'PDFで読み取りボタンが押せない');

  // ── 複数階の取り込み ────────────────────────────────────────────────
  //
  // PDFが複数ページなら各ページが各階になる。壁が階ごとに入ることを見る。
  await page.evaluate(() => {
    window.fetch = async (url, opts) => {
      // **読み取りの本文だけを覚える。** 取り込みの前後には位置探しや
      // 仕上げの問い合わせも飛ぶので、最後の1件を覚えると別の本文になる。
      if (String(url).includes('/api/ai/import-plan')) window.__sentBody = JSON.parse(opts.body);
      const wallsFor = (f) => ([
        { id: 'w' + f + 'a', floor: f, x1: 0, y1: 0, x2: 7280, y2: 0, thick: 120 },
        { id: 'w' + f + 'b', floor: f, x1: 7280, y1: 0, x2: 7280, y2: 4095, thick: 120 },
        { id: 'w' + f + 'c', floor: f, x1: 7280, y1: 4095, x2: 0, y2: 4095, thick: 120 },
        { id: 'w' + f + 'd', floor: f, x1: 0, y1: 4095, x2: 0, y2: 0, thick: 120 },
      ]);
      return new Response(JSON.stringify({
        plan: {
          walls: [...wallsFor(1), ...wallsFor(2)],
          rooms: [
            { id: 'r1', floor: 1, x: 0, y: 0, w: 7280, d: 4095, n: '洋室' },
            { id: 'r2', floor: 2, x: 0, y: 0, w: 7280, d: 4095, n: 'LDK' },
          ],
          items: [],
        },
        summary: { walls: 8, rooms: 2, items: 0, floors: [1, 2] },
        notes: [], warnings: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  // ここで見たいのは「各ページが各階になる」ことなので、間取りを空にして
  // から読む。空でないと、取り込みは**消さずに隣へ**建てる（その振る舞いは
  // このすぐ下で見る）。
  await page.evaluate(() => { DATA.walls = []; DATA.rooms = []; DATA.items = []; });
  await page.locator('#plan-import-run').click();
  await page.waitForSelector('#plan-import-step3', { state: 'visible', timeout: 10000 });
  // PDFはページごとの画像にして送る。**そのまま送ると1ページ260トークンしか
  // 使われず、寸法の文字が読めない**(assets/js/pdf-pages.js の実測)。
  const pdfSent = await page.evaluate(() => ({
    head: String(window.__sentBody.images[0]).slice(0, 22),
    pages: window.__sentBody.images.length,
  }));
  assert.equal(pdfSent.head, 'data:image/png;base64,', 'PDFを画像にして送っていない: ' + pdfSent.head);
  assert.equal(pdfSent.pages, 1, '送ったページ数が合わない');
  assert.match(await page.locator('#plan-import-summary').textContent(), /階 1・2/, '階の表示が出ていない');

  await page.locator('#plan-import-apply').click();
  const floors = await page.evaluate(() => ({
    walls: DATA.walls.length,
    byFloor: [1, 2].map((f) => DATA.rooms.filter((r) => r.floor === f).map((r) => r.n)),
  }));
  assert.equal(floors.walls, 8, '2階ぶんの壁が入っていない');
  assert.deepEqual(floors.byFloor, [['洋室'], ['LDK']], '階ごとの部屋が入っていない');

  // ── 取り込みは、利用者が作ったものを消さない ──────────────────────
  //
  // 取り込みは間取りをまるごと差し替えていた。2階の平面図を1枚読み取った
  // だけで1階が丸ごと消え、方位も敷地も失われていた。
  // いま2階には間取りがある。**消さずに、右隣に建てる**。
  await page.evaluate(() => {
    DATA.northDeg = 30;
    DATA.items.push({ id: 'site1', type: 'site-rect', floor: 1, x: -2000, y: -2000, w: 14000, d: 10000 });
  });
  const before = await page.evaluate(() => ({
    floor1: DATA.rooms.filter((r) => (r.floor || 1) === 1).map((r) => r.n),
    floor2: DATA.rooms.filter((r) => (r.floor || 1) === 2).map((r) => r.n),
  }));
  await page.evaluate(() => {
    const w = (x1, y1, x2, y2) => ({ x1, y1, x2, y2, floor: 2, thick: 120 });
    PlanImport.state.result = { plan: {
      walls: [w(0, 0, 5460, 0), w(5460, 0, 5460, 3640), w(5460, 3640, 0, 3640), w(0, 3640, 0, 0)],
      rooms: [{ floor: 2, x: 0, y: 0, w: 5460, d: 3640, n: '子供室' }],
      items: [],
    } };
    applyPlanImport();
  });
  const kept = await page.evaluate(() => ({
    floor1: DATA.rooms.filter((r) => (r.floor || 1) === 1).map((r) => r.n),
    floor2: DATA.rooms.filter((r) => (r.floor || 1) === 2).map((r) => r.n),
    draftX: (DATA.rooms.find((r) => r.n === '子供室') || {}).x,
    oldX: (DATA.rooms.find((r) => r.n === 'LDK') || {}).x,
    northDeg: DATA.northDeg,
    site: DATA.items.filter((i) => i.type === 'site-rect').length,
    canUndo: HISTORY.length > 0,
  }));
  assert.deepEqual(kept.floor1, before.floor1, '2階を読み取ったのに1階が変わった: ' + JSON.stringify(kept));
  assert.deepEqual(kept.floor2, before.floor2.concat(['子供室']),
    '元の2階が消えた、または下書きが入っていない: ' + JSON.stringify(kept));
  assert.ok(kept.draftX > kept.oldX + 5000,
    '下書きが元の間取りの隣に建っていない: ' + JSON.stringify(kept));
  assert.equal(kept.northDeg, 30, '図面と関係のない設定(方位)が消えた');
  assert.equal(kept.site, 1, '平面図に描かれていない敷地を、取り込みが消した');
  assert.equal(kept.canUndo, true, '取り込みを取り消せない');

  await page.evaluate(() => undoAction());
  const undone = await page.evaluate(() => DATA.rooms.filter((r) => (r.floor || 1) === 2).map((r) => r.n));
  assert.deepEqual(undone, before.floor2, '取り込みを取り消しても元に戻らない');

  assert.deepEqual(errors, [], 'ページで例外が出ている');
  console.log('間取り図の読み取り: 画像もPDFも、選ぶ→読み取る→取り込む が通った');
} finally {
  await browser.close();
}
