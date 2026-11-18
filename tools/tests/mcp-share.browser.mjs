// 共有のダイアログの「AIアプリから直す」(openPlanInAiApp・copyAiAppAddress)を確かめる。
//
// - 共同編集を始めていなければルームを1つ作り、AI に貼る文(頼み方 + ルームの URL)をコピーする
// - すでにルームに入っていれば、新しいルームを作らずに同じ URL を使う
// - ルームの作成に失敗したら、AI 用の文はコピーせず、今の失敗の文を出す
// - クリップボードが使えなければ、文を選べる欄に出す
// - 「住所をコピー」で <オリジン>/api/mcp が入る
// - 幅 1280 と 375 で、ダイアログが画面に収まり、足した部分が見える(写真を output/test-shots に残す)
// - ダイアログを開かなければ、起動時に何も起きない(エラーも /api/rooms への通信も無い)
//
// サーバーは使わない。/api/rooms の作成・WebSocket・クリップボードを偽物に差し替える(外へ通信しない)。
//
// sh tools/run_browser_tests.sh mcp-share
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { shotDir } from './shot-dir.mjs';

const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const PROMPT = 'house-planner のこのプランを開いてください。';
const ROOM_URL = /^https?:\/\/[^/]+\/#room=[A-Za-z0-9_-]{22}$/;

async function openApp(browser, { width = 1280, height = 900, roomStatus = 200, clipboardFails = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({ roomStatus, clipboardFails }) => {
    window.__rooms = { posts: 0, status: roomStatus };
    window.__clip = { text: null, writes: 0, execCalls: 0 };
    class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
    window.WebSocket = FakeWS;
    const realFetch = window.fetch.bind(window);
    window.fetch = function (url, init) {
      const u = typeof url === 'string' ? url : String(url && url.url || url);
      if (/\/api\/rooms\/?$/.test(u) && init && init.method === 'POST') {
        window.__rooms.posts++;
        if (window.__rooms.status !== 200) return Promise.resolve(new Response('{"error":"x"}', { status: window.__rooms.status }));
        const id = ('Rm' + window.__rooms.posts + 'abcdefghijklmnopqrstuvwxyz').slice(0, 22);
        const now = Date.now();
        const body = { roomId: id, url: location.origin + '/#room=' + id, version: 1, expiresAt: now + 60 * 864e5, savedAt: now };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (/\/api\/rooms\//.test(u)) return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
      return realFetch(url, init);
    };
    const clip = {
      writeText(t) {
        window.__clip.writes++;
        if (clipboardFails) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
        window.__clip.text = String(t); return Promise.resolve();
      },
      readText() { return Promise.resolve(window.__clip.text || ''); },
    };
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get() { return clip; } });
    const realExec = Document.prototype.execCommand;
    Document.prototype.execCommand = function (cmd, ...rest) {
      if (cmd === 'copy') { window.__clip.execCalls++; return !clipboardFails; }
      return realExec.call(this, cmd, ...rest);
    };
  }, { roomStatus, clipboardFails });
  await page.goto(APP + '?preset=blank');
  await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 }).catch(() => {});
  return { page, context, errors };
}

const state = (page) => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0; };
  return {
    posts: window.__rooms.posts, clip: window.__clip.text, writes: window.__clip.writes, execCalls: window.__clip.execCalls,
    roomId: SHARED.roomId, href: location.href,
    aiStatus: document.getElementById('share-ai-status').textContent, aiStatusVisible: vis('share-ai-status'),
    aiText: document.getElementById('share-ai-text').value, aiTextVisible: vis('share-ai-text'),
    shareStatus: document.getElementById('share-status').textContent,
    shareStatusError: document.getElementById('share-status').classList.contains('error'),
    shareUrl: document.getElementById('share-url').value,
    connectedVisible: vis('share-connected-section'), createVisible: vis('share-create-btn'), leaveVisible: vis('share-leave-btn'),
    aiBtnDisabled: document.getElementById('share-ai-btn').disabled,
  };
});
async function pressAi(page) {
  await page.click('#share-ai-btn');
  await page.waitForFunction(() => !document.getElementById('share-ai-btn').disabled && window.__rooms.posts >= 0, null, T);
  await page.waitForTimeout(150);
}

