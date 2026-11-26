// 外の AI(Claude・ChatGPT など)が返したリンクで開いた画面に、広告(assets/js/pr-ads.js)が出ないこと。
//
// なぜ要るか: 外の AI は /api/mcp でプランを作り、共同編集のルームのリンク(#room=<id>&via=ai)を利用者に返す。
// そのリンクで開いた画面には広告を出さない(2026-11-25 決定)。ふつうに開いた画面の広告は今までどおり出す。
//
// 場面:
//   1. ふつうに開く・ふつうの共同編集のリンク(#room=<id>)で開く → 上端の帯が出て、a8.net へ読みに行く
//   2. AI のリンク(#room=<id>&via=ai)で開く → 帯もダイアログの枠も出ず、a8.net へ1回も読みに行かない。
//      並びは、素材0件の画面と 1px も違わない(広告の分の空白やずれが残らない)。共有の URL に印が残る
//   3. そのまま再読み込み → 出ない
//   4. 同じブラウザで、印の無いリンク(#room=<id>)で開き直す → 出ない。ほかのルーム・ルームなしは出る
//   5. ふつうに開いた画面で、保存一覧からそのルームを開く(openSharedRoomFromList) → 出ていた帯が消え、空白が残らない
//   6. アプリ版(Capacitor)相当 → AI のリンクでも、ふつうに開いても、Web の広告は出ない
//
// 素材は window.__HP_PR_ADS__ に検査用の物を差し込む。*.a8.net への要求は route で止めて数える(a8.net へは通信しない)。
// サーバーは使わない。ルームの GET と WebSocket は偽物にする。プランは tools/tests/fixtures/house-2f.json。
// 画像は ADS_SHOT_DIR(無ければ output/test-shots/ads-ai-link)に出す。
//
// sh tools/run_browser_tests.sh ads-ai-link
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shotDir } from './shot-dir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const ORIGIN = new URL(APP).origin;
const SHOTS = process.env.ADS_SHOT_DIR || shotDir('ads-ai-link');
const T = { timeout: 90000 };
const BASE = readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8');
const ROOM = 'AdsAiLinkTestRoom00001';
const OTHER = 'AdsAiLinkOtherRoom0002';
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
const GIF1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#3a7bd5"/><text x="${w / 2}" y="${h / 2 + 6}" font-size="18" fill="#fff" text-anchor="middle" font-family="sans-serif">検査用の広告 ${w}×${h}</text></svg>`;

const browser = await chromium.launch();
const errors = [];

// 1つのブラウザ(覚え書きを共有する)。a8 は a8.net への要求の数
async function newBrowserContext(w, h, { ads = ADS, app = false } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const st = { a8: 0 };
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (/^[a-z0-9-]+\.a8\.net$/.test(u.hostname)) {
      st.a8++;
      if (u.pathname === '/0.gif') return route.fulfill({ status: 200, contentType: 'image/gif', body: GIF1 });
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(Number(u.searchParams.get('w')) || 100, Number(u.searchParams.get('h')) || 50) });
    }
    if (u.origin !== ORIGIN) return route.abort();
    const room = u.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]{22})$/);
    if (room) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: BASE });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  await context.addInitScript(({ ads, app }) => {
    window.__HP_PR_ADS__ = ads;
    if (app) window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    class FakeWS {
      constructor() {
        this.readyState = 1; window.__ws = this;
        setTimeout(() => { this.onopen && this.onopen(); this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'welcome', version: 1, expiresAt: Date.now() + 1e9, savedAt: Date.now(), checkpointPending: false, aiEditsOff: false }) }); }, 0);
      }
      send() {} close() { this.readyState = 3; }
    }
    window.WebSocket = FakeWS;
  }, { ads, app });
  return { context, st };
}
async function settle(page, room) {
  if (room) await page.waitForFunction((room) => window.SHARED && SHARED.roomId === room && window.__ws && DATA.walls.length > 10, room, T);
  else await page.waitForFunction(() => window.DATA && window.DATA.walls.length > 0, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.waitForTimeout(500);
}
async function openPage(context, hash, label) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const room = (hash.match(/room=([A-Za-z0-9_-]{22})/) || [])[1] || null;
  await page.goto(APP + hash);
  await settle(page, room);
  return page;
}

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
  return {
    mode: adsMode(),
    shown: !!el && el.getClientRects().length > 0,
    adH: document.documentElement.style.getPropertyValue('--ad-h'),
    hasClass: document.documentElement.classList.contains('has-pr-top'),
    boxes: document.querySelectorAll('.pr-box').length,
  };
});
const NONE = { mode: 'off', shown: false, adH: '', hasClass: false, boxes: 0 };
// 3つのダイアログ(共有・書き出し・保存一覧)を開いたあとの、広告の枠の数
async function dialogBoxes(page) {
  await page.evaluate(() => { openShareDialog(); openJisDrawingDialog(); PlanLibrary.openList(); });
  await page.waitForTimeout(600);
  return page.locator('.pr-box').count();
}

