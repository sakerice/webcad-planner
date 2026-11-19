// 共同編集で、部屋が変更を 400 で断ったとき、同じ変更を送り直し続けないこと。
//
// なぜ要るか: 部屋(worker/room-guard.mjs)は形の合わない差分を 400 で断る。何度送っても通らない
// のに、画面は以前、失敗のたびに同じ差分を 600ms ごとに送り直し、同期が止まったまま送り続けた。
// 400 のときは送り直さず、部屋の最新の状態を取り直して画面を合わせ、同期できなかったことを
// 共有の欄(#share-status)に出す。
// 413(本文か当てたあとのプランが保存の上限を超える)も、待っても通らないので 400 と同じ扱いにする。
// 429(多すぎる)・5xx・通信の失敗は、これまでどおり送り直す(この挙動は変えない)。
// 取り直す前に、手元のプラン(断られた変更と、応答待ちの間の編集を含む)を「保存一覧」に
// 「共同編集に反映できなかった変更（日時）」として残す。5 分以内に続けて断られたら、同じ項目を上書きする。
// 10MB を超えるプランも一覧に残せること。残せなかったときは、知らせに「ファイルに保存」のボタンを出す。
// 幅 375 で知らせの写真を撮る(UI_SHOT_DIR があればそこへ)。
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

const SHOT_DIR = process.env.UI_SHOT_DIR || '';
const browser = await chromium.launch();
const errors = [];

// 保存一覧のうち、断られた変更を残した項目(名前と中身)
const keptRows = (page) => page.evaluate(async () => {
  const rows = (await PlanLibrary.list()).filter((m) => /^共同編集に反映できなかった変更（\d+\/\d+ \d\d:\d\d）$/.test(m.name));
  const out = [];
  for (const m of rows) { const p = await PlanLibrary.get(m.id); out.push({ id: m.id, name: m.name, thick: p && p.walls[0].thick, extra: p && p.walls[1] && p.walls[1].thick, big: p && p.items[0] && typeof p.items[0].__big === 'string' ? p.items[0].__big.length : 0 }); }
  return out;
});
const notice = (page) => page.evaluate(() => ({
  hidden: document.getElementById('plan-notice').hidden,
  text: document.getElementById('plan-notice-text').textContent,
  action: document.getElementById('plan-notice-action').hidden ? '' : document.getElementById('plan-notice-action').textContent,
}));