const browser = await chromium.launch();
let passed = 0;
try {
  // 1. 共同編集を始めていない状態で押す → ルームが1つ作られ、文がコピーされる。2. もう1度押す → 同じルーム
  {
    const { page, context, errors } = await openApp(browser);
    await page.evaluate(() => openShareDialog());
    const before = await state(page);
    assert.equal(before.roomId, null);
    assert.equal(before.aiStatusVisible, false, '押す前は AI の欄の知らせは出ていない');
    assert.equal(before.createVisible, true);
    await pressAi(page);
    const s = await state(page);
    assert.equal(s.posts, 1, 'ルームが1つ作られる');
    assert.ok(s.roomId && /^[A-Za-z0-9_-]{22}$/.test(s.roomId));
    assert.ok(s.clip.startsWith(PROMPT), `コピーした文: ${s.clip}`);
    const url = s.clip.slice(PROMPT.length);
    assert.match(url, ROOM_URL);
    assert.ok(url.endsWith('#room=' + s.roomId));
    assert.equal(s.aiStatus, 'AIアプリに貼る文をコピーしました。');
    assert.equal(s.aiStatusVisible, true);
    assert.equal(s.aiTextVisible, false, 'コピーできたときは文の欄は出さない');
    // 今の共同編集の表示も今までどおり
    assert.equal(s.connectedVisible, true);
    assert.equal(s.shareUrl, url, '共同編集URLの欄に同じ URL');
    assert.equal(s.createVisible, false);
    assert.equal(s.leaveVisible, true);
    assert.ok(s.href.endsWith('#room=' + s.roomId), 'アドレス欄もルームの URL');
    assert.equal(s.shareStatusError, false);
    passed++; console.log('ok 1 ルームを作って、AI に貼る文をコピーする');

    await page.evaluate(() => { window.__clip.text = null; });
    await pressAi(page);
    const s2 = await state(page);
    assert.equal(s2.posts, 1, '2回めは新しいルームを作らない');
    assert.equal(s2.roomId, s.roomId);
    assert.equal(s2.clip, PROMPT + url, '同じルームの URL');
    assert.equal(s2.aiStatus, 'AIアプリに貼る文をコピーしました。');
    passed++; console.log('ok 2 すでにルームに入っていれば、同じルームを使う');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // 2b. ルームに参加済み(URL から入ったのと同じ状態)で押す → 作らない
  {
    const { page, context, errors } = await openApp(browser);
    await page.evaluate(() => {
      window.queueSharedLocalAutoSave = function () {};
      SHARED.roomId = 'joinedroomjoinedroom01'; SHARED.version = 3;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking();
      history.replaceState(null, '', location.origin + '/#room=joinedroomjoinedroom01');
      connectSharedSocket(); clearDirty(); renderSharedUi(); openShareDialog();
    });
    await pressAi(page);
    const s = await state(page);
    assert.equal(s.posts, 0, '参加中のルームがあれば作らない');
    assert.equal(s.clip, PROMPT + await page.evaluate(() => location.origin) + '/#room=joinedroomjoinedroom01');
    assert.equal(s.aiStatus, 'AIアプリに貼る文をコピーしました。');
    assert.deepEqual(errors, []);
    passed++; console.log('ok 3 参加中のルームの URL を使う');
    await context.close();
  }

  // 3. ルームの作成が失敗する → AI 用の文はコピーせず、今の失敗の文
  {
    const { page, context, errors } = await openApp(browser, { roomStatus: 500 });
    await page.evaluate(() => openShareDialog());
    await pressAi(page);
    const s = await state(page);
    assert.equal(s.posts, 1);
    assert.equal(s.roomId, null);
    assert.equal(s.clip, null, '何もコピーしない');
    assert.equal(s.writes, 0, 'クリップボードに書きにいかない');
    assert.equal(s.shareStatus, '共同編集ルームを作成できませんでした。');
    assert.equal(s.shareStatusError, true);
    assert.equal(s.aiStatusVisible, false);
    assert.equal(s.aiTextVisible, false);
    assert.equal(s.createVisible, true, '「共同編集を開始」はそのまま');
    assert.equal(s.aiBtnDisabled, false, 'ボタンは押せる状態に戻る');
    assert.deepEqual(errors.filter((m) => !/Failed to load resource|net::ERR_|status of 500/.test(m)), []);
    passed++; console.log('ok 4 作成に失敗したら、コピーせず今の失敗の文を出す');
    await context.close();
  }

  // 4. クリップボードが使えない → 文を選べる欄に出す
  {
    const { page, context, errors } = await openApp(browser, { clipboardFails: true });
    await page.evaluate(() => openShareDialog());
    await pressAi(page);
    const s = await state(page);
    assert.equal(s.posts, 1);
    assert.equal(s.clip, null);
    assert.equal(s.aiTextVisible, true, '文の欄が出る');
    assert.ok(s.aiText.startsWith(PROMPT));
    assert.match(s.aiText.slice(PROMPT.length), ROOM_URL);
    assert.equal(s.aiStatus, 'この文をコピーして、AIアプリに貼ってください。');
    const sel = await page.evaluate(() => { const f = document.getElementById('share-ai-text'); return { readOnly: f.readOnly, start: f.selectionStart, end: f.selectionEnd, len: f.value.length }; });
    assert.equal(sel.readOnly, true);
    assert.deepEqual([sel.start, sel.end], [0, sel.len], '文が選ばれている');
    // 次に押してコピーできたら欄は隠れる
    await page.evaluate(() => { const c = { writeText(t) { window.__clip.text = String(t); return Promise.resolve(); } }; Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get() { return c; } }); });
    await pressAi(page);
    const s2 = await state(page);
    assert.equal(s2.aiTextVisible, false);
    assert.equal(s2.aiStatus, 'AIアプリに貼る文をコピーしました。');
    assert.equal(s2.posts, 1);
    assert.deepEqual(errors, []);
    passed++; console.log('ok 5 クリップボードが使えなければ、選べる欄に出す');
    await context.close();
  }

  // 5. 住所をコピー
  {
    const { page, context, errors } = await openApp(browser);
    await page.evaluate(() => openShareDialog());
    const origin = await page.evaluate(() => location.origin);
    assert.equal(await page.inputValue('#share-ai-address'), origin + '/api/mcp', 'ダイアログを開くと住所が入っている');
    await page.click('#share-ai-setup summary');
    await page.click('#share-ai-address-btn');
    await page.waitForFunction(() => window.__clip.text !== null, null, T);
    const s = await state(page);
    assert.equal(s.clip, origin + '/api/mcp');
    assert.equal(s.aiStatus, '住所をコピーしました。');
    assert.equal(s.posts, 0, '住所のコピーではルームを作らない');
    assert.equal(await page.evaluate(() => document.getElementById('share-ai-address').readOnly), true);
    assert.deepEqual(errors, []);
    passed++; console.log('ok 6 住所をコピーする');
    await context.close();
  }

  // 6. 幅 1280 と 375 で収まり、足した部分が見える。写真を残す(「はじめて使うとき」を開いた状態)
  const dir = shotDir();
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    const { page, context, errors } = await openApp(browser, { width, height });
    await page.evaluate(() => openShareDialog());
    await pressAi(page);
    await page.evaluate(() => { document.getElementById('share-ai-setup').open = true; });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => {
      const card = document.querySelector('#share-overlay .share-card');
      const r = card.getBoundingClientRect();
      const size = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: b.width, h: b.height }; };
      return {
        vw: innerWidth, vh: innerHeight, card: { l: r.left, t: r.top, r: r.right, b: r.bottom },
        hScroll: card.scrollWidth - card.clientWidth, docHScroll: document.documentElement.scrollWidth - innerWidth,
        overflowY: getComputedStyle(card).overflowY,
        targets: { ai: size('#share-ai-btn'), addr: size('#share-ai-address-btn'), summary: size('#share-ai-setup summary') },
      };
    });
    assert.ok(m.card.l >= 0 && m.card.t >= 0 && m.card.r <= m.vw && m.card.b <= m.vh, `${width}: ダイアログが画面からはみ出している ${JSON.stringify(m.card)}`);
    assert.ok(m.hScroll <= 0, `${width}: ダイアログの中が横にはみ出している (${m.hScroll}px)`);
    assert.ok(m.overflowY === 'auto' || m.overflowY === 'scroll', `${width}: ダイアログの中が縦に送れない`);
    for (const [k, v] of Object.entries(m.targets)) assert.ok(v.h >= 40, `${width}: ${k} の高さが ${v.h}px (40px 未満)`);
    // 足した部分を見える所まで送る(375 では縦に送る)。区切りの見出しから注意の文までが画面の中にあるか確かめる
    await page.evaluate(() => document.getElementById('share-ai-title').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => {
      const card = document.querySelector('#share-overlay .share-card').getBoundingClientRect();
      const inside = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return b.height > 0 && b.top >= card.top - 1 && b.bottom <= card.bottom + 1; };
      return { title: inside('#share-ai-title'), button: inside('#share-ai-btn'), status: inside('#share-ai-status'), address: inside('#share-ai-address'), copy: inside('#share-ai-address-btn') };
    });
    for (const [k, v] of Object.entries(seen)) assert.ok(v, `${width}: ${k} が見えていない`);
    if (width >= 1000) {
      const note = await page.evaluate(() => { const c = document.querySelector('#share-overlay .share-card').getBoundingClientRect(); const b = document.querySelector('.share-ai-note').getBoundingClientRect(); return b.bottom <= c.bottom + 1; });
      assert.ok(note, `${width}: 注意の文が見えていない`);
    }
    const file = join(dir, `mcp-share-${width}.png`);
    await page.screenshot({ path: file });
    console.log(`写真: ${file}`);
    assert.deepEqual(errors, []);
    passed++; console.log(`ok 幅 ${width} で収まる`);
    await context.close();
  }

  // 7. ダイアログを1度も開かない → エラーなし、ルームへの通信なし、何も出ていない
  {
    const { page, context, errors } = await openApp(browser);
    await page.waitForTimeout(1500);
    const s = await state(page);
    assert.equal(s.posts, 0);
    assert.equal(s.writes, 0);
    assert.equal(await page.evaluate(() => document.getElementById('share-overlay').classList.contains('show')), false);
    assert.equal(await page.inputValue('#share-ai-address'), '', '開くまで住所も入れない(起動時の処理を足していない)');
    const real = errors.filter((m) => !/Failed to load resource|net::ERR_/.test(m));
    assert.deepEqual(real, []);
    passed++; console.log("ok ダイアログを開かなければ何も起きない");
    await context.close();
  }
  console.log(`mcp-share: ${passed} 件 ok`);
} finally {
  await browser.close();
}
