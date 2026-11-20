// 共同編集の守り(PR #130)を、本物のサーバーで通す。偽物への差し替えは使わない。
//
// サーバーは local-worker.mjs が立てる `wrangler dev --local`(部屋の Durable Object・WebSocket・/api/mcp が本物)。
// 画面はそのサーバーが配る dist/(build.sh で作る今の index.html)。APP_URL は使わない。
//
// 場面:
//   1. 保存場所: 自分のプランを保存 → そのプランで共同編集を始めて編集 → 終了。自分の「前回のプラン」は変わらない。
//      保存一覧に「共同編集: 名前」。共有リンクなしで開き直すと自分のプランと「前回は共同編集をしていました。」、
//      [共同編集を開く] でサーバーの最新(自分の編集の入った)部屋に戻る。
//      知人の部屋に共有リンクで入って編集 → 共有リンクで開き直す(部屋のまま)→ リンクなしで開く(自分のプラン)も同じ。
//   2. 反映できなかった変更: サーバーの検査(worker/room-guard.mjs)が 400 で断る変更(座標が範囲外の壁)と、
//      413 で断る変更(プランが保存の上限を超える)を画面から送る。手元のプランが保存一覧に
//      「共同編集に反映できなかった変更（日時）」で残り、知らせが出て、画面がサーバーの最新に戻る。サーバーは変わらない。
//   3. 外部 AI: 画面を2枚(別のブラウザ)開いたまま、/api/mcp から addRoom を送る。両方に部屋が増え、1枚めに
//      「外部の AI が編集中です」。[元に戻す] で AI の前に戻り、2枚めとサーバーにも届く。[止める] で以後の
//      MCP の書き込みが断られ、共有のダイアログのスイッチが2枚めにも切りで映る。2枚めでスイッチを入れ直すと
//      1枚めにも映り、MCP がまた書ける。
//   4. 画面の比率(aspect-check.mjs の SIZES): 起動時の知らせ・共有のダイアログのスイッチ・AI の知らせ・
//      反映できなかった知らせ(AI の知らせと重ねて出す)を、それぞれの大きさで本物のサーバーから出して、
//      画面に収まり、切れず、重ならず、押せる大きさか確かめる。写真は ASPECT_SHOT_DIR(無ければ output/test-shots/aspect)。
//
// sh tools/run_browser_tests.sh shared-real-server
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker, callMcp, roomPlan, createRoom } from './local-worker.mjs';
import { SIZES, checkLayout } from './aspect-check.mjs';
import { shotDir } from './shot-dir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWN_FILE = join(HERE, 'fixtures', 'compat', 'saved-2f.json');
const FRIEND_PLAN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'house-2f.json'), 'utf8'));
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.ASPECT_SHOT_DIR || shotDir('aspect');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // 例: ONLY=1,3 で場面を選ぶ
const want = (n) => !ONLY || ONLY.includes(String(n));
const REJECT_400 = 'この変更は共同編集に反映できなかったため、取り消して最新の状態に戻しました。戻す前のプランは「保存一覧」に残しました。';

const server = await startLocalWorker();
const APP = server.app;
const browser = await chromium.launch();
const errors = [];

