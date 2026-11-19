// 外部 AI(ChatGPT など、MCP の受け口 /api/mcp 経由)の変更を、画面の「元に戻す」で戻せて、共有のダイアログで止められること。
//
// なぜ要るか: 外部 AI は部屋の /op でプランを直し、変更はほかの人の編集と同じ知らせ(type "patch")で画面に届く。
// 以前は「元に戻す」に入らず(相手の変更を受けると取り消しの履歴が消える)、戻す手段も止める手段も無かった。
// 今は部屋が外部 AI の変更に source:"ai" の印を付けて配り(worker/collab-room.mjs)、画面は当てる直前の状態を
// 取り消しの履歴に積む。続けて届く AI の変更は、2 分空くか、自分やほかの人の編集が挟まるまで1つにまとめる。
//
// 場面:
//   1. 自分の編集 → AI の変更が2つ続けて届く → 「元に戻す」1回で AI が直す前に戻り、戻した結果が部屋へ送られる。
//      もう1回で自分の編集も戻る(AI の変更を受けても、自分の取り消しの履歴は消えない)
//   2. AI の変更のあと 2 分空いて届いた変更は、別の「元に戻す」になる
//   3. AI の変更のあとにほかの人の変更が届くと、今までどおり履歴は消える(ほかの人の変更を巻き戻さない)
//   4. 印の無い変更(ほかの人・古い部屋)は今までどおり
//   5. 画面の知らせ「外部の AI が編集中です」と「元に戻す」「止める」。「止める」で部屋へ止める知らせを送る。
//      知らせは 60 秒で消える
//   6. 共有のダイアログのスイッチ: 既定は入。切ると部屋へ送り、ほかの人が切り替えた知らせ・入室時の状態が映る。
//      切り替えに失敗したら元に戻して知らせる
//   7. 幅 375 で、知らせ・ダイアログのスイッチが画面に収まり、操作の段や画面の下の知らせと重ならない(写真は UI_SHOT_DIR)
//
// サーバーは使わない。部屋の GET・/update・/ai-edits と WebSocket を偽物にし、届く知らせはテストから流す。
//
// sh tools/run_browser_tests.sh shared-ai-undo
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const T = { timeout: 60000 };
const BASE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const ROOM = 'SharedAiUndoTestRoom01';
const SHOT_DIR = process.env.UI_SHOT_DIR || '';
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const errors = [];

