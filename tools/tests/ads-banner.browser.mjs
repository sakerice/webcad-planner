// 広告(PR)の枠(assets/js/pr-ads.js)を、検査用の素材を差し込んで確かめる。
//
//   (a) 素材0件: 枠の要素が出ず、図の領域・上の操作の段・サイドバーなどの位置と大きさが、pr-ads.js を読まない画面(広告を入れる前)と同じ
//   (b) 素材あり: 6つの大きさで、上端の帯がボタン・知らせの帯・サイドバーの見出しに重ならず、押せる物から 24px 以上離れる。
//       図の領域は帯の下から始まる。スマートフォンの横向き(844×390)では出ない
//   (c) 「PR」の表記が付く
//   (d) 広告の画像が読めないと、帯ごと消えて --ad-h が 0 に戻る(広告ブロッカーと同じ形)
//   (e) 3D 表示でも、3D の画面が帯の下から始まり、重ならない
//   (f) 保存一覧・共同編集・JIS 図面出力のダイアログの末尾に枠が出る(PR 付き、ボタンから 24px 以上)
//   (g) アプリ版(Capacitor の中)では出ない
//   (h) a8.net 以外の URL の素材は出さず、その先へ読みにも行かない
//
// 素材は window.__HP_PR_ADS__ を page.addInitScript で置いて差し込む。*.a8.net への要求は、ここで作った画像を
// 返して止める(a8.net へは通信しない)。localhost 以外への要求も止める。
// 画像は ADS_SHOT_DIR(無ければ output/test-shots/ads)に出す。
//
// sh tools/run_browser_tests.sh ads-banner
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkLayout } from './aspect-check.mjs';
import { shotDir } from './shot-dir.mjs';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const SHOTS = process.env.ADS_SHOT_DIR || shotDir('ads');
const T = { timeout: 90000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const creative = (id, w, h) => ({
  href: `https://px.a8.net/svt/ejp?a8mat=TEST${id}`,
  img: `https://www99.a8.net/svt/bgt?test=${id}&w=${w}&h=${h}`,
  w, h,
  px: `https://www99.a8.net/0.gif?a8mat=TEST${id}`,
  name: `検査用の広告 ${w}×${h}`,
});
const ADS = {
  top: [creative('top728', 728, 90), creative('top468', 468, 60), creative('top320', 320, 50)],
  library: [creative('lib300', 300, 250)],
  share: [creative('share300', 300, 250)],
  export: [creative('exp320', 320, 50)],
};
const EMPTY = { top: [], library: [], share: [], export: [] };
const BAD = {
  top: [
    { ...creative('bad1', 728, 90), href: 'https://evil.example/click' },
    { ...creative('bad2', 320, 50), img: 'https://www99.a8.net.evil.example/x.gif' },
    { ...creative('bad3', 320, 50), img: 'http://www99.a8.net/x.gif' },
    { ...creative('bad4', 320, 50), px: 'https://tracker.example/0.gif' },
  ],
  library: [{ ...creative('bad5', 300, 250), href: 'javascript:alert(1)' }],
  share: [{ ...creative('bad6', 300, 250), img: 'https://a8.net.example.com/x.png' }],
  export: [{ ...creative('bad7', 320, 50), href: 'https://px.a8.net.evil.example/x' }],
};
// 素材の画像(大きさと文字だけの SVG)。計測用の 0.gif は 1×1 の透明 GIF
const GIF1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#3a7bd5"/><rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#fff" stroke-width="2"/><text x="${w / 2}" y="${h / 2 + 6}" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">検査用の広告 ${w}×${h}</text></svg>`;

const SIZES = [[390, 844, 'iphone-portrait'], [844, 390, 'iphone-landscape'], [820, 1180, 'ipad-portrait'], [1180, 820, 'ipad-landscape'], [1440, 900, 'pc'], [1024, 700, 'pc-small-468']];

const browser = await chromium.launch();
const errors = [];
let a8Requests = 0;
const foreign = [];

async function open(w, h, { ads = ADS, app = false, failImages = false, noScript = false, view = null } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (/^[a-z0-9-]+\.a8\.net$/.test(u.hostname)) {
      a8Requests++;
      if (failImages && u.pathname !== '/0.gif') return route.abort();
      if (u.pathname === '/0.gif') return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF1 });
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(Number(u.searchParams.get('w')) || 100, Number(u.searchParams.get('h')) || 50) });
    }
    if (u.origin !== ORIGIN) { foreign.push(u.href); return route.abort(); }
    if (noScript && u.pathname.endsWith('/assets/js/pr-ads.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  await context.addInitScript(({ ads, app }) => {
    window.__HP_PR_ADS__ = ads;
    if (app) window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  }, { ads, app });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${w}x${h}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(APP + '?preset=2f');
  await page.waitForFunction(() => window.PRESET_CURRENT === '2f' && window.DATA && window.DATA.walls.length > 0, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  if (view) {
    await page.evaluate((v) => setView(v), view);
    await page.waitForFunction(() => window.THREE && window.ren, null, T);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(400);
  return { context, page };
}

// 位置と大きさを比べる要素
const LAYOUT = ['#canvas-area', '#c2d', '#toolbar', '#sidebar', '#props', '#statusbar', '#help-box', '#bottom-nav', '#chat-fab'];
const layout = (page) => page.evaluate((sels) => {
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el || !el.getClientRects().length) { out[s] = null; continue; }
    const b = el.getBoundingClientRect();
    out[s] = [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10);
  }
  out.safeTop = getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim();
  out.bodyPad = getComputedStyle(document.body).paddingTop;
  return out;
}, LAYOUT);
const adState = (page) => page.evaluate(() => {
  const el = document.getElementById('pr-top');
  const r = (x) => { if (!x) return null; const b = x.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; };
  const img = el && el.querySelector('.pr-img');
  return {
    shown: !!el && el.getClientRects().length > 0,
    adH: document.documentElement.style.getPropertyValue('--ad-h'),
    hasClass: document.documentElement.classList.contains('has-pr-top'),
    box: r(el), link: r(el && el.querySelector('.pr-link')),
    badge: el && el.querySelector('.pr-badge') ? el.querySelector('.pr-badge').textContent : null,
    imgLoaded: !!img && img.complete && img.naturalWidth > 0, imgW: img ? img.width : 0,
    canvas: r(document.getElementById('canvas-area')),
    href: el && el.querySelector('.pr-link') ? el.querySelector('.pr-link').getAttribute('href') : null,
    rel: el && el.querySelector('.pr-link') ? el.querySelector('.pr-link').rel : null,
    text: el ? el.innerText.trim() : null,
  };
});
// root の中の広告の押せる所(.pr-link)から、ほかの見えている押せる物・見出しまでの距離。重なり・24px 未満を返す
const clearance = (page, rootSel, scopeSel) => page.evaluate(({ rootSel, scopeSel }) => {
  const root = document.querySelector(rootSel);
  const link = root && root.querySelector('.pr-link');
  if (!link) return ['広告の押せる所が無い'];
  const L = link.getBoundingClientRect(), R = root.getBoundingClientRect();
  const scope = scopeSel ? document.querySelector(scopeSel) : document;
  const shown = (el) => { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const inView = (b) => b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight;
  const over = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  const dist = (a, b) => { const dx = Math.max(0, a.left - b.right, b.left - a.right), dy = Math.max(0, a.top - b.bottom, b.top - a.bottom); return Math.hypot(dx, dy); };
  const problems = [];
  const sel = 'button, a, select, input, textarea, summary, label, [onclick], [role=button], .stool, .tbtn, .pbtn, .common-tools-title, h1, h2, h3, .share-title, .asset-swap-title, #toolbar, #statusbar, #plan-notice, #ai-edit-bar, #props, #help-box, #chat-fab';
  for (const el of scope.querySelectorAll(sel)) {
    if (root.contains(el) || el.contains(root) || !shown(el)) continue;
    const b = el.getBoundingClientRect();
    if (!inView(b)) continue;
    // 見えない所(スクロールの外)に隠れている物は除く: 中心がほかの物の下にあれば、そこは押せない
    const name = (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')) + ' 「' + (el.textContent || '').trim().slice(0, 12) + '」';
    if (over(R, b)) problems.push(`${name} が枠に重なっている`);
    const d = dist(L, b);
    if (d < 24) problems.push(`${name} が広告から ${d.toFixed(1)}px(24px 未満)`);
  }
  return problems;
}, { rootSel, scopeSel });

let checks = 0;
const report = [];
try {
  // ── (a) 素材0件 ──
  for (const [w, h] of [[390, 844], [1440, 900], [844, 390]]) {
    const before = await open(w, h, { noScript: true });
    const base = await layout(before.page);
    await before.context.close();
    const zero = await open(w, h, { ads: EMPTY });
    const now = await layout(zero.page);
    const st = await adState(zero.page);
    assert.equal(await zero.page.locator('#pr-top, .pr-box').count(), 0, `[${w}x${h}] 素材0件なのに枠の要素がある`);
    assert.equal(st.hasClass, false); assert.equal(st.adH, '');
    assert.deepEqual(now, base, `[${w}x${h}] 素材0件で画面の並びが変わった`);
    // ダイアログも出さない
    await zero.page.evaluate(() => { openShareDialog(); openJisDrawingDialog(); });
    await zero.page.evaluate(() => PlanLibrary.openList());
    await zero.page.waitForTimeout(300);
    assert.equal(await zero.page.locator('.pr-box').count(), 0, `[${w}x${h}] 素材0件なのにダイアログに枠がある`);
    assert.equal(await zero.page.locator('.pr-slot:not([hidden])').count(), 0);
    await zero.context.close();
    checks++;
  }
  assert.equal(a8Requests, 0, '素材0件なのに a8.net へ読みに行った');

  // ── (b)(c)(e) 6つの大きさ ──
  for (const [w, h, name] of SIZES) {
    const noad = await open(w, h, { noScript: true });
    const base = await layout(noad.page);
    await noad.context.close();
    const { context, page } = await open(w, h);
    const st = await adState(page);
    if (h <= 500) {
      assert.equal(st.shown, false, `[${name}] 高さの低い画面で帯が出た`);
      assert.equal(st.adH, '');
      assert.deepEqual(await layout(page), base, `[${name}] 帯を出さないのに並びが変わった`);
      await page.screenshot({ path: join(SHOTS, `top-${name}.png`), timeout: 90000 });
      report.push(`${name} ${w}x${h}: 出さない(図の広さの減り 0%)`);
      await context.close();
      checks++;
      continue;
    }
    assert.ok(st.shown, `[${name}] 帯が出ていない`);
    assert.ok(st.imgLoaded, `[${name}] 広告の画像が読めていない`);
    assert.equal(st.badge, 'PR', `[${name}] PR の表記が無い`);
    assert.equal(st.text, 'PR', `[${name}] PR 以外の文字が出ている: ${st.text}`);
    assert.match(st.href, /^https:\/\/px\.a8\.net\//);
    assert.match(st.rel, /sponsored/);
    // 高さ 800px 未満は高さ 60px 以下の素材(468×60、無ければ 320×50)。それ以外は幅に入るいちばん広い物
    const expectW = h < 800 ? (w - 16 >= 468 ? 468 : 320) : (w - 16 >= 728 ? 728 : (w - 16 >= 468 ? 468 : 320));
    assert.equal(st.imgW, expectW, `[${name}] 画面に合う幅の素材が選ばれていない`);
    assert.ok(st.box.left >= 0 && st.box.right <= w && st.box.top >= 0, `[${name}] 帯が画面の外に出ている`);
    // 図の領域は帯の下から始まり、帯の高さだけ縮む
    assert.ok(Math.abs(st.canvas.top - st.box.bottom) < 1, `[${name}] 図の領域が帯の下から始まっていない ${st.canvas.top} / ${st.box.bottom}`);
    assert.ok(Math.abs(st.canvas.h - (base['#canvas-area'][3] - st.box.h)) < 1, `[${name}] 図の領域の高さが帯のぶんだけ縮んでいない`);
    // ほかの部品は帯の高さだけ下がる(横の位置と大きさは変わらない)
    const now = await layout(page);
    for (const s of ['#toolbar', '#sidebar', '#props', '#help-box']) {
      if (!base[s] || !now[s]) { assert.equal(!!now[s], !!base[s], `[${name}] ${s} の出方が変わった`); continue; }
      if (base[s][1] >= h) continue;   // 閉じた引き出し(画面の下の外に置かれている)は見ない
      assert.ok(Math.abs(now[s][1] - base[s][1] - st.box.h) < 1, `[${name}] ${s} が帯の高さだけ下がっていない ${base[s]} → ${now[s]}`);
      assert.ok(Math.abs(now[s][0] - base[s][0]) < 1 && Math.abs(now[s][2] - base[s][2]) < 1, `[${name}] ${s} の横の位置・幅が変わった`);
    }
    // 「全体表示」(resetView)は図の領域に対して収めるので、帯があっても間取りは上の操作の段の下に収まる
    const fitGap = (pg) => pg.evaluate(() => {
      resetView();
      const b = planSubjectBoundsMm(ST.floor), c = document.getElementById('canvas-area').getBoundingClientRect();
      const tb = document.getElementById('toolbar').getBoundingClientRect();
      return Math.round((c.top + ST.panY + b.minY * ST.zoom * 0.05 - tb.bottom) * 10) / 10;
    });
    const gapAd = await fitGap(page);
    assert.ok(gapAd >= 0, `[${name}] 全体表示で間取りが上の操作の段の下に入った (${gapAd}px)`);
    // 重なりと 24px。知らせの帯も出して見る
    await page.evaluate(() => { const n = document.getElementById('plan-notice'); document.getElementById('plan-notice-text').textContent = '検査用の知らせです。'; n.hidden = false; });
    const lay = await checkLayout(page, ['#pr-top'], { avoid: ['#toolbar', '#sidebar', '#bottom-nav', '#chat-fab', '#statusbar', '#plan-notice', '#props', '#help-box', '.common-tools-title'] });
    assert.deepEqual(lay.problems, [], `[${name}] ${lay.problems.join(' / ')}`);
    const cl = await clearance(page, '#pr-top');
    assert.deepEqual(cl, [], `[${name}] ${cl.join(' / ')}`);
    await page.screenshot({ path: join(SHOTS, `top-${name}.png`), timeout: 90000 });
    const loss = st.box.h / base['#canvas-area'][3] * 100;
    report.push(`${name} ${w}x${h}: 帯 ${st.box.w}x${st.box.h} (素材 ${st.imgW}幅) 図の広さの減り ${loss.toFixed(1)}% 全体表示で間取りの上端と上の段の間 ${gapAd}px`);
    await page.evaluate(() => { document.getElementById('plan-notice').hidden = true; });

    // (e) 3D
    await page.evaluate(() => setView('3d-ext'));
    await page.waitForFunction(() => window.THREE && window.ren, null, T);
    await page.waitForTimeout(1500);
    const w3 = await page.evaluate(() => { const b = document.getElementById('c3d-wrap').getBoundingClientRect(); const c = window.ren.domElement; return { top: b.top, h: b.height, ch: c.clientHeight }; });
    const st3 = await adState(page);
    assert.ok(st3.shown, `[${name}] 3D で帯が消えた`);
    assert.ok(Math.abs(w3.top - st3.box.bottom) < 1, `[${name}] 3D の画面が帯の下から始まっていない`);
    assert.ok(Math.abs(w3.ch - w3.h) < 1, `[${name}] 3D の描く大きさが画面と合っていない ${w3.ch} / ${w3.h}`);
    const cl3 = await clearance(page, '#pr-top');
    assert.deepEqual(cl3, [], `[${name}] 3D: ${cl3.join(' / ')}`);
    await page.screenshot({ path: join(SHOTS, `top-${name}-3d.png`), timeout: 90000 });
    await page.evaluate(() => setView('2d'));
    await context.close();
    checks++;
  }

  // ── (b2) 高さ 800px 未満の画面の素材の選び方と、大きさを変えたときの選び直し ──
  {
    const topImg = (page) => page.evaluate(() => { const im = document.querySelector('#pr-top .pr-img'); return im ? im.width + 'x' + im.height : null; });
    const adH = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--ad-h'));
    // 468×60 が無く 320×50 と 728×90 だけなら 320×50
    let o = await open(1024, 700, { ads: { ...EMPTY, top: [creative('top728', 728, 90), creative('top320', 320, 50)] } });
    assert.equal(await topImg(o.page), '320x50', '1024×700 で 468×60 が無いのに 320×50 が出ていない');
    assert.equal(await adH(o.page), (6 + 50 + 18) + 'px');
    await o.context.close();
    // 低い素材が無ければ帯を出さない(728×90 に戻さない)
    o = await open(1024, 700, { ads: { ...EMPTY, top: [creative('top728', 728, 90)] } });
    assert.equal(await topImg(o.page), null, '1024×700 で 728×90 が出た');
    assert.equal(await adH(o.page), '');
    await o.context.close();
    // 1024×700 → 1440×900 に広げると 728×90 に替わり、帯の高さも変わる。戻すと 468×60
    o = await open(1024, 700);
    assert.equal(await topImg(o.page), '468x60');
    assert.equal(await adH(o.page), (6 + 60 + 18) + 'px');
    await o.page.setViewportSize({ width: 1440, height: 900 });
    await o.page.waitForFunction(() => { const im = document.querySelector('#pr-top .pr-img'); return im && im.width === 728; }, null, T);
    assert.equal(await adH(o.page), (6 + 90 + 18) + 'px');
    const c1 = await o.page.evaluate(() => { const c = document.getElementById('canvas-area').getBoundingClientRect(), t = document.getElementById('pr-top').getBoundingClientRect(); return Math.round(c.top - t.bottom); });
    assert.equal(c1, 0, '広げたあと図の領域が帯の下から始まっていない');
    await o.page.setViewportSize({ width: 1024, height: 700 });
    await o.page.waitForFunction(() => { const im = document.querySelector('#pr-top .pr-img'); return im && im.width === 468; }, null, T);
    assert.equal(await adH(o.page), (6 + 60 + 18) + 'px');
    await o.context.close();
    checks++;
  }

  // ── (f) ダイアログ ──
  for (const [w, h, name] of [[390, 844, 'iphone-portrait'], [1440, 900, 'pc']]) {
    const { context, page } = await open(w, h);
    const dialogs = [
      ['share', () => openShareDialog(), '#pr-slot-share', '.share-card'],
      ['export', () => openJisDrawingDialog(), '#pr-slot-export', '.jis-dialog'],
      ['library', () => PlanLibrary.openList(), '#plan-library-modal .pr-slot', '#plan-library-modal'],
    ];
    for (const [key, fn, slotSel, scope] of dialogs) {
      await page.evaluate(fn);
      await page.waitForTimeout(600);
      const s = await page.evaluate((slotSel) => {
        const el = document.querySelector(slotSel);
        if (!el) return null;
        el.scrollIntoView({ block: 'end' });
        const img = el.querySelector('.pr-img');
        return { hidden: el.hidden, badge: (el.querySelector('.pr-badge') || {}).textContent, loaded: !!img && img.complete && img.naturalWidth > 0, w: img ? img.width : 0, href: (el.querySelector('.pr-link') || { getAttribute: () => '' }).getAttribute('href') };
      }, slotSel);
      assert.ok(s && !s.hidden, `[${name}] ${key} の枠が出ていない`);
      assert.equal(s.badge, 'PR', `[${name}] ${key} に PR の表記が無い`);
      assert.ok(s.loaded, `[${name}] ${key} の画像が読めていない`);
      assert.match(s.href, /^https:\/\/px\.a8\.net\//);
      await page.waitForTimeout(200);
      const cl = await clearance(page, slotSel, scope);
      assert.deepEqual(cl, [], `[${name}] ${key}: ${cl.join(' / ')}`);
      if (key === 'share') {   // 「はじめて使うとき」を開いても、枠はその下に続く
        await page.evaluate(() => { document.getElementById('share-ai-setup').open = true; document.getElementById('pr-slot-share').scrollIntoView({ block: 'end' }); });
        await page.waitForTimeout(200);
        const cl2 = await clearance(page, slotSel, scope);
        assert.deepEqual(cl2, [], `[${name}] share(開いた): ${cl2.join(' / ')}`);
        await page.evaluate(() => { document.getElementById('share-ai-setup').open = false; document.getElementById('pr-slot-share').scrollIntoView({ block: 'end' }); });
      }
      await page.screenshot({ path: join(SHOTS, `dialog-${key}-${name}.png`), timeout: 90000 });
      await page.evaluate(() => { closeShareDialog(); closeJisDrawingDialog(); const m = document.getElementById('plan-library-modal'); if (m) m.remove(); });
    }
    await context.close();
    checks++;
  }

  // ── (d) 画像が読めない ──
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const noad = await open(w, h, { noScript: true });
    const base = await layout(noad.page);
    await noad.context.close();
    const { context, page } = await open(w, h, { failImages: true });
    await page.waitForFunction(() => !document.getElementById('pr-top'), null, T);
    const st = await adState(page);
    assert.equal(st.shown, false); assert.equal(st.adH, ''); assert.equal(st.hasClass, false);
    assert.deepEqual(await layout(page), base, `[${w}x${h}] 画像が読めないのに並びが戻っていない`);
    await page.evaluate(() => openShareDialog());
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#pr-slot-share').evaluate((el) => el.hidden), true, `[${w}x${h}] 読めない枠が残った`);
    assert.equal(await page.locator('.pr-box').count(), 0);
    await context.close();
    checks++;
  }

  // ── (g) アプリ版 ──
  {
    const before = a8Requests;
    const { context, page } = await open(390, 844, { app: true });
    assert.equal(await page.evaluate(() => adsMode()), 'app');
    const st = await adState(page);
    assert.equal(st.shown, false); assert.equal(st.adH, '');
    await page.evaluate(() => { openShareDialog(); openJisDrawingDialog(); PlanLibrary.openList(); });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.pr-box').count(), 0, 'アプリ版で枠が出た');
    assert.equal(a8Requests, before, 'アプリ版で a8.net へ読みに行った');
    await context.close();
    checks++;
  }
  // ブラウザでは 'web'
  {
    const { context, page } = await open(390, 844, { ads: EMPTY });
    assert.equal(await page.evaluate(() => adsMode()), 'web');
    await context.close();
  }

  // ── (h) a8.net 以外 ──
  {
    const before = a8Requests;
    const { context, page } = await open(1440, 900, { ads: BAD });
    const st = await adState(page);
    assert.equal(st.shown, false, 'a8.net 以外の素材で帯が出た'); assert.equal(st.adH, '');
    await page.evaluate(() => { openShareDialog(); openJisDrawingDialog(); PlanLibrary.openList(); });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.pr-box').count(), 0, 'a8.net 以外の素材で枠が出た');
    assert.equal(a8Requests, before);
    assert.deepEqual(foreign.filter((u) => /evil|tracker|example/.test(u)), [], 'a8.net 以外の先へ読みに行った');
    await context.close();
    checks++;
  }
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], errors.join('\n'));
for (const line of report) console.log('  ' + line);
console.log(`ads-banner: ${checks} 組を確かめた。画像は ${SHOTS}`);
