// 外の AI(MCP の create_plan)が作ったルームに人が参加したとき、画面が手元で補う既定値(外壁の 3 階・4 階の設定、
// 内観・屋根の設定など)を部屋へ送らないことを確かめる。
//
// なぜ要るか: create_plan が作るプラン(worker/mcp.mjs の blankPlan)は、外壁・内観・屋根の設定が null のまま始まる。
// AI の操作で欄ができても、画面が開くときに補う既定値のすべては入らない。参加した画面(installSharedPlan)は、
// 補う前のプランから基準(SHARED.baseline)を取っていたので、補った既定値が「未送信の変更」になり、
// 最初のクリック(マウスを離したとき)で exteriorWallSettings を丸ごと部屋へ送っていた。
// 受けた相手は取り消しの履歴が消え、複数選択が外れる。
//
// 方針(利用者の決定): 補完は部屋へ送らず、開いた画面がそれぞれ手元で補う。ルームのプランに既定値は入らないまま。
// ただし id の無い物に振った id は、今までどおり送る(相手と物の対応を取るため。installSharedPlan の説明)。
//
// サーバーは使わない。shared-drag-release と同じく、ページを2枚開き、/api/rooms/… への fetch と WebSocket を
// 偽物に差し替えて、テスト側の「中継」でつなぐ。部屋への参加は、URL から入るときと同じ
// installSharedPlan(await fetchSharedPlan(id), id) を通す。
//
// sh tools/run_browser_tests.sh shared-join-backfill
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const FIXTURE = join(HERE, 'fixtures', 'house-2f.json');
const ROOM = 'testroomtestroomtestro';
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 外の AI が作った形のプラン。house-2f.json の間取りに、create_plan の空のプラン(worker/mcp.mjs の blankPlan)の欄を
// かぶせ、画面が開くときに補う欄を抜く。
//   - 外壁の設定は、1 階・2 階の色だけ(3 階・4 階・壁ごと・面ごとの欄が無い)
//   - 内観・屋根の設定は null(blankPlan のまま)
//   - 表示位置(viewState)は無い
// opts.idless: id の無い家具を1つ混ぜる(古いデータの id の無い物。部屋は全体の保存ではこれを断らない。worker/room-guard.mjs)
function aiPlan(opts = {}) {
  const base = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const ext = base.exteriorWallSettings;
  const plan = {
    walls: base.walls, items: base.items, rooms: base.rooms, floors: {},
    heightDefaults: { modelVersion: 2, floorThickness: 180 },
    floorMetadata: base.floorMetadata,
    exteriorWallSettings: { whole: ext.whole, floors: { 1: ext.floors['1'], 2: ext.floors['2'] } },
    interiorWallSettings: null, roofAppearance: null,
    startMode: 'blank',
  };
  if (opts.idless) {
    const it = plan.items.find((i) => (i.floor || 1) === 1 && /^(fmp-|im0261-)/.test(i.type || ''));
    const copy = JSON.parse(JSON.stringify(it));
    delete copy.id; copy.x += 5; plan.items.push(copy);
  }
  return plan;
}

