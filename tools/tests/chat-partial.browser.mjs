// 大きな依頼(白紙から家を作る など)が途中で止まっても、作った分がプランに入り、続きを頼めること。AI は呼ばない。
//
// window.fetch を差し替え、/api/ai/chat を台本どおりの SSE で返す(tools/tests/chat-sse-fixtures.cjs)。
//
// 見ること:
//   1. 1回め: 部屋と基礎を足す → 2回めの返事が出力の上限で切れる(壁 3 本のうち最後が途中で切れる)→ 3回めは
//      依頼の上限(429 rounds_exceeded)。部屋・基礎・壁 2 本がプランに入り、取り消しの履歴は1つだけ増える。
//      チャット欄に「ここまで作ったところで止まりました…」と「続きを頼む」「元に戻す」が出る。
//      2回めの本文には切れた道具が無く、3回めの本文の最後の結果に「切れた」ことが書いてある
//   2. 「元に戻す」1回で依頼の前のプランに戻り、「続きを頼む」も消える
//   3. もう一度頼んで途中で止まる → 「続きを頼む」を押すと「続けて」を新しい依頼で送る。本文の先頭に前の依頼の文と
//      「途中で止まりました」が入っている。AI が区切りで止めた印(［続きあり］)は画面に出さず、新しい依頼の下に
//      「続きを頼む」が出る(前の依頼のボタンは消える)
//   4. 幅 375 でも、ボタン2つがパネルの中に収まる
//
// 画面写真を output/test-shots/chat-partial-*.png に残す(git の管理外)。
// sh tools/run_browser_tests.sh chat-partial
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { sseFor, sseMaxTokens } = require('./chat-sse-fixtures.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '..', '..', 'output', 'test-shots');
mkdirSync(SHOTS, { recursive: true });
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);

const PARTIAL = 'ここまで作ったところで止まりました。作った分はプランに入れてあります。「続きを頼む」で続きを作れます。';
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const txt = (text) => ({ type: 'text', text });
const head = () => ({ 'x-chat-ticket': 'tk-' + Math.random().toString(36).slice(2), 'x-chat-rounds-left': '5' });
const ok = (content, stop) => ({ status: 200, body: sseFor(content, { stop: stop || 'end_turn', textPiece: 3 }), headers: head() });
const cut = (content) => ({ status: 200, body: sseMaxTokens(content, { textPiece: 3, jsonPiece: 7 }), headers: head() });
const fail = (status, code) => ({ status, body: JSON.stringify({ error: code, code, message: 'x' }), headers: {} });

const wall = (id, x1, y1, x2, y2) => tool(id, 'addWall', { x1, y1, x2, y2, floor: 1 });
// 1回めの依頼の台本: 部屋と基礎 → 壁 3 本(最後が切れる)→ 依頼の上限
const FIRST = () => [
  ok([txt('敷地と基礎から作ります。'), tool('a1', 'addRoom', { name: 'LDK', floor: 1, x: 4550, y: 3640, w: 9100, d: 7280 }),
    tool('a2', 'placeItem', { type: 'foundation', x: 4550, y: 3640, w: 9100, d: 7280, floor: 1 })], 'tool_use'),
  cut([txt('外壁を足します。'), wall('a3', 0, 0, 9100, 0), wall('a4', 9100, 0, 9100, 7280), wall('a5', 9100, 7280, 0, 7280)]),
  fail(429, 'rounds_exceeded'),
];

function installFakeChat() {
  window.__chat = { queue: [], calls: [] };
  const realFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    if (!String(url).includes('/api/ai/chat')) return realFetch(url, init);
    const c = window.__chat;
    try { c.calls.push(JSON.parse(init.body)); } catch (e) { c.calls.push(null); }
    const step = c.queue.shift();
    if (!step) return Promise.resolve(new Response(JSON.stringify({ error: 'bad_request', code: 'bad_request' }), { status: 400 }));
    const headers = Object.assign({ 'content-type': step.status === 200 ? 'text/event-stream' : 'application/json' }, step.headers || {});
    if (step.status !== 200) return Promise.resolve(new Response(step.body, { status: step.status, headers }));
    const enc = new TextEncoder();
    const parts = step.body.match(/[\s\S]{1,160}/g) || [''];
    let i = 0;
    return Promise.resolve(new Response(new ReadableStream({
      async pull(ctrl) {
        if (i >= parts.length) { ctrl.close(); return; }
        ctrl.enqueue(enc.encode(parts[i++]));
        await new Promise((r) => setTimeout(r, 2));
      },
    }), { status: 200, headers }));
  };
}

async function openApp(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(installFakeChat);
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);
  await page.evaluate(() => { clearEditHistory(); draw2d(); });
  await page.locator('#chat-fab').click();
  await page.waitForSelector('#chat-panel:not([hidden])', { timeout: 5000 });
  return { context, page, errors };
}

const plan = (page) => page.evaluate(() => ({
  json: JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v)),
  history: HISTORY.length,
  walls: DATA.walls.length,
  rooms: DATA.rooms.length,
  foundations: DATA.items.filter((o) => o.type === 'foundation').length,
}));
const script = (page, steps) => page.evaluate((s) => { window.__chat.queue.push(...s); }, steps);
const entries = (page) => page.evaluate(() => [...document.querySelectorAll('#chat-log .chat-entry')].map((e) => {
  const vis = (sel) => { const b = e.querySelector(sel); return !!(b && b.offsetParent); };
  return { user: (e.querySelector('.chat-user') || {}).textContent || '', ai: (e.querySelector('.chat-ai') || {}).textContent || '',
    undo: vis('.chat-undo'), more: vis('.chat-continue') };
}));
async function send(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-send').click();
}
const idle = (page) => page.waitForFunction(() => window.ChatUI && !ChatUI.state().busy, null, { timeout: 15000 });