let checks = 0;
try {
  for (const [w, h, name] of [[1440, 900, 'pc'], [390, 844, 'iphone']]) {
    // 並びの基準: 素材0件で、同じルームを印の無いリンクで開いた画面
    const empty = await newBrowserContext(w, h, { ads: EMPTY });
    const basePage = await openPage(empty.context, '#room=' + ROOM, name + ' base');
    const base = await layout(basePage);
    assert.equal(empty.st.a8, 0);
    await empty.context.close();

    // ── 1. ふつうに開く・ふつうの共同編集のリンクで開く → 出る ──
    {
      const { context, st } = await newBrowserContext(w, h);
      const plain = await openPage(context, '?preset=2f', name + ' plain');
      let s = await adState(plain);
      assert.equal(s.mode, 'web'); assert.equal(s.shown, true, `[${name}] ふつうに開いた画面で帯が出ていない`);
      assert.ok(st.a8 > 0, `[${name}] ふつうに開いた画面で a8.net へ読みに行っていない`);
      await plain.close();
      const before = st.a8;
      const room = await openPage(context, '#room=' + ROOM, name + ' room');
      s = await adState(room);
      assert.equal(s.mode, 'web'); assert.equal(s.shown, true, `[${name}] ふつうの共同編集のリンクで帯が出ていない`);
      assert.ok(st.a8 > before);
      assert.equal(await room.evaluate(() => sharedUrl()), APP + '#room=' + ROOM, 'ふつうのルームの共有の URL に印が付いた');
      assert.equal(await room.evaluate(() => localStorage.getItem('webcad-ai-rooms')), null);
      await room.screenshot({ path: join(SHOTS, `${name}-1-normal-room-with-ad.png`) });
      assert.ok(await dialogBoxes(room) > 0, `[${name}] ふつうの画面のダイアログに枠が出ていない`);
      await context.close();
      checks++;
    }

    // ── 2〜5. AI のリンクで開く ──
    {
      const { context, st } = await newBrowserContext(w, h);
      const page = await openPage(context, '#room=' + ROOM + '&via=ai', name + ' ai');
      assert.deepEqual(await adState(page), NONE, `[${name}] AI のリンクで開いた画面に広告が出た`);
      assert.deepEqual(await layout(page), base, `[${name}] AI のリンクで開いた画面の並びが、素材0件の画面と違う`);
      assert.equal(await page.evaluate(() => sharedUrl()), APP + '#room=' + ROOM + '&via=ai', '共有の URL に印が残っていない');
      await page.screenshot({ path: join(SHOTS, `${name}-2-ai-link-no-ad.png`) });
      assert.equal(await dialogBoxes(page), 0, `[${name}] AI のリンクで開いた画面のダイアログに枠が出た`);
      for (const id of ['pr-slot-share', 'pr-slot-export']) assert.equal(await page.locator('#' + id).evaluate((el) => el.hidden), true, id + ' の空の枠が残った');
      assert.equal(await page.locator('.pr-slot:not([hidden])').count(), 0, '空の枠が残った');
      await page.screenshot({ path: join(SHOTS, `${name}-2-ai-link-dialogs-no-ad.png`) });
      assert.equal(st.a8, 0, `[${name}] AI のリンクで開いた画面が a8.net へ読みに行った`);

      // 3. そのまま再読み込み
      await page.reload();
      await settle(page, ROOM);
      assert.deepEqual(await adState(page), NONE, `[${name}] 再読み込みで広告が出た`);
      assert.deepEqual(await layout(page), base);
      assert.ok(/[#&]via=ai/.test(await page.evaluate(() => location.hash)), '再読み込みで印が外れた');
      assert.equal(st.a8, 0, `[${name}] 再読み込みで a8.net へ読みに行った`);
      await page.close();

      // 4. 同じブラウザで、印の無いリンクで開き直す
      const again = await openPage(context, '#room=' + ROOM, name + ' again');
      assert.deepEqual(await adState(again), NONE, `[${name}] 印の無いリンクで開き直したら広告が出た`);
      assert.deepEqual(await layout(again), base);
      assert.equal(await again.evaluate(() => sharedUrl()), APP + '#room=' + ROOM + '&via=ai', '開き直した画面の共有の URL に印が無い');
      assert.equal(st.a8, 0);
      await again.close();
      // ほかのルームは、同じブラウザでも出る
      const other = await openPage(context, '#room=' + OTHER, name + ' other');
      assert.equal((await adState(other)).shown, true, `[${name}] ほかのルームの広告まで消えた`);
      assert.ok(st.a8 > 0);
      await other.close();

      // 5. ふつうに開いた画面で、保存一覧からそのルームを開く
      const plain = await openPage(context, '?preset=2f', name + ' list');
      assert.equal((await adState(plain)).shown, true);
      const before = st.a8;
      assert.equal(await plain.evaluate((room) => openSharedRoomFromList(room), ROOM), true);
      await settle(plain, ROOM);
      assert.deepEqual(await adState(plain), NONE, `[${name}] 保存一覧から開いたあとも広告が残った`);
      assert.deepEqual(await layout(plain), base, `[${name}] 帯が消えたあとに空白やずれが残った`);
      assert.equal(await plain.evaluate(() => location.hash), '#room=' + ROOM + '&via=ai');
      assert.equal(await dialogBoxes(plain), 0);
      assert.equal(st.a8, before, `[${name}] 保存一覧から開いたあとに a8.net へ読みに行った`);
      await context.close();
      checks++;
    }

    // ── 6. アプリ版(Capacitor)相当 ──
    {
      const { context, st } = await newBrowserContext(w, h, { app: true });
      for (const hash of ['?preset=2f', '#room=' + ROOM + '&via=ai']) {
        const page = await openPage(context, hash, name + ' app');
        assert.deepEqual(await adState(page), { ...NONE, mode: 'app' }, `[${name}] アプリ版(${hash})で Web の広告が出た`);
        assert.equal(await dialogBoxes(page), 0);
        await page.close();
      }
      assert.equal(st.a8, 0, `[${name}] アプリ版で a8.net へ読みに行った`);
      await context.close();
      checks++;
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(errors, [], errors.join('\n'));
console.log(`ads-ai-link: ${checks} 組を確かめた。画像は ${SHOTS}`);
