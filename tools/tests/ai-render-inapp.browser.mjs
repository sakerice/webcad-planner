// AIレンダーをアプリの中で仕上げる画面（設計書 docs/superpowers/specs/2026-11-27-ai-render-in-app-design.md の「画面側」）。
//
// AI は呼ばない。Worker の返事（/api/ai/render・/api/ai/render-report・/api/ai/quota）を差し替える。
// 見ること:
//   1. 初めて押すと同意の画面が出て、同意するまで何も送らない。「やめる」で何も送らずに戻る。同意は版つきで localStorage に残る
//   2. 送る本体は preset・view・aspect・images(base/depth/edge/normal) だけで、文章の欄が無い。どの絵も縦横比が aspect と同じで、長辺が 1536px。
//      法線(normal)が撮れないときは、それを抜いた3枚で送る(Worker は normal を任意の欄として受ける)
//   3. 待っている間は、撮った絵を薄く出して「写真のように仕上げています」を出し、主ボタンを押せない
//   4. 結果・「今日はあと◯枚」・注記・見比べ・保存（共有シート→だめなら blob: の保存）・もう一度・問題を報告
//   5. 失敗の文（上限・全体の上限・数えられない・AI が絵を返さない・上流の失敗・通信の失敗）。どれも「もう一度」か「閉じる」で戻れる
//   6. 同意の取り消し。取り消すと次にまた聞く
//   7. iPhone の縦（390×844）と iPad（1024×1366・834×1194）で、ダイアログの中身が横にはみ出さず、ボタンが 44px 以上
//   8. quota に残り枚数の欄が無いときは、残りを出さないだけで壊れない
// 画面の写真は SHOT_DIR（無ければ撮らない）へ置く。
import assert from 'node:assert/strict';

const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL = 'http://app.localhost/';
const APP = process.env.APP_URL || LOCAL;
const SHOT_DIR = process.env.SHOT_DIR || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream' };
async function serveLocal(context) {
  if (APP !== LOCAL) return;
  await context.route(LOCAL + '**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(ROOT)) return route.fulfill({ status: 403, body: '' });
    try {
      route.fulfill({ status: 200, body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' });
    } catch (e) {
      route.fulfill({ status: 404, body: '' });
    }
  });
}

// モデルが受ける縦横比（Gemini の画像生成の公式文書、2026-11-27 に確かめた）。画面はこの中から選ぶ。
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const CONSENT_KEY = 'hp.aiRender.consent';

// ── Worker の差し替え ───────────────────────────────────────────────
// render: 次に返す返事の列。空なら、送られてきた base をそのまま絵として返す（縦横比が要求どおりの絵になる）。
// hold: true のあいだは返事を止める（待ちの画面を見るため）。
function makeServer() {
  const s = { renders: [], reports: [], renderReplies: [], reportReplies: [], quota: { left: 3, counted: true, render: { left: 5 } }, hold: false, release: null };
  s.install = async (context) => {
    await context.route('**/api/ai/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/ai/quota') return json(200, s.quota);
      if (path === '/api/ai/render') {
        const body = JSON.parse(req.postData() || '{}');
        s.renders.push(body);
        if (s.hold) await new Promise((r) => { s.release = r; });
        const reply = s.renderReplies.shift();
        if (reply === 'abort') return route.abort('failed');
        if (reply) return json(reply.status, reply.body);
        return json(200, { image: body.images && body.images.base, remaining: 4 });
      }
      if (path === '/api/ai/render-report') {
        s.reports.push(JSON.parse(req.postData() || '{}'));
        const reply = s.reportReplies.shift() || { status: 200, body: { ok: true } };
        return json(reply.status, reply.body);
      }
      return json(404, { error: 'not_found' });
    });
  };
  return s;
}