const browser = await chromium.launch();
try {
  const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
  const before = await plan(page);

  // ── 1. 途中で止まる → 作った分が入る ──────────────────────────────────
  await script(page, FIRST());
  await send(page, '2階建て3LDKを白紙から作って');
  await idle(page);
  let p = await plan(page);
  assert.equal(p.rooms, before.rooms + 1, '部屋が入っていない');
  assert.equal(p.foundations, before.foundations + 1, '基礎が入っていない');
  assert.equal(p.walls, before.walls + 2, '完結した壁 2 本が入っていない(切れた3本めは入らない)');
  assert.equal(p.history, before.history + 1, '取り消しの履歴が1つだけ増えていない');
  let es = await entries(page);
  let e = es[es.length - 1];
  assert.ok(e.ai.includes(PARTIAL), '途中で止まった文が出ていない: ' + e.ai);
  assert.ok(e.ai.includes('外壁を足します。'), 'AI の文が出ていない: ' + e.ai);
  assert.ok(e.more, '「続きを頼む」が出ていない');
  assert.ok(e.undo, '「元に戻す」が出ていない');
  assert.ok(!/token|トークン|\$|円|秒/.test(e.ai), '開発の都合の言葉が出ている: ' + e.ai);
  const calls = await page.evaluate(() => window.__chat.calls);
  assert.equal(calls.length, 3);
  const asst = calls[2].messages[3];
  assert.equal(asst.role, 'assistant');
  assert.deepEqual(asst.content.filter((b) => b.type === 'tool_use').map((b) => b.id), ['a3', 'a4'], '切れた道具を送り返している');
  const results = calls[2].messages[4].content;
  assert.deepEqual(results.map((b) => b.tool_use_id), ['a3', 'a4']);
  assert.match(results[1].content, /途中で切れました/);
  await page.screenshot({ path: join(SHOTS, 'chat-partial-1280.png') });

  // ── 2. 「元に戻す」1回で全部戻る ─────────────────────────────────────
  await page.locator('.chat-undo').last().click();
  p = await plan(page);
  assert.equal(p.json, before.json, '「元に戻す」で依頼の前のプランに戻らない');
  e = (await entries(page)).at(-1);
  assert.ok(!e.more, '「元に戻す」のあとも「続きを頼む」が残っている');
  assert.ok(!e.undo);

  // ── 3. もう一度 → 「続きを頼む」 ──────────────────────────────────────
  await script(page, FIRST());
  await send(page, '2階建て3LDKを白紙から作って');
  await idle(page);
  const mid = await plan(page);
  assert.equal(mid.walls, before.walls + 2);
  await script(page, [
    ok([txt('残りの外壁を足します。'), wall('b1', 9100, 7280, 0, 7280), wall('b2', 0, 7280, 0, 0)], 'tool_use'),
    ok([txt('外壁まで作りました。次は窓とドアです。\n［続きあり］')], 'end_turn'),
  ]);
  const n0 = (await page.evaluate(() => window.__chat.calls.length));
  await page.locator('.chat-continue').last().click();
  await idle(page);
  p = await plan(page);
  assert.equal(p.walls, mid.walls + 2, '続きの壁が入っていない');
  const cont = (await page.evaluate(() => window.__chat.calls))[n0];
  assert.equal(cont.ticket, undefined, '続きは新しい依頼で送る');
  assert.equal(cont.messages[0].content, '<user_request>\n2階建て3LDKを白紙から作って\n</user_request>', '前の依頼の文が入っていない');
  assert.match(cont.messages[1].content, /途中で止まりました/, '止まったことが AI に渡っていない');
  assert.ok(cont.messages[cont.messages.length - 1].content.endsWith('<user_request>\n続けて\n</user_request>'));
  es = await entries(page);
  e = es[es.length - 1];
  assert.equal(e.user, '続けて');
  assert.ok(e.ai.includes('外壁まで作りました。次は窓とドアです。'), e.ai);
  assert.ok(!e.ai.includes('［続きあり］'), '区切りの印が画面に出ている');
  assert.ok(e.more, 'AI が区切りで止めたのに「続きを頼む」が出ていない');
  assert.ok(!es[es.length - 2].more, '前の依頼の「続きを頼む」が残っている');
  assert.equal(await page.locator('.chat-continue').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();

  // ── 4. 幅 375 ──────────────────────────────────────────────────────
  {
    const { context: c2, page: pg, errors: err2 } = await openApp(browser, { width: 375, height: 812 });
    await script(pg, FIRST());
    await send(pg, '2階建て3LDKを白紙から作って');
    await idle(pg);
    const r = await pg.evaluate(() => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const panel = box(document.getElementById('chat-panel'));
      return { panel, more: box(document.querySelector('.chat-continue')), undo: box(document.querySelector('.chat-undo')), vw: innerWidth };
    });
    for (const k of ['more', 'undo']) {
      assert.ok(r[k].left >= r.panel.left && r[k].right <= r.panel.right + 0.5 && r[k].right <= r.vw, k + ' がパネルからはみ出している: ' + JSON.stringify(r));
    }
    await pg.screenshot({ path: join(SHOTS, 'chat-partial-375.png') });
    assert.deepEqual(err2, []);
    await c2.close();
  }
  console.log('chat-partial: ok');
} finally {
  await browser.close();
}
