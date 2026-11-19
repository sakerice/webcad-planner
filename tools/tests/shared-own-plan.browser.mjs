// 共有の部屋に入っても、自分の「前回のプラン」が置き換わらないこと。
//
// なぜ要るか: 以前は、最後に開いていたプランをブラウザの1つの枠(webcad-plan-v1)に置き、共有リンクから部屋に入ると
// 同じ枠へ部屋のプランを書いていた。自宅のプランを作りかけのまま知人の共有リンクを開くと、次に普通に開いたとき
// 知人のプランが出て、自宅のプランが戻せなかった。今は部屋のプランを部屋ごとの枠(webcad-room-<id>)に置き、
// 部屋にいる間は自分の枠を書かない。
//
// 場面:
//   1. 自宅のプランを開いて「保存」→ 知人の共有リンクを開いて編集(自動保存・部屋の保存の知らせ・「保存」ボタン)
//      → 共有リンクなしで開き直すと、自宅のプランが出る。共有リンクで開けば部屋が開く
//   2. 保存一覧に「共同編集: …」が並び、「開く」でその部屋に入り直せる
//   3. 部屋が期限切れなら、共有のダイアログに「写しを開く」を出し、押すと共同編集なしで開く
//   4. 共同編集を終えて「保存」を押すと、前回のプランが置き換わる前に確かめる(いいえなら置き換わらない)
//   5. 自分で部屋を作った側も、部屋にいる間は前回のプランの枠を書かない(部屋の枠には入る)
//   6. 部屋の枠は新しい 5 つだけ残り、古いものは消える
//
// サーバーは使わない。部屋の GET・/update・/save・作成と WebSocket を偽物にする。
//
// sh tools/run_browser_tests.sh shared-own-plan
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const OWN_FILE = join(HERE, 'fixtures', 'compat', 'saved-2f.json');
const ROOM_PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const ROOM = 'FriendsRoomForOwnPlan1';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];

// 1つのブラウザ(IndexedDB を共有する)。dialogs は出た確認の文、answer は次の確認への答え(既定ははい)。
async function openBrowser() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const st = { roomStatus: 200, gets: 0, updates: 0, saves: 0, creates: 0, dialogs: [], answer: true };
  await context.addInitScript(() => {
    class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() { this.readyState = 3; } }
    window.WebSocket = FakeWS;
  });
  await context.route(/\/api\/rooms\/[A-Za-z0-9_-]{22}$/, (route) => {
    st.gets++;
    if (st.roomStatus !== 200) return route.fulfill({ status: st.roomStatus, contentType: 'application/json', body: '{"error":"expired"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: JSON.stringify(ROOM_PLAN) });
  });
  await context.route(/\/api\/rooms\/[A-Za-z0-9_-]{22}\/update$/, (route) => { st.updates++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1 + st.updates, expiresAt: Date.now() + 1e9 }) }); });
  await context.route(/\/api\/rooms\/[A-Za-z0-9_-]{22}\/save$/, (route) => { st.saves++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 50 + st.saves, expiresAt: Date.now() + 1e9, savedAt: Date.now() }) }); });
  await context.route(/\/api\/rooms$/, (route) => {
    st.creates++;
    const id = 'MyOwnCreatedRoom000000';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roomId: id, url: new URL(APP).origin + '/#room=' + id, version: 1, expiresAt: Date.now() + 1e9, savedAt: Date.now() }) });
  });
  context.on('page', (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => { st.dialogs.push(d.message()); (st.answer ? d.accept() : d.dismiss()).catch(() => {}); });
  });
  return { context, st };
}

// プランの見分け(壁の数と最初の壁の座標)
const sigOf = (p) => JSON.stringify([p.walls.length, p.walls[0].x1, p.walls[0].y1, p.walls[0].x2, p.walls[0].y2]);
const ROOM_SIG = sigOf(ROOM_PLAN);
const idb = (page, key) => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open('webcad', 1);
  req.onsuccess = () => { const g = req.result.transaction('plans', 'readonly').objectStore('plans').get(key); g.onsuccess = () => { req.result.close(); resolve(g.result ? JSON.parse(g.result) : null); }; g.onerror = () => resolve(null); };
  req.onerror = () => resolve(null);
}), key);
const ready = (page) => page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
const screenSig = (page) => page.evaluate(() => JSON.stringify([DATA.walls.length, DATA.walls[0].x1, DATA.walls[0].y1, DATA.walls[0].x2, DATA.walls[0].y2]));