async function openRoom(label, { width = 1280, welcomeOff = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 812 : 900 } });
  const page = await context.newPage();
  const st = { updates: [], toggles: [], toggleStatus: 200, version: 1 };
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.addInitScript((welcomeOff) => {
    class FakeWS {
      constructor() {
        this.readyState = 1; window.__ws = this;
        setTimeout(() => { this.onopen && this.onopen(); this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'welcome', version: 1, expiresAt: Date.now() + 1e9, savedAt: Date.now(), checkpointPending: false, aiEditsOff: welcomeOff }) }); }, 0);
      }
      send() {} close() { this.readyState = 3; }
    }
    window.WebSocket = FakeWS;
  }, welcomeOff);
  await page.route('**/api/rooms/' + ROOM, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-room-version': '1', 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': String(Date.now()) }, body: JSON.stringify(BASE) }));
  await page.route('**/api/rooms/' + ROOM + '/update', (route) => {
    const body = JSON.parse(route.request().postData());
    st.updates.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 100 + st.updates.length, expiresAt: Date.now() + 1e9 }) });
  });
  await page.route('**/api/rooms/' + ROOM + '/ai-edits', (route) => {
    const body = JSON.parse(route.request().postData());
    st.toggles.push(body);
    if (st.toggleStatus !== 200) return route.fulfill({ status: st.toggleStatus, contentType: 'application/json', body: '{"error":"x"}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ aiEditsOff: body.off }) });
  });
  await page.goto(APP + '#room=' + ROOM);
  await page.waitForFunction(() => window.SHARED && SHARED.roomId && window.__ws && DATA.walls.length > 10, null, T);
  await page.waitForTimeout(300);
  return { context, page, st };
}

// 部屋から知らせを流す(版を進める)
const deliver = (page, msg) => page.evaluate((msg) => {
  msg.version = SHARED.version + 1; msg.expiresAt = Date.now() + 1e9;
  window.__ws.onmessage({ data: JSON.stringify(msg) });
}, msg);
const wallPatch = (id, thick) => ({ collections: { walls: { upserts: [{ ...BASE.walls.find((w) => String(w.id) === String(id)), thick }], removes: [] } }, fields: {} });
const aiPatch = (page, id, thick) => deliver(page, { type: 'patch', clientId: 'mcp', source: 'ai', patch: wallPatch(id, thick) });
const humanPatch = (page, id, thick, extra = {}) => deliver(page, { type: 'patch', clientId: 'someone-else-000000000000', patch: wallPatch(id, thick), ...extra });
const thicks = (page) => page.evaluate(() => DATA.walls.slice(0, 3).map((w) => w.thick));
const hist = (page) => page.evaluate(() => ({ undo: HISTORY.length, redo: REDO_HISTORY.length }));
const bar = (page) => page.evaluate(() => {
  const el = document.getElementById('ai-edit-bar');
  const vis = !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  return { vis, text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '' };
});
// 自分の編集(壁の厚みを変える)。画面の操作と同じく saveState を通す
const ownEdit = (page, i, thick) => page.evaluate(({ i, thick }) => { saveState(); DATA.walls[i].thick = thick; sharedMarkIdsDirty([DATA.walls[i].id]); markDirty(); }, { i, thick });

const W = BASE.walls.slice(0, 3).map((w) => w.id);
const T0 = BASE.walls.slice(0, 3).map((w) => w.thick);

try {
  // ── 1. 自分の編集 → AI の変更2つ → 「元に戻す」1回で AI の前、もう1回で自分の編集の前 ──
  {
    const { context, page, st } = await openRoom('undo');
    await ownEdit(page, 0, T0[0] + 10);
    await sleep(1200); // 自分の変更を送り終える
    assert.equal((await hist(page)).undo, 1);
    await aiPatch(page, W[1], T0[1] + 40);
    await sleep(150);
    await aiPatch(page, W[2], T0[2] + 50);
    await sleep(150);
    assert.deepEqual(await thicks(page), [T0[0] + 10, T0[1] + 40, T0[2] + 50]);
    assert.equal((await hist(page)).undo, 2, '続けて届いた AI の変更が1つの「元に戻す」にまとまっていない');
    const b = await bar(page);
    assert.ok(b.vis && /外部の AI が編集中です/.test(b.text) && /元に戻す/.test(b.text) && /止める/.test(b.text), `知らせが出ていない: ${JSON.stringify(b)}`);
    const sent0 = st.updates.length;
    await page.evaluate(() => undoAction());
    assert.deepEqual(await thicks(page), [T0[0] + 10, T0[1], T0[2]], '「元に戻す」で AI が直す前に戻らない');
    await sleep(1500);
    // 戻した結果は、ふつうの編集と同じ道で部屋へ送られる(AI の印は付けない)
    const sent = st.updates.slice(sent0);
    assert.equal(sent.length, 1, `戻した結果が送られていない(${sent.length})`);
    const ups = sent[0].patch.collections.walls.upserts;
    assert.deepEqual(ups.map((w) => [String(w.id), w.thick]).sort(), [[String(W[1]), T0[1]], [String(W[2]), T0[2]]].sort());
    assert.equal(sent[0].source, undefined);
    // もう1回で自分の編集も戻る
    await page.evaluate(() => undoAction());
    assert.deepEqual(await thicks(page), T0, '自分の取り消しの履歴が消えていた');
    // やり直しで AI の変更をもう一度当てられる
    await page.evaluate(() => { redoAction(); redoAction(); });
    assert.deepEqual(await thicks(page), [T0[0] + 10, T0[1] + 40, T0[2] + 50]);
    console.log('ok  AI の変更2つを「元に戻す」1回で戻し、結果を部屋へ送った。自分の編集の履歴も残った');

    // ── 2. 2 分空いたら別の「元に戻す」 ──
    await page.evaluate(() => { clearEditHistory(); });
    await aiPatch(page, W[1], T0[1] + 60);
    await page.evaluate(() => { SHARED.aiGroup.lastAt -= 2 * 60 * 1000 + 1000; });
    await aiPatch(page, W[2], T0[2] + 70);
    assert.equal((await hist(page)).undo, 2, '2 分空いたのにまとめた');
    await page.evaluate(() => undoAction());
    assert.deepEqual((await thicks(page)).slice(1), [T0[1] + 60, T0[2] + 50]);
    console.log('ok  2 分空いて届いた AI の変更は別の「元に戻す」になった');

    // 自分の編集が挟まると、そのあとの AI の変更は別の「元に戻す」
    await page.evaluate(() => { clearEditHistory(); });
    await aiPatch(page, W[1], T0[1] + 61);
    await ownEdit(page, 0, T0[0] + 11);
    await aiPatch(page, W[2], T0[2] + 71);
    assert.equal((await hist(page)).undo, 3, '自分の編集を挟んだ AI の変更をまとめた');
    await sleep(1200);

    // ── 3. AI の変更のあとにほかの人の変更 → 今までどおり履歴は消える(ほかの人の変更を巻き戻さない) ──
    await aiPatch(page, W[1], T0[1] + 80);
    await humanPatch(page, W[0], T0[0] + 90);
    assert.deepEqual(await hist(page), { undo: 0, redo: 0 }, 'ほかの人の変更を受けても履歴が残っている');
    await page.evaluate(() => undoAction());
    assert.equal((await thicks(page))[0], T0[0] + 90, 'ほかの人の変更が巻き戻った');
    console.log('ok  AI の変更のあとにほかの人の変更が届くと、今までどおり履歴が消え、ほかの人の変更は戻らない');

    // ── 4. 印の無い変更は今までどおり(source を名乗る形でない値も無視) ──
    await ownEdit(page, 0, T0[0] + 5);
    await humanPatch(page, W[1], T0[1] + 3, { source: 'AI' });
    assert.deepEqual(await hist(page), { undo: 0, redo: 0 });
    console.log('ok  印の無い変更は今までどおり履歴を消す');
    await context.close();
  }

  // ── 5. 知らせの「止める」、60 秒で消える ──
  {
    const { context, page, st } = await openRoom('bar');
    await aiPatch(page, W[1], T0[1] + 40);
    await page.click('#ai-edit-stop');
    await page.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
    assert.deepEqual(st.toggles.map((t) => t.off), [true]);
    const b = await bar(page);
    assert.ok(/止めました/.test(b.text), `止めたことが知らせに出ない: ${JSON.stringify(b)}`);
    // 届いてから 60 秒で消える
    await page.evaluate(() => { SHARED.aiGroup.lastAt -= 61000; SHARED.aiBarUntil = Date.now() - 1; sharedRenderAiBar(); });
    assert.equal((await bar(page)).vis, false, '60 秒たっても知らせが残る');
    // 知らせの「元に戻す」で戻る
    await page.evaluate(() => { SHARED.aiEditsOff = false; });
    await aiPatch(page, W[2], T0[2] + 30);
    await page.click('#ai-edit-undo');
    assert.equal((await thicks(page))[2], T0[2], '知らせの「元に戻す」で戻らない');
    console.log('ok  知らせの「止める」で部屋へ止める知らせを送り、「元に戻す」で戻り、60 秒で消えた');
    await context.close();
  }

  // ── 6. 共有のダイアログのスイッチ ──
  {
    const { context, page, st } = await openRoom('switch');
    await page.evaluate(() => openShareDialog());
    const sw = () => page.evaluate(() => { const c = document.getElementById('share-ai-allow'); const row = document.getElementById('share-ai-allow-row'); return { checked: c.checked, vis: getComputedStyle(row).display !== 'none' }; });
    assert.deepEqual(await sw(), { checked: true, vis: true }, '既定は「受け付ける」');
    await page.click('#share-ai-allow');
    await page.waitForFunction(() => SHARED.aiEditsOff === true && /止めました/.test(document.getElementById('share-ai-status').textContent), null, T);
    assert.deepEqual(st.toggles, [{ off: true, clientId: await page.evaluate(() => sharedClientId()) }]);
    assert.equal((await sw()).checked, false);
    // ほかの人が戻した知らせが映る
    await page.evaluate(() => window.__ws.onmessage({ data: JSON.stringify({ type: 'ai-edits', off: false, clientId: 'x' }) }));
    assert.equal((await sw()).checked, true);
    // 失敗したら元に戻して知らせる
    st.toggleStatus = 500;
    await page.click('#share-ai-allow');
    await page.waitForFunction(() => /切り替えられませんでした/.test(document.getElementById('share-ai-status').textContent), null, T);
    const afterFail = await page.evaluate(() => ({ c: document.getElementById('share-ai-allow').checked, off: SHARED.aiEditsOff, st: document.getElementById('share-ai-status').textContent }));
    assert.equal(afterFail.c, true, '失敗したのに切ったままになった ' + JSON.stringify(afterFail) + JSON.stringify(st.toggles));
    assert.equal(await page.evaluate(() => SHARED.aiEditsOff), false);
    console.log('ok  スイッチは既定で入り、切ると部屋へ送り、ほかの人の切り替えが映り、失敗したら元に戻した');
    await context.close();
    // 入室時に止まっていれば、切れた状態で映る
    const r2 = await openRoom('welcome-off', { welcomeOff: true });
    await r2.page.evaluate(() => openShareDialog());
    assert.equal(await r2.page.evaluate(() => document.getElementById('share-ai-allow').checked), false, '入室時の状態が映らない');
    await r2.context.close();
  }

  // ── 7. 幅 375: 知らせとスイッチが画面に収まり、重ならない ──
  {
    const { context, page } = await openRoom('375', { width: 375 });
    const overlap = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const rects = () => page.evaluate(() => {
      const r = (id) => { const el = document.getElementById(id); if (!el || el.hidden || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      return { bar: r('ai-edit-bar'), notice: r('plan-notice'), nav: r('bottom-nav'), fab: r('chat-fab'), vw: innerWidth, vh: innerHeight };
    });
    await aiPatch(page, W[1], T0[1] + 40);
    let r = await rects();
    assert.ok(r.bar && r.bar.left >= 0 && r.bar.right <= r.vw && r.bar.bottom <= r.vh, `知らせが画面からはみ出す: ${JSON.stringify(r)}`);
    assert.ok(!overlap(r.bar, r.nav), `知らせが下の操作の段に重なる: ${JSON.stringify(r)}`);
    assert.ok(r.fab && !overlap(r.bar, r.fab), `知らせが「AIに頼む」のボタンを隠す: ${JSON.stringify(r)}`);
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'ai-edit-bar-375.png') });
    // 画面の下の知らせ(プランを開いたとき・断られたとき)が同時に出ても重ならない
    await page.evaluate(() => showPlanNotice('開けない部分が 1 個あったため、その部分を除いて開きました。'));
    r = await rects();
    assert.ok(r.notice && !overlap(r.bar, r.notice), `二つの知らせが重なる: ${JSON.stringify(r)}`);
    assert.ok(!overlap(r.notice, r.fab), `画面の下の知らせが「AIに頼む」のボタンを隠す: ${JSON.stringify(r)}`);
    assert.ok(r.notice.top >= 0, '知らせが画面の上にはみ出す');
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'ai-edit-bar-with-notice-375.png') });
    await page.evaluate(() => hidePlanNotice());
    await page.click('#ai-edit-stop');
    await page.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
    if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'ai-edit-bar-stopped-375.png') });
    // 共有のダイアログのスイッチ(切・入)
    for (const on of [false, true]) {
      if (on) await page.evaluate(() => window.__ws.onmessage({ data: JSON.stringify({ type: 'ai-edits', off: false, clientId: 'x' }) }));
      await page.evaluate(() => openShareDialog());
      await page.evaluate(() => document.getElementById('share-ai-allow-row').scrollIntoView({ block: 'center' }));
      const row = await page.evaluate(() => { const b = document.getElementById('share-ai-allow-row').getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, vw: innerWidth }; });
      assert.ok(row.left >= 0 && row.right <= row.vw, `スイッチが画面からはみ出す: ${JSON.stringify(row)}`);
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, on ? 'share-ai-switch-on-375.png' : 'share-ai-switch-off-375.png') });
      await page.evaluate(() => closeShareDialog());
    }
    console.log('ok  幅 375 で知らせとスイッチが画面に収まり、操作の段・画面の下の知らせと重ならない');
    await context.close();
  }

  assert.deepEqual(errors, [], 'ページの例外:\n' + errors.join('\n'));
} finally {
  await browser.close();
}
console.log('外部 AI の変更は「元に戻す」で戻せて、共有のダイアログで止められる');
