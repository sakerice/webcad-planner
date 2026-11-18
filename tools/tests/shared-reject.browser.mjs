// 共同編集で、部屋が変更を 400 で断ったとき、同じ変更を送り直し続けないこと。
//
// なぜ要るか: 部屋(worker/room-guard.mjs)は形の合わない差分を 400 で断る。何度送っても通らない
// のに、画面は以前、失敗のたびに同じ差分を 600ms ごとに送り直し、同期が止まったまま送り続けた。
// 400 のときは送り直さず、部屋の最新の状態を取り直して画面を合わせ、同期できなかったことを
// 共有の欄(#share-status)に出す。
// 413(本文か当てたあとのプランが保存の上限を超える)も、待っても通らないので 400 と同じ扱いにする。
// 429(多すぎる)・5xx・通信の失敗は、これまでどおり送り直す(この挙動は変えない)。
//
// サーバーは使わない。ルームの GET と /update を偽物にし、WebSocket も偽物にする。
//
// sh tools/run_browser_tests.sh shared-reject
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const BASE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const ROOM = 'SharedRejectTestRoom01';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];

// reply: /update への返事('abort' は通信の失敗)。途中で差し替えられるよう、入れ物で持つ。
async function openRoom(label, reply) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const st = { gets: 0, updates: 0, reply };
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(() => {
    class FakeWS { constructor(url) { this.url = url; this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() { this.readyState = 3; } }
    window.WebSocket = FakeWS;
  });
  await page.route('**/api/rooms/' + ROOM, (route) => {
    st.gets++;
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: JSON.stringify(BASE) });
  });
  await page.route('**/api/rooms/' + ROOM + '/update', (route) => {
    st.updates++;
    if (st.reply === 'abort') return route.abort();
    const status = st.reply;
    const body = status === 200 ? { ok: true, version: 2, expiresAt: Date.now() + 1e9 } : { error: status === 400 ? 'invalid_patch' : 'error' };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(APP + '#room=' + ROOM);
  await page.waitForFunction(() => window.SHARED && SHARED.roomId && window.__ws && DATA.walls.length > 10, null, T);
  await page.waitForTimeout(300);
  return { context, page, st };
}

// 手元で壁を1枚変える(利用者が欄を変えたのと同じく、変更の印を付けて送信を予約する)
const editWall = (page, thick) => page.evaluate((thick) => {
  const w = DATA.walls[0];
  w.thick = thick;
  sharedMarkIdsDirty([w.id]);
  markDirty();
  return w.id;
}, thick);
const state = (page) => page.evaluate(() => {
  const el = document.getElementById('share-status');
  return { thick: DATA.walls[0].thick, status: el ? el.textContent : '', error: !!(el && el.classList.contains('error')), tracked: !!sharedHasTrackedChanges(), sending: !!SHARED.sending };
});

try {
  const serverThick = BASE.walls[0].thick;

  // ── 400・413: 送り直さず、部屋の状態を取り直す ──
  // 413 は本文か、当てたあとのプランが保存の上限を超える(worker/collab-room.mjs の update)。どちらも待っても通らない。
  for (const rejected of [400, 413]) {
    const label = String(rejected);
    const { context, page, st } = await openRoom(label, rejected);
    const gets0 = st.gets;
    await editWall(page, serverThick + 30);
    await sleep(4000);
    const s = await state(page);
    assert.equal(st.updates, 1, `${label}: 断られた変更を ${st.updates} 回送った(1回だけのはず)`);
    assert.ok(st.gets > gets0, `${label}: 部屋の最新の状態を取り直していない`);
    assert.equal(s.thick, serverThick, `${label}: 画面が部屋の状態に戻っていない`);
    assert.ok(s.error && /反映できなかった/.test(s.status), `${label}: 同期できなかったことが出ていない: ${s.status}`);
    assert.ok(!/\d{3}/.test(s.status), `${label}: 知らせに数値が出ている: ${s.status}`);
    assert.equal(s.tracked, false, `${label}: 送れなかった変更の印が残っている`);
    // そのあとの正当な変更は、ふつうに送れる
    st.reply = 200;
    await editWall(page, serverThick + 60);
    await sleep(2000);
    const s2 = await state(page);
    assert.equal(st.updates, 2, `${label}: 取り直したあとの変更が送られていない(送った回数 ${st.updates})`);
    assert.equal(s2.thick, serverThick + 60);
    assert.ok(!s2.error && /同期しました/.test(s2.status), `${label}: 取り直したあとの変更が同期されない: ${s2.status}`);
    console.log(`ok  ${label}: 断られた変更は1回だけ送り、部屋の状態に戻して知らせた。そのあとの変更はふつうに送れた`);
    await context.close();
  }

  // ── 429・5xx・通信の失敗: これまでどおり送り直す(手元の変更は残す) ──
  for (const reply of [429, 500, 503, 'abort']) {
    const label = String(reply);
    const { context, page, st } = await openRoom(label, reply);
    const gets0 = st.gets;
    await editWall(page, serverThick + 30);
    await sleep(3500);
    const s = await state(page);
    assert.ok(st.updates >= 3, `${label}: 送り直していない(送った回数 ${st.updates})`);
    assert.equal(st.gets, gets0, `${label}: 部屋の状態を取り直した(これまでの挙動と違う)`);
    assert.equal(s.thick, serverThick + 30, `${label}: 手元の変更が消えた`);
    assert.ok(s.error, `${label}: 同期できないことが出ていない`);
    if (reply === 'abort') assert.ok(s.status.length > 0);
    else assert.match(s.status, new RegExp('同期できませんでした（' + reply + '）'));
    // 直れば、残っていた変更が届く
    st.reply = 200;
    await sleep(1500);
    const s2 = await state(page);
    assert.ok(!s2.error && /同期しました/.test(s2.status), `${label}: 直ったあとも同期されない: ${s2.status}`);
    assert.equal(s2.tracked, false);
    console.log(`ok  ${label}: これまでどおり送り直し(${st.updates - 1}回)、手元の変更を残し、直ると同期した`);
    await context.close();
  }

  assert.deepEqual(errors, [], 'ページの例外:\n' + errors.join('\n'));
} finally {
  await browser.close();
}
console.log('共同編集: 400・413 は送り直さず取り直し、ほかの失敗はこれまでどおり送り直す');
