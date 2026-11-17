// 共同編集中に、画面の3つの操作 placeItem(物を置く)・updateSelectedProp(設定を変える)・delSel(消す)で
// 変えた物が、相手の画面に同じ結果で届くことを確かめる。
//
// なぜ要るか: 段3でこの3つを PlanCoreOperations.applyOperations の包みに作り替えた。送る候補は
// SHARED.dirtyIds の印と、基準(SHARED.baseline)との比べで決まる。選択していない物を操作が変えたとき
// (部屋の天井を上げると、その部屋の天井付けの器具も上がる)に印が付かないと、器具の高さは相手に届かない。
// 包みは applyOperations の changedIds・removedIds を sharedMarkIdsDirty に渡して印を付ける。
//
// 仕組みは shared-relay.browser.mjs と同じ(ページを2枚開き、/api/rooms/…/update の fetch と WebSocket を
// 偽物に差し替えて、テスト側の中継でつなぐ)。サーバーは使わない。
//
// sh tools/run_browser_tests.sh operations-shared
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const FIXTURE = join(HERE, 'fixtures', 'compat', 'saved-2f.json');
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeRoom(browser) {
  const room = { version: 1, pages: [], log: [], errors: [], chain: Promise.resolve(), cfg: { delay: 20 } };
  async function open(label) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => room.errors.push(`[${label}] ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.exposeFunction('__relayUpdate', async (body) => {
      const payload = JSON.parse(body);
      await sleep(room.cfg.delay);
      const version = ++room.version;
      const msg = { type: 'patch', version, expiresAt: Date.now() + 1e9, clientId: payload.clientId, patch: payload.patch };
      room.log.push({ from: label, version, patch: payload.patch });
      room.chain = room.chain.then(() => {
        for (const p of room.pages) {
          p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {});
        }
      });
      await sleep(room.cfg.delay);
      return JSON.stringify({ version, expiresAt: msg.expiresAt, savedAt: 0, checkpointPending: true, conflict: false });
    });
    await page.addInitScript((label) => {
      try { sessionStorage.setItem('webcad-collab-client', 'client-' + label + '-0000000000000000'); } catch (e) {}
      class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
      window.WebSocket = FakeWS;
      const realFetch = window.fetch.bind(window);
      window.fetch = function (url, init) {
        if (typeof url === 'string' && /\/api\/rooms\/[^/]+\/update$/.test(url)) {
          return window.__relayUpdate(init.body).then((txt) => new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return realFetch(url, init);
      };
    }, label);
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
    await page.evaluate(() => { window.__before = DATA; });
    await page.setInputFiles('#import-file', FIXTURE);
    await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.queueSharedLocalAutoSave = function () {};
      SHARED.roomId = 'testroomtestroomtestro'; SHARED.version = 1;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking();
      connectSharedSocket(); clearDirty(); clearEditHistory();
      ST.view = '2d'; ST.floor = 1; ST.tool = 'select'; ST.selected = null; clearMultiSelection(); ST.selectAll = false;
    });
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
  out.idle = !sharedHasTrackedChanges() && !SHARED.sending && !SHARED.timer;
  return out;
});
// 落ち着くまで待ち(送り残しが無く、中継の記録が増えなくなる)、2人の間取りが同じことを確かめる。
// 印の付いていない物は送られないので、ここで食い違いとして出る(全件の比べ直しはしない)。
async function settleAndCompare(r, name) {
  let quiet = 0, last = -1;
  for (let i = 0; i < 40 && quiet < 3; i++) {
    await sleep(400);
    await r.chain;
    const sa = await snap(r.a), sb = await snap(r.b);
    const ok = sa.idle && sb.idle && r.log.length === last;
    quiet = ok ? quiet + 1 : 0; last = r.log.length;
  }
  const sa = await snap(r.a), sb = await snap(r.b);
  assert.ok(sa.idle && sb.idle, `${name}: 送り残しがある`);
  const diff = [];
  for (const n of ['walls', 'items', 'rooms', 'fields']) {
    for (const id of new Set([...Object.keys(sa[n]), ...Object.keys(sb[n])])) if (sa[n][id] !== sb[n][id]) diff.push(`${n}[${id}]`);
  }
  assert.equal(diff.length, 0, `${name}: 2人の間取りが食い違っている: ${diff.slice(0, 8).join(' ')}`);
  assert.deepEqual(r.errors, [], `${name}: ページで例外`);
  return sa;
}

// 1階の普通の家具(敷地・照明・注記を除く)の n 番め
const PICK = `DATA.items.filter(function(i){return i.type!=='site-rect' && !/^light-/.test(i.type) && !isPlanAnnotationType(i.type) && !isObjectLocked(i) && (i.floor||1)===1;})`;
const itemJson = (page, id) => page.evaluate((id) => {
  const it = DATA.items.find((i) => String(i.id) === id);
  return it ? JSON.stringify(it, (k, v) => (k === '_texObj' ? undefined : v)) : null;
}, id);

const cases = {
  async '物を置くと、相手にも同じ物が届く'(r) {
    const placed = await r.a.evaluate(() => {
      ST.floor = 1; ST.placingRot = 0;
      const n = DATA.items.length;
      placeItem('sofa', 4000, 4000);
      if (DATA.items.length !== n + 1) return null;
      return String(DATA.items[DATA.items.length - 1].id);
    });
    assert.ok(placed, '物が置けていない');
    await settleAndCompare(r, '置く');
    const a = await itemJson(r.a, placed);
    assert.ok(a, '置いた物が手元に無い');
    assert.equal(await itemJson(r.b, placed), a, '置いた物が相手に届いていない');
  },
  async '選んだ物の設定を変えると、相手にも届く'(r) {
    const id = await r.a.evaluate((src) => {
      const it = (0, eval)(src)[0]; ST.selected = it; updateSelectedProp('color', '#123456');
      return String(it.id);
    }, PICK);
    await settleAndCompare(r, '設定');
    assert.equal(await r.b.evaluate((id) => DATA.items.find((i) => String(i.id) === id).color, id), '#123456', '色が相手に届いていない');
  },
  async '選んだ物を消すと、相手でも消える'(r) {
    const id = await r.a.evaluate((src) => {
      const it = (0, eval)(src)[1]; ST.selected = it; delSel();
      return String(it.id);
    }, PICK);
    assert.equal(await itemJson(r.a, id), null, '手元で消えていない');
    await settleAndCompare(r, '消す');
    assert.equal(await itemJson(r.b, id), null, '相手で消えていない');
  },
  async '複数選んで消すと、相手でも全部消える'(r) {
    const ids = await r.a.evaluate((src) => {
      const list = (0, eval)(src);
      ST.selected = list[2]; ST.multiSelected = [list[3], list[4]];
      const ids = [list[2], list[3], list[4]].map((o) => String(o.id));
      delSel();
      return ids;
    }, PICK);
    await settleAndCompare(r, '複数を消す');
    for (const id of ids) assert.equal(await itemJson(r.b, id), null, `id ${id} が相手で消えていない`);
  },
  async '部屋の天井を上げると、選んでいない天井付けの器具の高さも相手に届く'(r) {
    // 準備: 2人とも同じ部屋の天井を 2100mm に下げ、その部屋に吊り下げの照明(取付面から 500mm 下げた
    // シーリングライト)を足してから、それを共有済みの基準にする。
    // ダウンライトや天井に付いた照明は、受け手の読み込みの補完が毎回取付面へ寄せるので、印が無くても
    // 相手でそろってしまい見張りにならない。吊り下げ(300mm を超えて下げた物)は補完が触らない。
    // 天井を下げる向きも、補完が「天井より上の器具を下ろす」ので同じ理由で使わず、上げる向きで確かめる。
    const prep = () => {
      const room = DATA.rooms.find((x) => (x.floor || 1) === 1 && !x.ceiling && x.w >= 2000 && x.d >= 2000
        && roomCeilingElevationMm(x) !== null
        && roomAtPointOnFloor(1, x.x + x.w / 2, x.y + x.d / 2) === x);
      if (!room) return null;
      followRoomCeiling(room, () => { room.ceiling = { type: 'flat', heightMm: 2100 }; });
      const L = mkItem('light-ceiling', room.x + room.w / 2 - 200, room.y + room.d / 2 - 200, 0, 1);
      L.id = 990001;
      DATA.items.push(L);
      L.elev = ceilingAttachElevationMm(L) - 500;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking(); clearDirty(); clearEditHistory();
      return { light: String(L.id), room: String(room.id), elev: L.elev };
    };
    const pa = await r.a.evaluate(prep), pb = await r.b.evaluate(prep);
    assert.ok(pa, '天井付けの器具がある部屋が見つからない');
    assert.deepEqual(pb, pa, '2人の準備が食い違った');
    const got = await r.a.evaluate((p) => {
      const room = DATA.rooms.find((x) => String(x.id) === p.room);
      const L = DATA.items.find((x) => String(x.id) === p.light);
      const before = roomCeilingElevationMm(room), elevBefore = Number(L.elev) || 0;
      ST.selected = room;
      updateSelectedProp('ceiling', { type: 'flat', heightMm: 2300 });
      const delta = roomCeilingElevationMm(room) - before;
      return { elevBefore, elevAfter: Number(L.elev) || 0, delta };
    }, pa);
    assert.ok(got.delta > 0, '天井高が上がらなかった');
    assert.equal(got.elevAfter, got.elevBefore + got.delta, '手元で器具が天井に付いていっていない');
    await settleAndCompare(r, '天井');
    const elevB = await r.b.evaluate((id) => Number(DATA.items.find((i) => String(i.id) === id).elev) || 0, pa.light);
    assert.equal(elevB, got.elevAfter, '相手の器具の高さが、天井を上げたあとの高さになっていない');
  },
};

const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, fn] of Object.entries(cases)) {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
    const r = await makeRoom(browser);
    try { await fn(r); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').slice(0, 4).join('\n     ')); }
    finally { await r.close(); }
  }
} finally {
  await browser.close();
}
assert.equal(failed, 0, `${failed} 件が失敗`);
console.log(`PASS operations-shared: ${Object.keys(cases).length} 件`);