async function openBrowser(label, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height } });
  const st = { dialogs: [], answer: true };
  context.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
    page.on('dialog', (d) => { st.dialogs.push(d.message()); (st.answer ? d.accept() : d.dismiss()).catch(() => {}); });
  });
  return { context, st };
}
const ready = (page) => page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
const idb = (page, key) => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open('webcad', 1);
  req.onsuccess = () => { const g = req.result.transaction('plans', 'readonly').objectStore('plans').get(key); g.onsuccess = () => { req.result.close(); resolve(g.result ? JSON.parse(g.result) : null); }; g.onerror = () => resolve(null); };
  req.onerror = () => resolve(null);
}), key);
const sigOf = (p) => JSON.stringify([p.walls.length, p.walls[0].x1, p.walls[0].y1, p.walls[0].x2, p.walls[0].y2]);
const screen = (page) => page.evaluate(() => ({ sig: JSON.stringify([DATA.walls.length, DATA.walls[0].x1, DATA.walls[0].y1, DATA.walls[0].x2, DATA.walls[0].y2]), thick: DATA.walls[0].thick, x1: DATA.walls[0].x1, rooms: DATA.rooms.length, roomId: SHARED.roomId }));
const notice = (page) => page.evaluate(() => ({
  hidden: document.getElementById('plan-notice').hidden,
  text: document.getElementById('plan-notice-text').textContent,
  action: document.getElementById('plan-notice-action').hidden ? '' : document.getElementById('plan-notice-action').textContent,
}));
// サーバーの部屋が条件を満たすまで待つ(本物の /update・/op が届いたか)
async function waitServer(roomId, test, what) {
  let last;
  for (let i = 0; i < 60; i++) {
    last = await roomPlan(server.origin, roomId);
    if (test(last.plan)) return last;
    await sleep(250);
  }
  throw new Error(`サーバーの部屋が ${what} にならない`);
}
// 自分のプランをファイルから開いて「保存」する(前回のプランの枠に入る)
async function saveOwnPlan(context, name) {
  const page = await context.newPage();
  await page.goto(APP + '?preset=blank');
  await ready(page);
  await page.evaluate(() => { window.__before = DATA; });
  await page.setInputFiles('#import-file', OWN_FILE);
  await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
  // 取り込んだプランの視点は幅の広い画面で撮った物(狭い画面では間取りが右の外に出る)。写真で間取りが見えるよう、全体を収める
  await page.evaluate((name) => { DATA.planName = name; resetView(); }, name);
  await page.evaluate(() => savePlanToStorage());
  const own = await screen(page);
  await page.close();
  return own;
}
// 利用者が欄を変えたのと同じく、変更の印を付けて送信を予約する
const editWall = (page, fields) => page.evaluate((fields) => {
  const w = DATA.walls[0];
  Object.assign(w, fields);
  sharedMarkIdsDirty([w.id]);
  markDirty();
}, fields);
const keptRows = (page) => page.evaluate(async () => {
  const rows = (await PlanLibrary.list()).filter((m) => /^共同編集に反映できなかった変更（\d+\/\d+ \d\d:\d\d）$/.test(m.name));
  const out = [];
  for (const m of rows) { const p = await PlanLibrary.get(m.id); out.push({ name: m.name, x1: p && p.walls[0].x1, thick: p && p.walls[0].thick, big: p && p.items[0] && typeof p.items[0].note === 'string' ? p.items[0].note.length : 0 }); }
  return out;
});
const libraryNames = async (page) => {
  await page.evaluate(() => PlanLibrary.openList());
  await page.waitForSelector('.plan-library-row', T);
  const names = await page.$$eval('.plan-library-name', (els) => els.map((e) => e.textContent));
  await page.evaluate(() => { const m = document.getElementById('plan-library-modal'); if (m) m.remove(); });
  return names;
};
const socketOpen = (page) => page.waitForFunction(() => SHARED.socket && SHARED.socket.readyState === 1, null, T);