async function makeRoom(browser, plan) {
  const room = { version: 1, plan, pages: [], log: [], errors: [], chain: Promise.resolve() };
  // 中継: 届いた差分を記録し、全員(送った本人も)へ配る
  room.broadcast = (msg) => {
    room.chain = room.chain.then(() => Promise.all(room.pages.map((p) =>
      p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {}))));
    return room.chain;
  };
  async function open(label) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => room.errors.push(`[${label}] ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.exposeFunction('__relayUpdate', async (body) => {
      const payload = JSON.parse(body);
      await sleep(20);
      const version = ++room.version;
      const msg = { type: 'patch', version, expiresAt: Date.now() + 1e9, clientId: payload.clientId, patch: payload.patch };
      room.log.push({ from: label, version, patch: payload.patch });
      room.broadcast(msg);
      await sleep(20);
      return JSON.stringify({ version, expiresAt: msg.expiresAt, savedAt: 0, checkpointPending: true, conflict: false });
    });
    // 部屋のプランの取得(GET /api/rooms/<id>)。部屋に保存されている形(補う前)をそのまま返す
    await page.exposeFunction('__relayGet', async () => JSON.stringify({ plan: room.plan, version: room.version }));
    await page.addInitScript((label) => {
      try { sessionStorage.setItem('webcad-collab-client', 'client-' + label + '-0000000000000000'); } catch (e) {}
      class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
      window.WebSocket = FakeWS;
      const realFetch = window.fetch.bind(window);
      window.fetch = function (url, init) {
        if (typeof url === 'string' && /\/api\/rooms\/[^/]+\/update$/.test(url)) {
          return window.__relayUpdate(init.body).then((txt) => new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (typeof url === 'string' && /^\/api\/rooms\/[^/]+$/.test(url) && !(init && init.method && init.method !== 'GET')) {
          return window.__relayGet().then((txt) => {
            const r = JSON.parse(txt);
            return new Response(JSON.stringify(r.plan), { status: 200, headers: { 'content-type': 'application/json', 'x-room-version': String(r.version), 'x-room-expires-at': String(Date.now() + 1e9), 'x-room-saved-at': '0' } });
          });
        }
        return realFetch(url, init);
      };
    }, label);
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
    await page.waitForTimeout(300);
    // URL から部屋に入るときと同じ道(initSharedRoomFromUrl の中身)で参加する
    await page.evaluate(async (roomId) => {
      window.queueSharedLocalAutoSave = function () {};
      installSharedPlan(await fetchSharedPlan(roomId), roomId);
    }, ROOM);
    await page.waitForFunction(() => DATA.walls.length > 4 && SHARED.roomId, null, T);
    await page.waitForTimeout(300);
    const p = { label, page, context };
    room.pages.push(p);
    return p;
  }
  room.a = (await open('A')).page; room.b = (await open('B')).page;
  room.close = async () => { for (const p of room.pages) await p.context.close(); };
  return room;
}

const snap = (page) => page.evaluate(() => {
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '_texObj' ? undefined : v)));
  const out = { fields: {} };
  for (const n of ['walls', 'items', 'rooms']) { out[n] = {}; for (const it of DATA[n]) out[n][String(it.id)] = JSON.stringify(strip(it)); }
  for (const k of PlanCorePatch.SHARED_FIELDS) out.fields[k] = JSON.stringify(DATA[k] === undefined ? null : DATA[k]);
  const tracked = !!sharedHasTrackedChanges(), force = SHARED.forceScan;
  SHARED.forceScan = true; const rest = buildSharedPatch(DATA, SHARED.baseline); SHARED.forceScan = force;
  out.unsent = rest ? Object.keys(rest.fields).concat(...Object.keys(rest.collections).map((n) => rest.collections[n].upserts.map((i) => n + '[' + i.id + ']').concat(rest.collections[n].removes.map((id) => n + '-' + id)))) : null;
  out.busy = tracked || SHARED.sending || !!SHARED.timer;
  return out;
});
// 送信が落ち着くまで待つ(予約・送信中が無く、中継に新しい差分が来なくなるまで)
async function settle(r) {
  let quiet = 0, last = -1;
  for (let i = 0; i < 60 && quiet < 4; i++) {
    await sleep(400);
    await r.chain;
    const sa = await snap(r.a), sb = await snap(r.b);
    const ok = !sa.busy && !sb.busy && r.log.length === last;
    quiet = ok ? quiet + 1 : 0; last = r.log.length;
  }
}
const sends = (r, from) => r.log.filter((l) => !from || l.from === from);
const describeSends = (list) => list.map((l) => `${l.from}: fields=[${Object.keys(l.patch.fields || {}).join(',')}] collections=[${Object.keys(l.patch.collections || {}).join(',')}]`).join(' / ');
// ignore: 送り残しの見比べから外す物(例 'walls[1002]')。下の「壁を選ぶ」の説明を参照
async function assertNoSends(r, name, ignore = []) {
  await settle(r);
  assert.deepEqual(r.errors, [], `${name}: ページで例外`);
  assert.equal(sends(r).length, 0, `${name}: 送信は0回のはずが ${sends(r).length} 回(${describeSends(sends(r))})`);
  for (const [label, page] of [['A', r.a], ['B', r.b]]) {
    const s = await snap(page);
    const rest = s.unsent && s.unsent.filter((k) => !ignore.includes(k));
    assert.ok(!rest || !rest.length, `${name}: ${label} に送り残し(未送信の差)がある: ${rest && rest.slice(0, 6).join(' ')}`);
  }
}

// 何も無い所(キャンバスの上で、物に当たらない位置)。ページ上の位置を返す
const findEmpty = (page) => page.evaluate(() => {
  ST.selected = null; clearMultiSelection();
  const rect = canvas.getBoundingClientRect();
  for (let cy = 60; cy < rect.height - 100; cy += 37) {
    for (let cx = 60; cx < rect.width - 240; cx += 41) {
      const px = Math.round(rect.left + cx), py = Math.round(rect.top + cy);
      if (document.elementFromPoint(px, py) !== canvas) continue;
      const at = c2w(px - rect.left, py - rect.top);
      const cands = collect2DPickCandidates(px - rect.left, py - rect.top, snapV(at.x), snapV(at.y), { includeRoomArea: true });
      if (!cands.length) return { x: px, y: py };
    }
  }
  return null;
});
// 壁の線の上で、その位置でいちばん手前に当たる壁(shared-drag-release の findGrab と同じ探し方)
const findWall = (page) => page.evaluate(() => {
  ST.selected = null; clearMultiSelection();
  const rect = canvas.getBoundingClientRect();
  for (const w of DATA.walls) {
    if ((w.floor || 1) !== ST.floor || isObjectLocked(w)) continue;
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      const c0 = w2c(w.x1 + (w.x2 - w.x1) * t, w.y1 + (w.y2 - w.y1) * t);
      const px = Math.round(rect.left + c0.cx), py = Math.round(rect.top + c0.cy);
      const c = { cx: px - rect.left, cy: py - rect.top };
      if (c.cx < 40 || c.cy < 40 || c.cx > rect.width - 200 || c.cy > rect.height - 80) continue;
      if (document.elementFromPoint(px, py) !== canvas) continue;
      const at = c2w(c.cx, c.cy);
      const cands = collect2DPickCandidates(c.cx, c.cy, snapV(at.x), snapV(at.y), { includeRoomArea: false });
      if (!cands.length || cands[0].obj !== w || cands[0].kind !== 'wall') continue;
      return { id: String(w.id), x: px, y: py };
    }
  }
  return null;
});
async function click(page, at) { await page.mouse.move(at.x, at.y); await page.mouse.down(); await sleep(60); await page.mouse.up(); }

const cases = {
  async '参加した画面で何も無い所をクリックしても、何も送らない'(r) {
    // 参加しただけで、補った既定値は画面にある(手元では補えている)
    const ext = await r.a.evaluate(() => Object.keys(DATA.exteriorWallSettings.floors).sort().join(','));
    assert.equal(ext, '1,2,3,4', `参加した画面で外壁の 3 階・4 階が補われていない(${ext})`);
    const at = await findEmpty(r.a);
    assert.ok(at, '何も無い位置がテスト用のプランに見つからない');
    await click(r.a, at);
    await assertNoSends(r, '何も無い所のクリック');
  },
  async '参加した画面で壁を選んでも、何も送らない'(r) {
    const g = await findWall(r.a);
    assert.ok(g, 'つかめる壁がテスト用のプランに見つからない');
    await click(r.a, g);
    assert.equal(await r.a.evaluate((id) => !!ST.selected && String(ST.selected.id) === id, g.id), true, '壁を選べていない');
    // 相手(B)でも同じことをする
    const gb = await findWall(r.b);
    await click(r.b, gb);
    // 選んだ壁そのものは見比べから外す。設定欄を描く updateProps(assets/js/app-state.js)が、選んだ物に
    // sScale・sX・sY が無いと書き足す(印は付けないので送信は起きないが、基準との差は残る)。参加の補完とは別の件。
    await assertNoSends(r, '壁を選ぶ', [`walls[${g.id}]`, `walls[${gb.id}]`]);
  },
  async '部屋の取り直し(再接続で版が進んでいたとき)のあとも、何も送らない'(r) {
    // welcome の版が手元より進んでいると、全体を取り直す(refreshSharedPlan → installSharedPlan の resuming)
    r.version += 1;
    await r.a.evaluate((v) => window.__ws.onmessage({ data: JSON.stringify({ type: 'welcome', version: v, expiresAt: Date.now() + 1e9, savedAt: 0, people: [] }) }), r.version);
    await r.a.waitForFunction((v) => SHARED.version === v && !SHARED.refreshing, r.version, T);
    const at = await findEmpty(r.a);
    await click(r.a, at);
    await assertNoSends(r, '取り直しのあとのクリック');
  },
  async '外壁の色を本当に変えたときは、今までどおり送られ、相手に届き、そのあと余計な送信が無い'(r) {
    await r.a.evaluate(() => updateExteriorSetting('floor', 'color', '#336699', 1));
    await settle(r);
    assert.deepEqual(r.errors, [], 'ページで例外');
    const fromA = sends(r, 'A'), fromB = sends(r, 'B');
    assert.equal(fromA.length, 1, `A の送信は1回のはずが ${fromA.length} 回(${describeSends(fromA)})`);
    assert.ok(fromA[0].patch.fields && fromA[0].patch.fields.exteriorWallSettings, 'A の送信に外壁の設定が入っていない');
    assert.equal(fromB.length, 0, `受けた B が送り返した(${describeSends(fromB)})`);
    const color = await r.b.evaluate(() => DATA.exteriorWallSettings.floors[1].color);
    assert.equal(color, '#336699', `B に外壁の色が届いていない(${color})`);
    // そのあと両方でクリックしても、何も送らない
    const before = sends(r).length;
    await click(r.a, await findEmpty(r.a));
    await click(r.b, await findEmpty(r.b));
    await settle(r);
    assert.equal(sends(r).length, before, `色を変えたあとのクリックで余計な送信(${describeSends(sends(r).slice(before))})`);
    for (const [label, page] of [['A', r.a], ['B', r.b]]) {
      const s = await snap(page);
      assert.equal(s.unsent, null, `${label} に送り残しがある: ${s.unsent && s.unsent.slice(0, 6).join(' ')}`);
    }
    const sa = await snap(r.a), sb = await snap(r.b);
    assert.equal(sa.fields.exteriorWallSettings, sb.fields.exteriorWallSettings, 'A と B の外壁の設定が食い違う');
  },
  async '相手(外の AI)が補う前の形の外壁の設定を送ってきても、送り返しの往復が起きない'(r) {
    // 部屋に保存されている形(1 階・2 階だけ)のまま、1 階の色だけ変えた外壁の設定が届く
    const plan = r.plan;
    const ext = JSON.parse(JSON.stringify(plan.exteriorWallSettings));
    ext.floors[1].color = '#884422';
    r.version += 1;
    await r.broadcast({ type: 'patch', version: r.version, expiresAt: Date.now() + 1e9, clientId: 'mcp-ai', source: 'ai', patch: { collections: {}, fields: { exteriorWallSettings: ext } } });
    await settle(r);
    for (const [label, page] of [['A', r.a], ['B', r.b]]) {
      const got = await page.evaluate(() => ({ color: DATA.exteriorWallSettings.floors[1].color, floors: Object.keys(DATA.exteriorWallSettings.floors).sort().join(',') }));
      assert.equal(got.color, '#884422', `${label} に色が届いていない`);
      assert.equal(got.floors, '1,2,3,4', `${label} で 3 階・4 階が補われていない`);
    }
    await click(r.a, await findEmpty(r.a));
    await click(r.b, await findEmpty(r.b));
    await assertNoSends(r, '補う前の形を受けたあと');
  },
};

// id の無い物があるプランでは、振った id だけは今までどおり送る(外壁などの補完は送らない)
const idCases = {
  async 'id の無い物があるとき、壁を選んだときの送信は振った id の物だけで、外壁などの補完は入らない'(r) {
    // 壁を選ぶと送信の見直しが走る(何も無い所のクリックでは走らない)。直す前は、ここで外壁などの補完も一緒に送っていた
    const g = await findWall(r.a);
    assert.ok(g, 'つかめる壁がテスト用のプランに見つからない');
    await click(r.a, g);
    await settle(r);
    assert.deepEqual(r.errors, [], 'ページで例外');
    const fromA = sends(r, 'A');
    assert.equal(fromA.length, 1, `A の送信は1回のはずが ${fromA.length} 回(${describeSends(fromA)})`);
    const p = fromA[0].patch;
    assert.deepEqual(Object.keys(p.fields || {}), [], `補完した欄まで送った(${Object.keys(p.fields || {}).join(',')})`);
    const items = p.collections && p.collections.items;
    assert.ok(items && items.upserts.length === 1 && items.upserts[0].id !== undefined && items.upserts[0].id !== null, `振った id の物が送られていない(${JSON.stringify(items && { upserts: items.upserts.map((i) => i.id), removes: items.removes })})`);
    assert.deepEqual(Object.keys(p.collections).filter((n) => n !== 'items'), [], `ほかの集まりまで送った(${Object.keys(p.collections).join(',')})`);
  },
};

const browser = await chromium.launch();
let failed = 0, total = 0;
try {
  for (const [group, plan] of [[cases, aiPlan()], [idCases, aiPlan({ idless: true })]]) {
    for (const [name, fn] of Object.entries(group)) {
      if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
      total++;
      const r = await makeRoom(browser, plan);
      try { await fn(r); console.log('ok   ' + name); }
      catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); }
      finally { await r.close(); }
    }
  }
} finally {
  await browser.close();
}
assert.equal(failed, 0, `${failed} 件が失敗`);
console.log(`PASS shared-join-backfill: ${total} 件`);