try {
  const { context, st } = await openBrowser();

  // ── 1. 自宅のプランを保存 → 知人の共有リンクで編集 → 普通に開き直すと自宅のプラン ──
  let page = await context.newPage();
  await page.goto(APP + '?preset=blank');
  await ready(page);
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', OWN_FILE);
  await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
  const ownSig = await screenSig(page);
  assert.notEqual(ownSig, ROOM_SIG, '自宅と知人のプランが見分けられない');
  await page.evaluate(() => savePlanToStorage());
  assert.equal(sigOf(await idb(page, 'webcad-plan-v1')), ownSig, '自宅のプランが保存されていない');
  await page.close();

  page = await context.newPage();
  await page.goto(APP + '#room=' + ROOM);
  await page.waitForFunction(() => window.SHARED && SHARED.roomId && window.__ws, null, T);
  assert.equal(await screenSig(page), ROOM_SIG, '共有リンクで部屋が開かない');
  // 編集して、自動保存・部屋の保存の知らせ・「保存」ボタンを全部通す
  await page.evaluate(() => { DATA.walls[0].thick = 155; sharedMarkIdsDirty([DATA.walls[0].id]); markDirty(); });
  await sleep(1500);
  await page.evaluate(async () => {
    await sharedAutoSaveLocal();
    window.__ws.onmessage({ data: JSON.stringify({ type: 'checkpoint', version: SHARED.version, savedAt: Date.now(), expiresAt: Date.now() + 1e9 }) });
    await new Promise((r) => setTimeout(r, 300));
    await savePlanToStorage();
  });
  assert.ok(st.saves >= 1, '部屋の「保存」がクラウドへ送られていない');
  assert.equal(sigOf(await idb(page, 'webcad-plan-v1')), ownSig, '部屋にいる間に、自宅のプランの枠が書き換わった');
  const roomCopy = await idb(page, 'webcad-room-' + ROOM);
  assert.ok(roomCopy && sigOf(roomCopy) === ROOM_SIG && roomCopy.walls[0].thick === 155, '部屋のプランが部屋の枠に入っていない');
  await page.close();

  page = await context.newPage();
  st.dialogs.length = 0;
  await page.goto(APP);
  await ready(page);
  await page.waitForFunction((sig) => JSON.stringify([DATA.walls.length, DATA.walls[0].x1, DATA.walls[0].y1, DATA.walls[0].x2, DATA.walls[0].y2]) === sig, ownSig, T);
  assert.ok(st.dialogs.some((d) => /前回保存したプランがあります/.test(d)), '前回のプランを開く確認が出ていない');
  assert.equal(await page.evaluate(() => SHARED.roomId), null);
  console.log('ok  自宅のプラン → 知人の共有リンクで編集・保存 → 普通に開き直すと自宅のプランが出た');

  // ── 2. 保存一覧に「共同編集」が並び、「開く」で部屋に入り直せる ──
  await page.evaluate(() => PlanLibrary.openList());
  await page.waitForSelector('.plan-library-row', T);
  const rowNames = await page.$$eval('.plan-library-name', (els) => els.map((e) => e.textContent));
  assert.ok(rowNames.includes('前回のプラン'), JSON.stringify(rowNames));
  const roomRow = rowNames.findIndex((n) => n.startsWith('共同編集: '));
  assert.ok(roomRow >= 0, '保存一覧に共同編集が無い: ' + JSON.stringify(rowNames));
  await page.locator('.plan-library-row').nth(roomRow).locator('button', { hasText: '開く' }).click();
  await page.waitForFunction((id) => SHARED.roomId === id, ROOM, T);
  assert.equal(await screenSig(page), ROOM_SIG);
  assert.ok((await page.evaluate(() => location.hash)).includes('room=' + ROOM), '開いた部屋が URL に入っていない');
  // 共有リンクで開き直しても部屋が開く(今までの再接続の挙動)
  await page.reload();
  await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id, ROOM, T);
  console.log('ok  保存一覧の「共同編集」から部屋に入り直せた。共有リンクで開き直しても部屋が開く');

  // ── 4. 共同編集を終えて「保存」→ 前回のプランが置き換わる前に確かめる ──
  st.dialogs.length = 0;
  await page.evaluate(() => leaveSharedRoom());
  await page.waitForFunction(() => !SHARED.roomId, null, T);
  assert.match(await page.evaluate(() => document.getElementById('share-status').textContent), /「保存一覧」の「共同編集」からまた開けます/);
  st.answer = false;
  await page.evaluate(() => savePlanToStorage());
  st.answer = true;
  assert.ok(st.dialogs.some((d) => /共同編集で開いたプランです。保存すると、このブラウザの「前回のプラン」が/.test(d)), '前回のプランが置き換わる前に確かめていない: ' + JSON.stringify(st.dialogs));
  assert.equal(sigOf(await idb(page, 'webcad-plan-v1')), ownSig, '「いいえ」なのに前回のプランが置き換わった');
  console.log('ok  共同編集を終えたあとの「保存」は、前回のプランを置き換える前に確かめ、いいえなら置き換えない');
  await page.close();

  // ── 3. 部屋が期限切れなら、写しを開けると知らせる ──
  st.roomStatus = 410;
  page = await context.newPage();
  await page.goto(APP + '#room=' + ROOM);
  await page.waitForFunction(() => { const b = document.getElementById('share-copy-btn'); return b && getComputedStyle(b).display !== 'none' && /写しを、共同編集なしで開けます/.test(document.getElementById('share-status').textContent); }, null, T);
  const copyNow = await idb(page, 'webcad-room-' + ROOM);
  await page.evaluate(() => { DATA.walls[0].__mark = 1; });
  await page.click('#share-copy-btn');
  await page.waitForFunction(() => DATA.walls[0] && !DATA.walls[0].__mark, null, T);
  assert.equal(await page.evaluate(() => JSON.stringify(DATA.walls.map((w) => [w.id, w.thick]))), JSON.stringify(copyNow.walls.map((w) => [w.id, w.thick])), '開いたのが部屋の写しでない');
  assert.equal(await page.evaluate(() => SHARED.roomId), null, '写しを開いたのに部屋につながっている');
  assert.ok(!(await page.evaluate(() => location.hash)).includes('room='), 'URL に部屋が残っている');
  st.roomStatus = 200;
  console.log('ok  期限切れの部屋は、このブラウザの写しを共同編集なしで開けた');
  await page.close();

  // ── 5. 自分で部屋を作った側も、部屋にいる間は前回のプランの枠を書かない ──
  page = await context.newPage();
  await page.goto(APP);
  await ready(page);
  await page.waitForFunction((sig) => JSON.stringify([DATA.walls.length, DATA.walls[0].x1, DATA.walls[0].y1, DATA.walls[0].x2, DATA.walls[0].y2]) === sig, ownSig, T);
  await page.evaluate(() => createSharedRoom());
  await page.waitForFunction(() => SHARED.roomId === 'MyOwnCreatedRoom000000', null, T);
  await page.evaluate(async () => { DATA.walls[0].thick = 177; sharedMarkIdsDirty([DATA.walls[0].id]); markDirty(); await sharedAutoSaveLocal(); });
  const own = await idb(page, 'webcad-plan-v1');
  assert.equal(sigOf(own), ownSig);
  assert.notEqual(own.walls[0].thick, 177, '自分で作った部屋の編集が前回のプランの枠に入った');
  assert.equal((await idb(page, 'webcad-room-MyOwnCreatedRoom000000')).walls[0].thick, 177, '自分で作った部屋のプランが部屋の枠に入っていない');
  console.log('ok  自分で部屋を作った側も、共有中の編集は部屋の枠に入り、前回のプランの枠は共有前のまま');

  // ── 6. 部屋の枠は新しい 5 つだけ残る ──
  const kept = await page.evaluate(async () => {
    for (let i = 0; i < 7; i++) { await StorageAdapter.saveRoom(('PruneRoom' + i + 'xxxxxxxxxxxxxxxxxx').slice(0, 22), { walls: [], items: [], rooms: [], planName: 'p' + i }); await new Promise((r) => setTimeout(r, 5)); }
    const list = await StorageAdapter.listRooms();
    const gone = await StorageAdapter.loadRoom(('PruneRoom0' + 'xxxxxxxxxxxxxxxxxx').slice(0, 22));
    return { ids: list.map((r) => r.roomId), gone };
  });
  assert.equal(kept.ids.length, 5, JSON.stringify(kept.ids));
  assert.ok(kept.ids[0].startsWith('PruneRoom6'), '新しい順に並んでいない');
  assert.equal(kept.gone, null, '古い部屋の枠が消えていない');
  assert.equal(sigOf(await idb(page, 'webcad-plan-v1')), ownSig, '部屋の枠を消すときに前回のプランが消えた');
  console.log('ok  部屋の枠は新しい 5 つだけ残り、前回のプランの枠には触れない');

  await context.close();
  assert.deepEqual(errors, [], 'ページの例外:\n' + errors.join('\n'));
} finally {
  await browser.close();
}
console.log('共有の部屋に入っても、自分の前回のプランは置き換わらない');