// ダイアログの中身がはみ出していないか・ボタンが指で押せる大きさか。
// 押した直後のボタンは押した印(.touch-pressing の scale(.965))で一時的に低く測れるので、印が外れて
// 動き(0.16 秒)が終わってから測る。測らずに進むと、押した直後に測る所だけがときどき落ちる。
const layoutProblems = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#unity-render-modal .touch-pressing'), null, { timeout: 5000 });
  await page.waitForTimeout(250);
  return layoutProblemsNow(page);
};
const layoutProblemsNow = (page) => page.evaluate(() => {
  const card = document.querySelector('#unity-render-modal .unity-render-card');
  const cb = card.getBoundingClientRect();
  const out = [];
  if (cb.left < -0.5 || cb.right > innerWidth + 0.5) out.push(`カードが画面の横にはみ出す ${cb.left}〜${cb.right} / ${innerWidth}`);
  if (cb.bottom > innerHeight + 0.5) out.push(`カードが画面の下にはみ出す ${cb.bottom} / ${innerHeight}`);
  if (card.scrollWidth > card.clientWidth + 1) out.push(`カードが横にスクロールする ${card.scrollWidth} > ${card.clientWidth}`);
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  for (const el of card.querySelectorAll('#ai-render-inapp *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < cb.left - 0.5 || r.right > cb.right + 0.5) out.push(`横にはみ出す <${el.tagName.toLowerCase()} id="${el.id}" class="${el.className}"> ${Math.round(r.left)}〜${Math.round(r.right)} / ${Math.round(cb.left)}〜${Math.round(cb.right)}`);
    if (el.matches('button') && r.height < 43.5) out.push(`ボタンが低い「${el.textContent.trim()}」 ${r.height}px`);
    if (el.matches('button') && r.width < 43.5) out.push(`ボタンが細い「${el.textContent.trim()}」 ${r.width}px`);
  }
  return out;
});
const visibleText = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return el.textContent.replace(/\s+/g, ' ').trim();
}, sel);
const imageSize = (page, dataUrl) => page.evaluate((u) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = u;
}), dataUrl);

async function openApp(browser, viewport, server, opts) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: !!(opts && opts.mobile), deviceScaleFactor: 1, acceptDownloads: true });
  await serveLocal(context);
  await server.install(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    // 共有シートの差し替え。__shareMode: 'ok' | 'abort' | 'fail' | 'none'
    window.__shares = [];
    window.__shareMode = 'ok';
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => window.__shareMode !== 'none' && !!(d && d.files && d.files.length) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => {
      window.__shares.push({ n: d.files.length, type: d.files[0].type, name: d.files[0].name, size: d.files[0].size });
      if (window.__shareMode === 'abort') return Promise.reject(new DOMException('cancel', 'AbortError'));
      if (window.__shareMode === 'fail') return Promise.reject(new Error('not allowed'));
      return Promise.resolve();
    } });
  });
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=2f');
  await page.waitForFunction(() => window.ST && window.DATA && DATA.walls && DATA.walls.length > 0, null, { timeout: 90000 });
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 90000 });
  await page.evaluate(() => setView('3d-int'));
  await page.waitForFunction(() => window.ren && window.sc3, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  return { context, page, errors };
}