// reply: /update への返事('abort' は通信の失敗)。途中で差し替えられるよう、入れ物で持つ。
async function openRoom(label, reply, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 812 : 900 } });
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
    // 413 は理由(プランが保存できる大きさを超えること)を添える。400 は今までどおりの文
    if (rejected === 413) assert.ok(/保存できる大きさ（10MB）を超える/.test(s.status), `413: 理由が出ていない: ${s.status}`);
    else assert.equal(s.status, 'この変更は共同編集に反映できなかったため、取り消して最新の状態に戻しました。戻す前のプランは「保存一覧」に残しました。', `400: 文言が変わった: ${s.status}`);
    // 戻す前の手元のプランが、保存一覧に1つ残っている(断られた変更の値のまま)。画面の下の知らせにも同じ文が出る
    const kept = await keptRows(page);
    assert.equal(kept.length, 1, `${label}: 保存一覧に残っていない: ${JSON.stringify(kept)}`);
    assert.equal(kept[0].thick, serverThick + 30, `${label}: 一覧に残したプランが断られた変更の値でない`);
    const n = await notice(page);
    assert.ok(!n.hidden && n.text === s.status && !n.action, `${label}: 画面の知らせが違う: ${JSON.stringify(n)}`);
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

  // ── 応答待ちの間の編集も一覧に残る。5 分以内に続けて断られたら、同じ項目を上書きする ──
  {
    const { context, page, st } = await openRoom('keep', 400);
    // 送ってから応答が返るまでの間に、別の壁も変える(応答を遅らせる)
    await page.unroute('**/api/rooms/' + ROOM + '/update');
    await page.route('**/api/rooms/' + ROOM + '/update', async (route) => {
      st.updates++;
      await sleep(800);
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_patch"}' });
    });
    const otherThick = BASE.walls[1].thick;
    await editWall(page, serverThick + 30);
    await sleep(900); // 送信が始まるのを待つ(markDirty の 700ms 後)
    await page.evaluate((t) => { DATA.walls[1].thick = t; }, otherThick + 15);
    await sleep(3000);
    let kept = await keptRows(page);
    assert.equal(kept.length, 1, '1回目: 一覧に1つ残る');
    assert.equal(kept[0].thick, serverThick + 30);
    assert.equal(kept[0].extra, otherThick + 15, '応答待ちの間の編集が一覧に残っていない');
    const s = await state(page);
    assert.equal(s.thick, serverThick, '部屋の状態に戻っていない');
    // 続けてもう一度断られる → 同じ項目を上書き(一覧は増えない。中身は新しいほう)
    await editWall(page, serverThick + 45);
    await sleep(3500);
    kept = await keptRows(page);
    assert.equal(kept.length, 1, `続けて断られたのに一覧が増えた: ${kept.length}`);
    assert.equal(kept[0].thick, serverThick + 45, '上書きした中身が新しいほうでない');
    // 5 分を過ぎたあとなら、別の項目として足す
    await page.evaluate(() => { SHARED.rejectKeep.at -= 6 * 60 * 1000; });
    await editWall(page, serverThick + 50);
    await sleep(3500);
    kept = await keptRows(page);
    assert.equal(kept.length, 2, `5 分を過ぎたのに上書きした: ${kept.length}`);
    console.log('ok  応答待ちの間の編集も一覧に残り、5 分以内の繰り返しは上書き、過ぎたら別の項目にした');
    await context.close();
  }

  // ── 10MB を超えるプランで 413: 一覧に残せる ──
  {
    const { context, page, st } = await openRoom('big', 413);
    await page.evaluate(() => { DATA.items[0].__big = 'data:image/png;base64,' + 'A'.repeat(11 * 1024 * 1024); });
    await editWall(page, serverThick + 30);
    await sleep(6000);
    const kept = await keptRows(page);
    assert.equal(kept.length, 1, '10MB を超えるプランが一覧に残っていない');
    assert.ok(kept[0].big > 11 * 1024 * 1024, '一覧に残したプランに大きな中身が無い');
    const s = await state(page);
    assert.ok(/保存一覧」に残しました/.test(s.status), s.status);
    console.log(`ok  10MB を超えるプラン(${(kept[0].big / 1048576).toFixed(1)}MB の画像)も一覧に残した`);
    await context.close();
  }

  // ── 一覧に残せなかったとき: 知らせで分かり、「ファイルに保存」で書き出せる。幅 375 の写真 ──
  for (const fail of [false, true]) {
    const { context, page } = await openRoom(fail ? 'keep-fail' : 'keep-375', 400, 375);
    if (fail) await page.evaluate(() => { PlanLibrary.putSnapshot = () => Promise.reject(new Error('QuotaExceededError')); });
    await editWall(page, serverThick + 30);
    await sleep(4000);
    const n = await notice(page);
    assert.ok(!n.hidden, '知らせが出ていない');
    if (fail) {
      assert.ok(/残せませんでした/.test(n.text) && n.action === 'ファイルに保存', `残せなかったことが分からない: ${JSON.stringify(n)}`);
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#plan-notice-action')]);
      assert.match(download.suggestedFilename(), /^共同編集に反映できなかった変更_\d{8}_\d{4}\.json$/);
      const body = JSON.parse(readFileSync(await download.path(), 'utf8'));
      assert.equal(body.walls[0].thick, serverThick + 30, '書き出した中身が戻す前のプランでない');
    } else {
      assert.ok(/保存一覧」に残しました/.test(n.text) && !n.action, JSON.stringify(n));
    }
    // 知らせが画面の中に収まり、下の操作の段と重ならない
    const box = await page.evaluate(() => {
      const r = document.getElementById('plan-notice').getBoundingClientRect();
      const nav = document.getElementById('bottom-nav'); const nr = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
      const f = document.getElementById('chat-fab'); const fr = f && getComputedStyle(f).display !== 'none' ? f.getBoundingClientRect() : null;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, navTop: nr ? nr.top : null, fab: fr ? { left: fr.left, right: fr.right, top: fr.top, bottom: fr.bottom } : null };
    });
    assert.ok(box.left >= 0 && box.right <= box.vw, `知らせが画面からはみ出す: ${JSON.stringify(box)}`);
    if (box.navTop !== null) assert.ok(box.bottom <= box.navTop, `知らせが下の操作の段に重なる: ${JSON.stringify(box)}`);
    if (box.fab) assert.ok(box.right <= box.fab.left || box.bottom <= box.fab.top || box.top >= box.fab.bottom, `知らせが「AIに頼む」のボタンを隠す: ${JSON.stringify(box)}`);
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, fail ? 'reject-notice-file-375.png' : 'reject-notice-375.png') });
    console.log(`ok  ${fail ? '一覧に残せなかったときは「ファイルに保存」を出し、押すと戻す前のプランを書き出した' : '幅 375 で知らせが画面に収まる'}`);
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
    assert.equal((await keptRows(page)).length, 0, `${label}: 取り直さないのに一覧へ写した`);
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