let passed = 0;
try {
  // ── 1. 共同編集の保存場所 ──
  if (want(1)) {
    const { context, st } = await openBrowser('1');
    const own = await saveOwnPlan(context, '自宅の間取り');

    // (a) 自分のプランで共同編集を始める → 編集 → 終了
    let page = await context.newPage();
    await page.goto(APP);
    await ready(page);
    await page.waitForFunction((sig) => JSON.stringify([DATA.walls.length, DATA.walls[0].x1, DATA.walls[0].y1, DATA.walls[0].x2, DATA.walls[0].y2]) === sig, own.sig, T);
    await page.evaluate(() => openShareDialog());
    await page.click('#share-create-btn');
    await page.waitForFunction(() => SHARED.roomId, null, T);
    await socketOpen(page);
    const myRoom = await page.evaluate(() => SHARED.roomId);
    await editWall(page, { thick: own.thick + 40 });
    await waitServer(myRoom, (p) => p.walls[0].thick === own.thick + 40, '自分の編集の入った状態');
    await page.click('#share-leave-btn');
    await page.waitForFunction(() => !SHARED.roomId, null, T);
    assert.equal(await page.evaluate(() => document.getElementById('share-status').textContent), '共同編集を終了しました。このプランは「保存一覧」の「共同編集」からまた開けます。');
    const saved = await idb(page, 'webcad-plan-v1');
    assert.equal(sigOf(saved), own.sig, '前回のプランの枠が別のプランになった');
    assert.equal(saved.walls[0].thick, own.thick, '共同編集の編集が前回のプランの枠に入った');
    const names = await libraryNames(page);
    assert.ok(names.includes('共同編集: 自宅の間取り'), '保存一覧に共同編集の写しが無い: ' + JSON.stringify(names));
    await page.close();

    // 共有リンクなしで開き直す → 自分のプラン + 「前回は共同編集をしていました。」→ [共同編集を開く] で戻る
    st.dialogs.length = 0;
    page = await context.newPage();
    await page.goto(APP);
    await ready(page);
    await page.waitForFunction(() => !document.getElementById('plan-notice').hidden, null, T);
    let s = await screen(page);
    assert.deepEqual([s.sig, s.thick, s.roomId], [own.sig, own.thick, null], '開き直したら自分のプランでない');
    assert.deepEqual(await notice(page), { hidden: false, text: '前回は共同編集をしていました。', action: '共同編集を開く' });
    await page.click('#plan-notice-action');
    await page.waitForFunction((id) => SHARED.roomId === id, myRoom, T);
    await socketOpen(page);
    s = await screen(page);
    assert.equal(s.thick, own.thick + 40, '戻った部屋がサーバーの最新でない');
    assert.ok((await page.evaluate(() => location.hash)).includes('room=' + myRoom));
    await page.close();
    passed++; console.log('ok 1a 自分のプランで共同編集 → 終了 → 開き直すと自分のプラン、[共同編集を開く] で部屋に戻る');

    // (b) 知人の部屋に共有リンクで入って編集 → 共有リンクで開き直す → リンクなしで開く
    const friend = await createRoom(server.origin, FRIEND_PLAN);
    page = await context.newPage();
    await page.goto(APP + '#room=' + friend.roomId);
    await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id, friend.roomId, T);
    await socketOpen(page);
    const friendThick = (await screen(page)).thick;
    await editWall(page, { thick: friendThick + 20 });
    await waitServer(friend.roomId, (p) => p.walls[0].thick === friendThick + 20, '知人の部屋に編集が入った状態');
    await sleep(500);
    await page.reload();
    await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id && DATA.walls.length > 4, friend.roomId, T);
    assert.equal((await screen(page)).thick, friendThick + 20, '共有リンクで開き直したら部屋の最新でない');
    await page.evaluate(() => sharedAutoSaveLocal());
    await page.goto(APP);
    await ready(page);
    await page.waitForFunction(() => !document.getElementById('plan-notice').hidden, null, T);
    s = await screen(page);
    assert.deepEqual([s.sig, s.thick, s.roomId], [own.sig, own.thick, null], 'リンクなしで開いたら自分のプランでない');
    assert.equal(sigOf(await idb(page, 'webcad-plan-v1')), own.sig);
    assert.deepEqual(await notice(page), { hidden: false, text: '前回は共同編集をしていました。', action: '共同編集を開く' });
    await page.click('#plan-notice-action');
    await page.waitForFunction((id) => SHARED.roomId === id, friend.roomId, T);
    assert.equal((await screen(page)).thick, friendThick + 20);
    await page.close();
    await context.close();
    passed++; console.log('ok 1b 知人の部屋で編集 → 共有リンクで開き直すと部屋、リンクなしで開くと自分のプラン、知らせから部屋に戻る');
  }

  // ── 2. 反映できなかった変更 ──
  if (want(2)) {
    const { context } = await openBrowser('2');
    const room = await createRoom(server.origin, FRIEND_PLAN);
    const page = await context.newPage();
    await page.goto(APP + '#room=' + room.roomId);
    await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id && DATA.walls.length > 4, room.roomId, T);
    await socketOpen(page);
    const base = await screen(page);
    const v0 = (await roomPlan(server.origin, room.roomId)).version;

    // 400: 座標が範囲(±1e9 mm)の外の壁。サーバーの検査が断る
    await editWall(page, { x1: 2e9 });
    await page.waitForFunction(() => !document.getElementById('plan-notice').hidden && /反映できなかった/.test(document.getElementById('plan-notice-text').textContent), null, T);
    await page.waitForFunction((x) => DATA.walls[0].x1 === x, base.x1, T);
    let n = await notice(page);
    assert.equal(n.text, REJECT_400);
    let kept = await keptRows(page);
    assert.equal(kept.length, 1, '保存一覧に残っていない: ' + JSON.stringify(kept));
    assert.equal(kept[0].x1, 2e9, '一覧に残したプランが断られた変更の値でない');
    let server1 = await roomPlan(server.origin, room.roomId);
    assert.equal(server1.plan.walls[0].x1, base.x1, 'サーバーの部屋が変わった');
    assert.equal(server1.version, v0, 'サーバーの版が進んだ');
    passed++; console.log('ok 2a 400: 手元のプランが保存一覧に残り、知らせが出て、画面がサーバーの最新に戻った');

    // 413: 当てるとプランが保存の上限(10MB)を超える(大きな画像を貼ったのと同じ大きさの文字を2つの物に入れる)
    await page.evaluate(() => closePlanNotice());
    await page.evaluate(() => {
      const big = 'x'.repeat(6 * 1024 * 1024);
      DATA.items[0].note = big; DATA.items[1].note = big;
      sharedMarkIdsDirty([DATA.items[0].id, DATA.items[1].id]); markDirty();
    });
    await page.waitForFunction(() => !document.getElementById('plan-notice').hidden && /保存できる大きさ/.test(document.getElementById('plan-notice-text').textContent), null, T);
    await page.waitForFunction(() => typeof DATA.items[0].note !== 'string' || DATA.items[0].note.length < 1000, null, T);
    n = await notice(page);
    assert.ok(/最新の状態に戻しました。戻す前のプランは「保存一覧」に残しました。$/.test(n.text), n.text);
    kept = await keptRows(page);
    assert.equal(kept.length, 2, '413 の分が保存一覧に足されていない: ' + JSON.stringify(kept.map((k) => k.big)));
    assert.ok(kept.some((k) => k.big === 6 * 1024 * 1024), '一覧に残したプランに断られた変更が入っていない');
    server1 = await roomPlan(server.origin, room.roomId);
    assert.equal(server1.version, v0, '413 なのにサーバーの版が進んだ');
    // そのあとの正当な変更はふつうに届く
    await editWall(page, { thick: base.thick + 10 });
    await waitServer(room.roomId, (p) => p.walls[0].thick === base.thick + 10, '正当な変更が届いた状態');
    await context.close();
    passed++; console.log('ok 2b 413: 同じく保存一覧に残り、画面が戻り、そのあとの変更は届く');
  }

  // ── 3. 外部 AI の変更 ──
  if (want(3)) {
    const room = await createRoom(server.origin, FRIEND_PLAN);
    const A = await openBrowser('3A');
    const B = await openBrowser('3B', 1024, 768);
    const pa = await A.context.newPage();
    const pb = await B.context.newPage();
    for (const p of [pa, pb]) {
      await p.goto(APP + '#room=' + room.roomId);
      await p.waitForFunction((id) => window.SHARED && SHARED.roomId === id && DATA.walls.length > 4, room.roomId, T);
      await socketOpen(p);
    }
    const n0 = (await screen(pa)).rooms;
    const add = (name, x) => callMcp(server.origin, 'addRoom', { plan: room.url, x, y: 0, w: 2000, d: 2000, name });
    let r = await add('書斎', 20000);
    assert.equal(r.isError, false, 'MCP の addRoom が通らない: ' + r.text.slice(0, 300));
    for (const p of [pa, pb]) await p.waitForFunction((n) => DATA.rooms.length === n + 1, n0, T);
    await pa.waitForFunction(() => !document.getElementById('ai-edit-bar').hidden, null, T);
    assert.equal(await pa.evaluate(() => document.getElementById('ai-edit-title').textContent), '外部の AI が編集中です');
    assert.equal(await pa.evaluate(() => document.getElementById('ai-edit-undo').hidden), false);
    // [元に戻す] → 1枚め・2枚め・サーバーとも AI の前
    await pa.click('#ai-edit-undo');
    await pa.waitForFunction((n) => DATA.rooms.length === n, n0, T);
    await pb.waitForFunction((n) => DATA.rooms.length === n, n0, T);
    await waitServer(room.roomId, (p) => p.rooms.length === n0, 'AI の前に戻った状態');
    passed++; console.log('ok 3a MCP の変更で AI の知らせが出て、[元に戻す] で AI の前に戻り、2枚めとサーバーにも届いた');

    // [止める] → MCP の書き込みが断られる。2枚めのスイッチも切り
    r = await add('納戸', 24000);
    assert.equal(r.isError, false);
    await pa.waitForFunction((n) => DATA.rooms.length === n + 1 && !document.getElementById('ai-edit-bar').hidden, n0, T);
    await pa.click('#ai-edit-stop');
    await pa.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
    await pb.waitForFunction(() => SHARED.aiEditsOff === true, null, T);
    await pb.evaluate(() => openShareDialog());
    await pb.waitForSelector('#share-ai-allow-row', { state: 'visible', timeout: 20000 });
    assert.equal(await pb.isChecked('#share-ai-allow'), false, '2枚めのスイッチが切りになっていない');
    r = await add('倉庫', 28000);
    assert.equal(r.isError, true, '止めたのに MCP が書けた');
    assert.ok(/止めています/.test(r.text), r.text.slice(0, 400));
    assert.equal((await roomPlan(server.origin, room.roomId)).plan.rooms.length, n0 + 1, '止めている間にサーバーが変わった');
    passed++; console.log('ok 3b [止める] で MCP の書き込みが断られ、2枚めのスイッチも切りになった');

    // 2枚めでスイッチを入れ直す → 1枚めにも映り、MCP がまた書ける
    await pb.click('#share-ai-allow-row');
    await pb.waitForFunction(() => SHARED.aiEditsOff === false, null, T);
    await pa.waitForFunction(() => SHARED.aiEditsOff === false, null, T);
    await pa.evaluate(() => openShareDialog());
    assert.equal(await pa.isChecked('#share-ai-allow'), true, '1枚めのスイッチが入りに戻らない');
    assert.equal(await pa.evaluate(() => document.getElementById('share-ai-status').textContent), 'ほかの参加者が、外部の AI からの変更を受け付けるようにしました。');
    r = await add('倉庫', 28000);
    assert.equal(r.isError, false, '受け付けに戻したのに MCP が書けない: ' + r.text.slice(0, 300));
    await pb.waitForFunction((n) => DATA.rooms.length === n + 2, n0, T);
    await A.context.close(); await B.context.close();
    passed++; console.log('ok 3c 2枚めで受け付けに戻すと1枚めにも映り、MCP がまた書けた');
  }

  // ── 4. 画面の比率 ──
  if (want(4)) {
    const table = [];
    for (const [w, h] of SIZES) {
      const tag = `${w}x${h}`;
      const { context } = await openBrowser('4 ' + tag, w, h);
      const own = await saveOwnPlan(context, '自宅の間取り');
      const room = await createRoom(server.origin, FRIEND_PLAN);
      // 部屋に入って写しを作り、抜ける(起動時の知らせの元)
      let page = await context.newPage();
      await page.goto(APP + '#room=' + room.roomId);
      await page.waitForFunction((id) => window.SHARED && SHARED.roomId === id && DATA.walls.length > 4, room.roomId, T);
      await page.evaluate(() => sharedAutoSaveLocal());
      await page.close();
      page = await context.newPage();
      await page.goto(APP);
      await ready(page);
      await page.waitForFunction(() => !document.getElementById('plan-notice').hidden, null, T);
      assert.equal((await screen(page)).sig, own.sig);
      await sleep(300);
      const rows = {};
      const record = async (what, file, selectors, opts) => {
        const m = await checkLayout(page, selectors, opts);
        await page.screenshot({ path: join(SHOTS, file) });
        rows[what] = m.problems;
      };
      await record('起動時の知らせ', `start-notice-${tag}.png`, ['#plan-notice']);
      await page.click('#plan-notice-action');
      await page.waitForFunction((id) => SHARED.roomId === id, room.roomId, T);
      await socketOpen(page);
      await page.evaluate(() => closePlanNotice());
      // 共有のダイアログのスイッチ(ダイアログの中で送って見える所へ)
      await page.evaluate(() => openShareDialog());
      await page.waitForSelector('#share-ai-allow-row', { state: 'visible', timeout: 20000 });
      await page.evaluate(() => document.getElementById('share-ai-allow-row').scrollIntoView({ block: 'center' }));
      await sleep(200);
      await record('共有のダイアログのスイッチ', `share-ai-switch-${tag}.png`, ['#share-ai-allow-row'], { avoid: [] });
      await page.evaluate(() => closeShareDialog());
      // AI の知らせ
      const r = await callMcp(server.origin, 'addRoom', { plan: room.url, x: 20000, y: 0, w: 2000, d: 2000, name: '書斎' });
      assert.equal(r.isError, false);
      await page.waitForFunction(() => !document.getElementById('ai-edit-bar').hidden, null, T);
      await sleep(300);
      await record('AI の知らせ', `ai-edit-bar-${tag}.png`, ['#ai-edit-bar']);
      // 反映できなかった知らせ(AI の知らせの上に積む)
      await editWall(page, { x1: 2e9 });
      await page.waitForFunction(() => !document.getElementById('plan-notice').hidden && /反映できなかった/.test(document.getElementById('plan-notice-text').textContent), null, T);
      await sleep(300);
      await record('反映できなかった知らせ(AI の知らせと同時)', `reject-notice-with-ai-bar-${tag}.png`, ['#plan-notice', '#ai-edit-bar']);
      table.push([tag, rows]);
      await context.close();
    }
    let bad = 0;
    for (const [tag, rows] of table) {
      for (const [what, problems] of Object.entries(rows)) {
        console.log(`${problems.length ? '問題あり' : '問題なし'}  ${tag}  ${what}${problems.length ? '\n    ' + problems.join('\n    ') : ''}`);
        bad += problems.length;
      }
    }
    console.log('写真: ' + SHOTS);
    assert.equal(bad, 0, `画面の比率で ${bad} 件の問題`);
    passed++; console.log('ok 4 6つの大きさで、知らせ・AI の知らせ・スイッチが収まり、重ならず、押せる大きさ');
  }

  assert.deepEqual(errors, []);
  console.log(`shared-real-server: ${passed} 件 ok`);
} catch (e) {
  if (errors.length) console.error('ページのエラー:\n' + errors.join('\n'));
  throw e;
} finally {
  await browser.close();
  await server.stop();
}