async function openDialog(page) {
  await page.evaluate(() => openUnityRenderModal());
  await page.waitForSelector('#unity-render-modal.show', { timeout: 5000 });
}
async function waitResult(page) {
  await page.waitForFunction(() => {
    const st = window.AiRenderInApp && AiRenderInApp.state();
    return st && !st.busy;
  }, null, { timeout: 60000 });
}

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  // ════ iPhone の縦: 通しで全部 ════════════════════════════════════
  {
    const server = makeServer();
    const { context, page, errors } = await openApp(browser, { width: 390, height: 844 }, server, { mobile: true });
    await openDialog(page);

    // 題と並び
    assert.equal(await visibleText(page, '#unity-render-modal .unity-render-title'), 'AIレンダー');
    const order = await page.evaluate(() => {
      const els = ['ai-render-preset', 'ai-render-go', 'ai-render-stage', 'ai-render-data'].map((id) => document.getElementById(id));
      if (els.some((e) => !e)) return false;
      for (let i = 1; i < els.length; i++) if (!(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      return true;
    });
    assert.ok(order, '表現の選択 → 主ボタン → 結果 → 画像AI用データ の順になっていない');
    assert.equal(await visibleText(page, '#ai-render-go'), '写真のように仕上げる');
    // 画像AI用データの一式は折りたたみの中（閉じている）。id は変わらない
    const fold = await page.evaluate(() => {
      const d = document.getElementById('ai-render-data');
      return { tag: d.tagName, open: d.open, summary: d.querySelector('summary').textContent.trim(),
        inside: ['ai-render-run', 'ai-render-style-input', 'ai-instructions-preview', 'ai-dl-bundle', 'unity-render-status'].every((id) => d.contains(document.getElementById(id))) };
    });
    assert.equal(fold.tag, 'DETAILS');
    assert.equal(fold.open, false, '画像AI用データの折りたたみが最初から開いている');
    assert.equal(fold.summary, '画像AI用データを保存する（ほかの画像AIで使う）');
    assert.ok(fold.inside, '画像AI用データの部品が折りたたみの中に無い');
    // 今日はあと◯枚
    await page.waitForFunction(() => /今日はあと/.test((document.getElementById('ai-render-left') || {}).textContent || ''), null, { timeout: 5000 });
    assert.equal(await visibleText(page, '#ai-render-left'), '今日はあと 5 枚');

    // ── 1. 同意 ──
    assert.equal(await visibleText(page, '#ai-render-revoke'), null, '同意する前から取り消しが出ている');
    await page.locator('#ai-render-go').click();
    await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
    const consent = await visibleText(page, '#ai-render-consent');
    for (const want of ['Google', '日本国外', '学習に使いません', '奥行き', '輪郭', '表現', '図面の原本', '氏名', '住所', '仕上げメモ', '同意して仕上げる', 'やめる']) {
      assert.ok(consent.includes(want), `同意の画面に「${want}」が無い: ${consent}`);
    }
    assert.deepEqual(await layoutProblems(page), [], '同意の画面（iPhone 縦）');
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-consent.png` });
    await page.locator('#ai-render-consent-cancel').click();
    assert.equal(await visibleText(page, '#ai-render-consent'), null, '「やめる」で同意の画面が閉じない');
    assert.equal(server.renders.length, 0, '同意する前に送った');
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY), null, '「やめる」で同意が残った');

    await page.locator('#ai-render-go').click();
    await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
    server.hold = true;
    await page.locator('#ai-render-consent-ok').click();
    const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY));
    assert.equal(typeof stored.v, 'number', '同意に版が無い: ' + JSON.stringify(stored));
    assert.ok(stored.v >= 1);
    assert.equal(await page.evaluate(() => JSON.stringify(DATA).includes('aiRender')), false, '同意がプランのデータに入った');

    // ── 3. 待ち ──
    await page.waitForFunction(() => !document.getElementById('ai-render-wait').hidden, null, { timeout: 30000 });
    const waiting = await page.evaluate(() => ({
      text: document.getElementById('ai-render-wait').textContent.replace(/\s+/g, ' ').trim(),
      goDisabled: document.getElementById('ai-render-go').disabled,
      faded: (() => { const i = document.getElementById('ai-render-base-img'); return !!i.getAttribute('src') && parseFloat(getComputedStyle(i).opacity) < 0.8 && i.getBoundingClientRect().height > 0; })(),
    }));
    assert.ok(waiting.text.includes('写真のように仕上げています。そのままお待ちください'), '待ちの文: ' + waiting.text);
    assert.doesNotMatch(waiting.text, /[0-9０-９]+\s*秒/, '待ちに秒数が出ている');
    assert.equal(waiting.goDisabled, true, '待っている間に主ボタンが押せる');
    assert.equal(waiting.faded, true, '待っている間に撮った絵が薄く出ていない');
    assert.deepEqual(await layoutProblems(page), [], '待ちの画面（iPhone 縦）');
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-wait.png` });

    // ── 2. 送る本体 ──
    for (let i = 0; i < 100 && server.renders.length === 0; i++) await page.waitForTimeout(100);
    assert.equal(server.renders.length, 1, '1回押して1回だけ送る');
    const sent = server.renders[0];
    assert.deepEqual(Object.keys(sent).sort(), ['aspect', 'images', 'preset', 'view'], '送る本体の欄: ' + Object.keys(sent));
    assert.deepEqual(Object.keys(sent.images).sort(), ['base', 'depth', 'edge', 'normal']);
    assert.equal(sent.preset, 'life');
    assert.equal(sent.view, 'interior');
    assert.ok(ASPECTS.includes(sent.aspect), '受けない縦横比: ' + sent.aspect);
    const [aw, ah] = sent.aspect.split(':').map(Number);
    assert.ok(aw < ah, 'iPhone の縦画面なのに縦長の比になっていない: ' + sent.aspect);
    for (const k of ['base', 'depth', 'edge', 'normal']) {
      assert.match(sent.images[k], /^data:image\/jpeg;base64,/, k + ' が JPEG でない');
      const sz = await imageSize(page, sent.images[k]);
      assert.equal(Math.max(sz.w, sz.h), 1536, `${k} の長辺 ${sz.w}x${sz.h}`);
      assert.ok(Math.abs(sz.w / sz.h - aw / ah) / (aw / ah) < 0.01, `${k} の縦横比 ${sz.w}x${sz.h} が ${sent.aspect} と違う`);
    }
    server.hold = false;
    server.release();

    // ── 4. 結果 ──
    await waitResult(page);
    const result = await page.evaluate(() => {
      const img = document.getElementById('ai-render-result-img');
      return { src: img.getAttribute('src') || '', shown: img.getBoundingClientRect().height > 0, width: img.getBoundingClientRect().width,
        stageWidth: document.getElementById('ai-render-stage').getBoundingClientRect().width };
    });
    assert.ok(result.shown, '結果の絵が出ていない');
    assert.match(result.src, /^data:image\//);
    assert.ok(result.width >= result.stageWidth - 2, '結果の絵が幅いっぱいでない');
    assert.equal(await visibleText(page, '#ai-render-left'), '今日はあと 4 枚', '返事の remaining で残りが更新されていない');
    assert.equal(await visibleText(page, '#ai-render-note'), 'AI が仕上げた絵です。細部が実際の間取りと違うことがあります。');
    for (const [id, label] of [['ai-render-compare', '元の3Dと見比べる'], ['ai-render-save', '画像を保存'], ['ai-render-again', 'もう一度仕上げる'], ['ai-render-report-open', '問題を報告']]) {
      assert.equal(await visibleText(page, '#' + id), label, id);
    }
    assert.deepEqual(await layoutProblems(page), [], '結果の画面（iPhone 縦）');
    // 縦長の絵でも、カードの中をスクロールすれば絵の下端まで見える
    const scrollable = await page.evaluate(() => {
      const card = document.querySelector('#unity-render-modal .unity-render-card');
      const img = document.getElementById('ai-render-result-img');
      const oy = getComputedStyle(card).overflowY;
      card.scrollTop = card.scrollHeight;
      const ib = img.getBoundingClientRect(), cb = card.getBoundingClientRect();
      img.scrollIntoView({ block: 'end' });
      const ib2 = img.getBoundingClientRect();
      return { oy, bottomReachable: ib2.bottom <= cb.bottom + 1, tall: ib.height > 0 };
    });
    assert.ok(/auto|scroll/.test(scrollable.oy), 'カードがスクロールしない');
    assert.ok(scrollable.bottomReachable, '縦長の絵の下端まで見えない');
    if (SHOT_DIR) {
      await page.evaluate(() => { document.querySelector('#unity-render-modal .unity-render-card').scrollTop = document.getElementById('ai-render-stage').offsetTop - 20; });
      await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-result.png` });
    }

    // 見比べ
    const resultSrc = result.src;
    await page.locator('#ai-render-compare').click();
    const cmp = await page.evaluate(() => {
      const b = document.getElementById('ai-render-base-img'), r = document.getElementById('ai-render-result-img');
      return { baseShown: b.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(b).opacity) > 0.9, resultShown: r.getBoundingClientRect().height > 0,
        pressed: document.getElementById('ai-render-compare').getAttribute('aria-pressed'), label: document.getElementById('ai-render-compare').textContent.trim() };
    });
    assert.equal(cmp.baseShown, true, '見比べで元の3Dが出ない');
    assert.equal(cmp.resultShown, false, '見比べで仕上がりが隠れない');
    assert.equal(cmp.pressed, 'true');
    await page.locator('#ai-render-compare').click();
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-result-img').getBoundingClientRect().height > 0), true, '見比べから戻らない');
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-result-img').getAttribute('src')), resultSrc);

    // 結果の絵は長押しで「写真に追加」できる <img>（iPhone のアプリ版で共有も保存も効かないときの逃げ道）
    const longPress = await page.evaluate(() => {
      const img = document.getElementById('ai-render-result-img');
      const cs = getComputedStyle(img);
      return { tag: img.tagName, pe: cs.pointerEvents, callout: cs.webkitTouchCallout || cs.getPropertyValue('-webkit-touch-callout') || '' };
    });
    assert.equal(longPress.tag, 'IMG');
    assert.notEqual(longPress.pe, 'none', '結果の絵が指の操作を受けない');
    assert.notEqual(longPress.callout, 'none', '結果の絵の長押しメニューが消されている');
    const SAVE_HINT = '保存できないときは、絵を長押しして「写真に追加」を選んでください。';
    // 保存: 共有シート（ファイル1枚）
    await page.locator('#ai-render-save').click();
    await page.waitForFunction(() => window.__shares.length === 1, null, { timeout: 5000 });
    assert.equal(await visibleText(page, '#ai-render-save-hint'), null, '共有シートが出たのに長押しの案内が出ている');
    const share = await page.evaluate(() => window.__shares[0]);
    assert.equal(share.n, 1);
    assert.match(share.type, /^image\//);
    assert.match(share.name, /\.(png|jpe?g)$/);
    assert.ok(share.size > 1000);
    // 取り消し（AbortError）は保存に切り替えない
    await page.evaluate(() => { window.__shareMode = 'abort'; });
    let downloaded = null;
    page.on('download', (d) => { downloaded = d; });
    await page.locator('#ai-render-save').click();
    await page.waitForFunction(() => window.__shares.length === 2, null, { timeout: 5000 });
    await page.waitForTimeout(500);
    assert.equal(downloaded, null, '共有を取り消したのに保存に進んだ');
    // 共有が使えないときは blob: の保存
    await page.evaluate(() => { window.__shareMode = 'fail'; });
    const dl = page.waitForEvent('download', { timeout: 5000 });
    await page.locator('#ai-render-save').click();
    const d1 = await dl;
    assert.match(d1.url(), /^blob:/, '保存が blob: でない: ' + d1.url());
    assert.match(d1.suggestedFilename(), /\.(png|jpe?g)$/);
    // 指で操作する端末で共有シートにファイルを渡せないときは、blob: の保存を試したうえで長押しの案内を出す
    assert.equal(await visibleText(page, '#ai-render-save-hint'), SAVE_HINT, '共有に失敗したのに長押しの案内が出ない');
    assert.deepEqual(await layoutProblems(page), [], '長押しの案内（iPhone 縦）');
    {
      const below = await page.evaluate(() => document.getElementById('ai-render-result-img').getBoundingClientRect().bottom <= document.getElementById('ai-render-save-hint').getBoundingClientRect().top);
      assert.ok(below, '長押しの案内が結果の絵の下に無い');
    }
    if (SHOT_DIR) { await page.locator('#ai-render-save-hint').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-save-hint.png` }); }
    await page.evaluate(() => { window.__shareMode = 'none'; });
    const dl2 = page.waitForEvent('download', { timeout: 5000 });
    await page.locator('#ai-render-save').click();
    assert.match((await dl2).url(), /^blob:/);
    assert.equal(await visibleText(page, '#ai-render-save-hint'), SAVE_HINT, '共有シートが無い端末で長押しの案内が出ない');

    // 内観か外観かは撮影と同じ同期の区間で決める。輪郭を作る await の間に視点が切り替わっても、撮った絵の view を送る
    await page.evaluate(() => {
      const origEdge = window.makeEdgeDataUrlFromSegmentation, origMode = window.aiCaptureViewMode;
      window.__flip = false;
      window.makeEdgeDataUrlFromSegmentation = async (u) => { const r = await origEdge(u); window.__flip = true; return r; };
      window.aiCaptureViewMode = () => (window.__flip ? 'exterior' : origMode());
      window.__restoreCapture = () => { window.makeEdgeDataUrlFromSegmentation = origEdge; window.aiCaptureViewMode = origMode; };
    });
    {
      const before = server.renders.length;
      await page.locator('#ai-render-again').click();
      await waitResult(page);
      assert.equal(server.renders.length, before + 1);
      assert.equal(server.renders[before].view, 'interior', '撮影のあとに決めた view を送った');
      await page.evaluate(() => window.__restoreCapture());
      // 新しく仕上げたら、前の長押しの案内は消える
      assert.equal(await visibleText(page, '#ai-render-save-hint'), null, '新しい結果に前の案内が残る');
    }

    // もう一度仕上げる（同意は聞き直さない）
    await page.locator('#ai-render-again').click();
    await waitResult(page);
    assert.equal(server.renders.length, 3, '「もう一度仕上げる」で送っていない');
    assert.equal(await visibleText(page, '#ai-render-consent'), null);

    // ── 報告 ──
    await page.locator('#ai-render-report-open').click();
    await page.waitForSelector('#ai-render-report:not([hidden])', { timeout: 5000 });
    const rep = await visibleText(page, '#ai-render-report');
    for (const want of ['不適切', '元の3D', 'この絵も送る', '送る', 'やめる']) assert.ok(rep.includes(want), `報告の画面に「${want}」が無い: ${rep}`);
    assert.deepEqual(await layoutProblems(page), [], '報告の画面（iPhone 縦）');
    if (SHOT_DIR) {
      await page.locator('#ai-render-report').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-report.png` });
    }
    await page.locator('#ai-render-report input[value="wrong_layout"]').check();
    await page.locator('#ai-render-report-image').check();
    await page.locator('#ai-render-report-send').click();
    await page.waitForFunction(() => /受け付けました/.test(document.getElementById('ai-render-msg').textContent), null, { timeout: 5000 });
    assert.equal(server.reports.length, 1);
    assert.equal(server.reports[0].reason, 'wrong_layout');
    assert.match(server.reports[0].image, /^data:image\//, '「この絵も送る」で絵が付いていない');
    assert.deepEqual(Object.keys(server.reports[0]).sort(), ['image', 'reason']);
    // 閉じて開き直すと「報告を受け付けました」は消え、絵は残る
    await page.evaluate(() => closeUnityRenderModal());
    await openDialog(page);
    assert.equal(await visibleText(page, '#ai-render-msg'), null, '開き直しても前の一言が残る');
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-result-img').getBoundingClientRect().height > 0), true, '開き直すと結果が消える');
    // 絵を送らない報告
    await page.locator('#ai-render-report-open').click();
    await page.locator('#ai-render-report input[value="inappropriate"]').check();
    await page.locator('#ai-render-report-image').uncheck();
    await page.locator('#ai-render-report-send').click();
    await page.waitForFunction(() => document.getElementById('ai-render-report').hidden, null, { timeout: 5000 });
    assert.deepEqual(server.reports[1], { reason: 'inappropriate' }, '絵を送らない報告に絵が付いた');
    // 報告の上限
    server.reportReplies.push({ status: 429, body: { error: 'report_quota_exceeded' } });
    await page.locator('#ai-render-report-open').click();
    await page.locator('#ai-render-report-send').click();
    await page.waitForFunction(() => /これ以上/.test(document.getElementById('ai-render-report-msg').textContent), null, { timeout: 5000 });
    await page.locator('#ai-render-report-cancel').click();

    // ── 5. 失敗の文 ──
    const DAY_MSG = '本日ぶんの AI は受付を終えました。明日の朝9時から再開します。画面の操作では引き続き作れます。';
    const cases = [
      ['unavailable', { status: 503, body: { error: 'ai_quota_unavailable', message: 'x' } }, 'いま AI が混み合っています。少し待ってから、もう一度お試しください。', true],
      ['blocked', { status: 422, body: { error: 'render_blocked' } }, 'この画面は仕上げられませんでした。視点を変えてお試しください。', true],
      ['no-image', { status: 200, body: { remaining: 3 } }, 'この画面は仕上げられませんでした。視点を変えてお試しください。', true],
      ['upstream', { status: 502, body: { error: 'ai_upstream_error' } }, 'AI側でエラーが起きました。少し待ってからもう一度お試しください。', true],
      ['network', 'abort', '通信できませんでした', true],
      ['not-configured', { status: 503, body: { error: 'ai_not_configured', message: 'AIレンダーはいま使えません。' } }, '準備中', false],
      // 上限は最後(断られたあとは、押す前に分かるよう主ボタンと「もう一度仕上げる」が閉じる)
      ['quota-total', { status: 429, body: { error: 'ai_quota_exceeded', scope: 'total' } }, '明日また使えます', false],
      ['quota-user', { status: 429, body: { error: 'ai_quota_exceeded', scope: 'user', message: DAY_MSG } }, DAY_MSG, false],
    ];
    // 「もう一度」で送り直せる
    server.renderReplies.push({ status: 502, body: { error: 'ai_upstream_error' } });
    await page.locator('#ai-render-again').click();
    await waitResult(page);
    const n = server.renders.length;
    await page.locator('#ai-render-error-retry').click();
    await waitResult(page);
    assert.equal(server.renders.length, n + 1, '「もう一度」で送り直していない');
    assert.equal(await visibleText(page, '#ai-render-error'), null);

    // 失敗しても1枚と数える(Worker は戻さない)ので、失敗のあとは残りを聞き直す
    server.quota = { left: 3, counted: true, render: { left: 2, perUser: 5 } };
    for (const [name, reply, want, retry] of cases) {
      if (name === 'quota-total') server.quota = { left: 3, counted: true, render: { left: 0, perUser: 5, message: '本日ぶんの受付を終えました。' } };
      if (name === 'quota-user') {
        // 全体の上限で一度閉じたので、残りを戻してから試す
        server.quota = { left: 3, counted: true, render: { left: 5, perUser: 5 } };
        await page.evaluate(() => closeUnityRenderModal());
        await openDialog(page);
        await page.waitForFunction(() => /あと 5 枚/.test(document.getElementById('ai-render-left').textContent), null, { timeout: 5000 });
        server.quota = { left: 3, counted: true, render: { left: 0, perUser: 5, message: DAY_MSG } };
      }
      server.renderReplies.push(reply);
      const before = server.renders.length;
      await page.locator('#ai-render-again').click();
      await waitResult(page);
      assert.equal(server.renders.length, before + 1, name + ' を送っていない');
      const msg = await visibleText(page, '#ai-render-error-text');
      assert.ok(msg && msg.includes(want), `${name} の文: ${msg}`);
      assert.doesNotMatch(msg, /[0-9]{3}|error|quota|render_|\$|トークン|gemini|nano/i, `${name} の文に開発の都合が出ている: ${msg}`);
      assert.equal(!!(await visibleText(page, '#ai-render-error-retry')), retry, name + ' の「もう一度」');
      assert.equal(await visibleText(page, '#ai-render-error-close'), '閉じる', name + ' の「閉じる」');
      assert.deepEqual(await layoutProblems(page), [], `失敗の画面 ${name}（iPhone 縦）`);
      if (name === 'blocked') {
        await page.waitForFunction(() => /あと 2 枚/.test(document.getElementById('ai-render-left').textContent), null, { timeout: 5000 })
          .catch(() => { throw new Error('失敗のあとに残り枚数を聞き直していない'); });
      }
      if (SHOT_DIR && (name === 'quota-user' || name === 'blocked' || name === 'network')) {
        await page.locator('#ai-render-error').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOT_DIR}/inapp-iphone-error-${name}.png` });
      }
      // 閉じると前の結果に戻る
      await page.locator('#ai-render-error-close').click();
      assert.equal(await visibleText(page, '#ai-render-error'), null, name + ' を閉じても失敗の文が残る');
      assert.equal(await page.evaluate(() => document.getElementById('ai-render-result-img').getBoundingClientRect().height > 0), true, name + ' を閉じても前の結果に戻らない');
    }
    // 上限で断られたあとは、押す前に分かる
    assert.equal(await visibleText(page, '#ai-render-left'), DAY_MSG, '上限のあと、残りの所に断りの文が出ていない');
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-go').disabled), true, '上限のあとも主ボタンが押せる');
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-again').disabled), true, '上限のあとも「もう一度仕上げる」が押せる');
    // 押せない主ボタンを指で押しても、押した印(.touch-pressing の水色の地・青い文字)が付かない
    {
      const goBox = await page.locator('#ai-render-go').boundingBox();
      await page.mouse.move(goBox.x + goBox.width / 2, goBox.y + goBox.height / 2);
      await page.mouse.down();
      const pressed = await page.evaluate(() => { const b = document.getElementById('ai-render-go'); return { cls: b.classList.contains('touch-pressing'), color: getComputedStyle(b).color }; });
      await page.mouse.up();
      assert.equal(pressed.cls, false, '押せない主ボタンに押した印が付く');
      assert.equal(pressed.color, 'rgb(255, 255, 255)', '押せない主ボタンを押すと文字の色が変わる: ' + pressed.color);
    }

    server.quota = { left: 3, counted: true, render: { left: 5, perUser: 5 } };
    // 閉じて開き直しても最後の1枚が残る
    await page.evaluate(() => closeUnityRenderModal());
    await openDialog(page);
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-result-img').getBoundingClientRect().height > 0), true, '開き直すと結果が消える');

    // ── 6. 同意の取り消し ──
    assert.equal(await visibleText(page, '#ai-render-revoke'), 'AI への送信の同意を取り消す');
    await page.locator('#ai-render-revoke').click();
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), CONSENT_KEY), null, '取り消しても同意が残る');
    assert.equal(await visibleText(page, '#ai-render-revoke'), null, '取り消した後も取り消しが出ている');
    const nr = server.renders.length;
    await page.locator('#ai-render-go').click();
    await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
    assert.equal(server.renders.length, nr, '取り消した後に聞かずに送った');
    await page.locator('#ai-render-consent-cancel').click();

    // 待っている間は取り消せない(送信中の依頼は止められないため) → 失敗 → 取り消し → もう一度 → 同意の画面が出て、送られない
    await page.locator('#ai-render-go').click();
    await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
    server.hold = true;
    server.release = null;
    await page.locator('#ai-render-consent-ok').click();
    await page.waitForFunction(() => !document.getElementById('ai-render-wait').hidden, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-revoke').disabled), true, '待っている間に同意を取り消せる');
    await page.evaluate(() => AiRenderInApp.revoke());
    assert.equal(await page.evaluate(() => AiRenderInApp.state().consent), true, '待っている間の取り消しが効いてしまう');
    for (let i = 0; i < 100 && !server.release; i++) await page.waitForTimeout(100);
    server.renderReplies.push({ status: 502, body: { error: 'ai_upstream_error' } });
    server.hold = false;
    server.release();
    await waitResult(page);
    assert.ok(await visibleText(page, '#ai-render-error-retry'), '失敗の「もう一度」が出ていない');
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-revoke').disabled), false, '待ち終わっても取り消せない');
    await page.locator('#ai-render-revoke').click();
    assert.equal(await visibleText(page, '#ai-render-error'), null, '取り消しても失敗の表示が残る');
    {
      const before = server.renders.length;
      await page.evaluate(() => AiRenderInApp.retry());
      await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(300);
      assert.equal(server.renders.length, before, '取り消したあと「もう一度」で聞かずに送った');
      await page.locator('#ai-render-consent-cancel').click();
      await page.locator('#ai-render-again').click();
      await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(300);
      assert.equal(server.renders.length, before, '取り消したあと「もう一度仕上げる」で聞かずに送った');
      await page.locator('#ai-render-consent-cancel').click();
    }

    // ── 8. quota に残り枚数の欄が無い ──
    server.quota = { left: 3, counted: true };
    await page.evaluate(() => closeUnityRenderModal());
    await openDialog(page);
    await page.waitForTimeout(500);
    assert.equal(await visibleText(page, '#ai-render-left'), null, '欄が無いのに残りを出している');
    // 残り 0 枚なら、押す前に分かる
    server.quota = { left: 3, counted: true, render: { left: 0, perUser: 5, message: DAY_MSG } };
    await page.evaluate(() => closeUnityRenderModal());
    await openDialog(page);
    await page.waitForFunction((m) => document.getElementById('ai-render-left').textContent === m, DAY_MSG, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('ai-render-go').disabled), true, '残り 0 枚なのに押せる');

    assert.deepEqual(errors, [], 'ページのエラー');
    await context.close();
  }

  // ════ iPad の大きさ: 同意・結果・報告・失敗がはみ出さない ═══════════════
  for (const vp of [{ width: 1024, height: 1366 }, { width: 834, height: 1194 }]) {
    const server = makeServer();
    const { context, page, errors } = await openApp(browser, vp, server, { mobile: false });
    const tag = `ipad-${vp.width}x${vp.height}`;
    await openDialog(page);
    await page.locator('#ai-render-go').click();
    await page.waitForSelector('#ai-render-consent:not([hidden])', { timeout: 5000 });
    assert.deepEqual(await layoutProblems(page), [], `同意の画面（${tag}）`);
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/inapp-${tag}-consent.png` });
    server.hold = true;
    await page.locator('#ai-render-consent-ok').click();
    await page.waitForFunction(() => !document.getElementById('ai-render-wait').hidden, null, { timeout: 30000 });
    assert.deepEqual(await layoutProblems(page), [], `待ちの画面（${tag}）`);
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/inapp-${tag}-wait.png` });
    for (let i = 0; i < 100 && !server.release; i++) await page.waitForTimeout(100);
    const sent = server.renders[0];
    const [aw, ah] = sent.aspect.split(':').map(Number);
    assert.deepEqual(Object.keys(sent.images).sort(), ['base', 'depth', 'edge', 'normal'], `${tag}: 送る絵`);
    for (const k of ['base', 'depth', 'edge', 'normal']) {
      const sz = await imageSize(page, sent.images[k]);
      assert.ok(Math.abs(sz.w / sz.h - aw / ah) / (aw / ah) < 0.01, `${tag}: ${k} の縦横比 ${sz.w}x${sz.h} が ${sent.aspect} と違う`);
    }
    server.hold = false;
    server.release();
    await waitResult(page);
    assert.deepEqual(await layoutProblems(page), [], `結果の画面（${tag}）`);
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/inapp-${tag}-result.png` });
    await page.locator('#ai-render-report-open').click();
    assert.deepEqual(await layoutProblems(page), [], `報告の画面（${tag}）`);
    if (SHOT_DIR) { await page.locator('#ai-render-report').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT_DIR}/inapp-${tag}-report.png` }); }
    await page.locator('#ai-render-report-cancel').click();
    server.renderReplies.push({ status: 422, body: { error: 'render_blocked' } });
    // 法線が撮れないとき(空を返す)は、3枚で送る
    await page.evaluate(() => {
      const orig = window.captureAiOverrideGuideDataUrl;
      window.captureAiOverrideGuideDataUrl = function (kind) { return kind === 'normal' ? '' : orig.apply(this, arguments); };
    });
    await page.locator('#ai-render-again').click();
    await waitResult(page);
    assert.equal(server.renders.length, 2, `${tag}: もう一度で送っていない`);
    assert.deepEqual(Object.keys(server.renders[1].images).sort(), ['base', 'depth', 'edge'], `${tag}: 法線が撮れないときの送る絵`);
    assert.deepEqual(await layoutProblems(page), [], `失敗の画面（${tag}）`);
    if (SHOT_DIR) { await page.locator('#ai-render-error').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT_DIR}/inapp-${tag}-error.png` }); }
    assert.deepEqual(errors, [], `${tag} のページのエラー`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('ok ai-render-inapp');
