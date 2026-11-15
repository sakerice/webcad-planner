// 共同編集の「送る・受ける」を、本物の関数(sharedSyncNow と WebSocket の受け口)に通して確かめる。
//
// なぜ要るか: shared-fields のテストは差分を手で運ぶので、送信の予約・送信中・応答待ち・
// 自分の差分が戻ってくる順番を一度も通らない。次の不具合はそこでしか起きない。
//   - 自分の変更を送っている最中に別の物を動かすと、その変更が相手に届かない
//   - 送っている最中に同じ物をもう一度動かすと、自分の差分が戻ったときに画面が送信時点へ戻る
//   - 自分の送信が戻るたびに、取り消し(undo)の履歴が消える
//
// サーバーは使わない。ページを2枚開き、/api/rooms/…/update への fetch と WebSocket を
// 偽物に差し替えて、テスト側の「中継」でつなぐ。中継は本物のルームと同じく、届いた順に
// 版番号を付け、全員(送った本人も含む)へ差分を配り、送り主へ応答を返す。
// 届くまで・応答までの待ち時間を場面ごとに変えて、順番を作る。
//
// sh tools/run_browser_tests.sh shared-relay
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
  // updateDelay: 中継に届くまで。respDelay: 配り始めてから送り主へ応答が返るまで。
  // echoDelay: その人が送った差分を、全員へ配るのを遅らせる時間(応答が先に返り、自分の差分が後から戻る順番を作る。
  // 本物でも応答は HTTP、配るのは WebSocket と通り道が別なので、この順番は起こる)。配る順は版の順のまま保つ。
  const room = { version: 1, pages: [], log: [], errors: [], chain: Promise.resolve(), cfg: { updateDelay: { A: 20, B: 20 }, echoDelay: { A: 0, B: 0 }, respDelay: 20, fail: 0 } };
  async function open(label) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => room.errors.push(`[${label}] ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.exposeFunction('__relayUpdate', async (body) => {
      const payload = JSON.parse(body);
      await sleep(room.cfg.updateDelay[label]);
      if (room.cfg.fail > 0) { room.cfg.fail--; return ''; }
      const version = ++room.version;
      const msg = { type: 'patch', version, expiresAt: Date.now() + 1e9, clientId: payload.clientId, patch: payload.patch };
      room.log.push({ from: label, version, patch: payload.patch });
      const wait = room.cfg.echoDelay[label];
      room.chain = room.chain.then(() => sleep(wait)).then(() => {
        for (const p of room.pages) {
          p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {});
        }
      });
      await sleep(room.cfg.respDelay);
      return JSON.stringify({ version, expiresAt: msg.expiresAt, savedAt: 0, checkpointPending: true, conflict: false });
    });
    await page.addInitScript((label) => {
      // 同じブラウザでも別の人として扱われるよう、利用者の印を分ける
      try { sessionStorage.setItem('webcad-collab-client', 'client-' + label + '-0000000000000000'); } catch (e) {}
      class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
      window.WebSocket = FakeWS;
      const realFetch = window.fetch.bind(window);
      window.fetch = function (url, init) {
        if (typeof url === 'string' && /\/api\/rooms\/[^/]+\/update$/.test(url)) {
          return window.__relayUpdate(init.body).then((txt) => (txt
            ? new Response(txt, { status: 200, headers: { 'content-type': 'application/json' } })
            : new Response('', { status: 503 })));
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
    // ルームに参加した直後と同じ状態にする(基準を取り、追跡を消し、受け口をつなぐ)
    await page.evaluate(() => {
      window.queueSharedLocalAutoSave = function () {};
      SHARED.roomId = 'testroomtestroomtestro'; SHARED.version = 1;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking();
      connectSharedSocket(); clearDirty(); clearEditHistory();
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
  // 印(dirtyIds)の付いていない物も含めて、基準と手元を比べる
  const tracked = !!sharedHasTrackedChanges(), force = SHARED.forceScan;
  SHARED.forceScan = true; const rest = buildSharedPatch(DATA, SHARED.baseline); SHARED.forceScan = force;
  out.idle = !rest && !tracked && !SHARED.sending && !SHARED.timer;
  return out;
});
function differences(sa, sb) {
  const out = [];
  for (const n of ['walls', 'items', 'rooms', 'fields']) {
    for (const id of new Set([...Object.keys(sa[n]), ...Object.keys(sb[n])])) if (sa[n][id] !== sb[n][id]) out.push(`${n}[${id}]`);
  }
  return out;
}
// 落ち着くまで待ち、2人の間取りが同じで、送り残しが無いことを確かめる
async function settleAndCompare(r, name) {
  let quiet = 0, last = -1;
  for (let i = 0; i < 60 && quiet < 4; i++) {
    await sleep(500);
    await r.chain; // 遅らせて配っている差分が、全員に届き終わるまで待つ
    const sa = await snap(r.a), sb = await snap(r.b);
    const ok = sa.idle && sb.idle && r.log.length === last;
    quiet = ok ? quiet + 1 : 0; last = r.log.length;
  }
  const sa = await snap(r.a), sb = await snap(r.b);
  assert.ok(sa.idle && sb.idle, `${name}: 送り残しがある`);
  const diff = differences(sa, sb);
  assert.equal(diff.length, 0, `${name}: 2人の間取りが食い違っている: ${diff.slice(0, 5).join(' ')} / 中継の順 ${r.log.map((l) => l.from + l.version).join(',')}`);
  assert.deepEqual(r.errors, [], `${name}: ページで例外`);
}

// 1階の家具から、n 番めを選ぶ(敷地・照明は除く)
const PICK = `DATA.items.filter(function(i){return i.type!=='site-rect' && !/^light-/.test(i.type) && (i.floor||1)===1;})`;
// 画面の操作と同じ順(選ぶ → saveState → 動かす)で家具を横に動かし、id と動かした後の x を返す
const moveItem = (page, n, dx) => page.evaluate(([src, n, dx]) => {
  const it = (0, eval)(src)[n]; ST.selected = it; saveState(); it.x += dx; draw2d(); ST.selected = null;
  return { id: String(it.id), x: it.x };
}, [PICK, n, dx]);
const itemX = (page, id) => page.evaluate((id) => DATA.items.find((i) => String(i.id) === id).x, id);
const waitSending = (page) => page.waitForFunction(() => SHARED.sending === true, null, T);

const cases = {
  async '送っている最中に別の家具を動かしても、相手に届く'(r) {
    r.cfg.updateDelay.A = 400; r.cfg.respDelay = 400;
    await moveItem(r.a, 0, 300);
    await waitSending(r.a);
    const second = await moveItem(r.a, 1, 400);
    await settleAndCompare(r, '往復中の別の家具');
    assert.equal(await itemX(r.b, second.id), second.x, '2つめの移動が相手に届いていない');
  },
  async '自分の差分が戻った後・応答の前に動かした家具も、相手に届く'(r) {
    r.cfg.updateDelay.A = 50; r.cfg.respDelay = 900;
    await moveItem(r.a, 0, 300);
    await waitSending(r.a);
    await r.a.waitForFunction(() => SHARED.version >= 2, null, T); // 自分の差分が戻った
    const second = await moveItem(r.a, 1, 400);
    await settleAndCompare(r, '戻った後・応答の前');
    assert.equal(await itemX(r.b, second.id), second.x, '2つめの移動が相手に届いていない');
  },
  async '送っている最中に同じ家具をもう一度動かしても、手元は戻らず、相手にも届く'(r) {
    r.cfg.updateDelay.A = 400; r.cfg.respDelay = 400;
    await moveItem(r.a, 0, 300);
    await waitSending(r.a);
    const again = await moveItem(r.a, 0, 400);
    await r.a.waitForFunction(() => SHARED.version >= 2, null, T);
    assert.equal(await itemX(r.a, again.id), again.x, '自分の差分が戻ったとき、手元の家具が送信時点の位置へ戻った');
    await settleAndCompare(r, '往復中の同じ家具');
    assert.equal(await itemX(r.a, again.id), again.x);
    assert.equal(await itemX(r.b, again.id), again.x, '2回めの移動が相手に届いていない');
  },
  async '送っている最中に北の向き(欄)を変えても、相手に届く'(r) {
    r.cfg.updateDelay.A = 400; r.cfg.respDelay = 400;
    await moveItem(r.a, 0, 300);
    await waitSending(r.a);
    await r.a.evaluate(() => { saveState(); DATA.northDeg = 33; markDirty(); });
    await settleAndCompare(r, '往復中の欄');
    assert.equal(await r.b.evaluate(() => DATA.northDeg), 33);
  },
  async '送ったあとも、取り消し(undo)で戻せて、戻した結果が相手に届く'(r) {
    const before = await itemX(r.a, (await r.a.evaluate((src) => String((0, eval)(src)[0].id), PICK)));
    const moved = await moveItem(r.a, 0, 300);
    await settleAndCompare(r, '送信');
    assert.equal(await itemX(r.b, moved.id), moved.x);
    assert.ok(await r.a.evaluate(() => HISTORY.length) > 0, '自分の送信が戻ったら、取り消しの履歴が消えた');
    await r.a.evaluate(() => undoAction());
    assert.equal(await itemX(r.a, moved.id), before, '取り消しで元の位置に戻らない');
    await settleAndCompare(r, '取り消し');
    assert.equal(await itemX(r.b, moved.id), before, '取り消した結果が相手に届いていない');
  },
  async '2人が同じ家具を同時に動かしたら、後に届いた方の位置で2人ともそろう'(r) {
    // B の差分が先に中継へ届き(版2)、A の差分が後(版3)。A は自分の差分が戻る前に B の差分を受ける。
    r.cfg.updateDelay.A = 500; r.cfg.updateDelay.B = 50;
    const a = await moveItem(r.a, 0, 300);
    await moveItem(r.b, 0, -500);
    await settleAndCompare(r, '同じ家具を同時に');
    assert.deepEqual(r.log.map((l) => l.from).slice(0, 2), ['B', 'A'], '中継に届いた順が想定と違う');
    assert.equal(await itemX(r.a, a.id), a.x, 'A の手元が、後に届いた A の位置になっていない');
    assert.equal(await itemX(r.b, a.id), a.x);
  },
  async '応答が先に返り、自分の差分が後から戻っても、往復中の別の家具は相手に届く'(r) {
    r.cfg.updateDelay.A = 300; r.cfg.respDelay = 0; r.cfg.echoDelay.A = 1500;
    await moveItem(r.a, 0, 300);
    await waitSending(r.a);
    const second = await moveItem(r.a, 1, 400);
    await settleAndCompare(r, '応答が先');
    assert.equal(await itemX(r.b, second.id), second.x);
  },
  async '相手に上書きされた家具を、自分の差分が戻る前にもう一度動かして送っても、2人ともその位置でそろう'(r) {
    // B の差分が版2、A の1回めが版3。A は版2 を受け、1回めの応答も受けたあと(1回めの自分の差分はまだ戻らない)、
    // 同じ家具をもう一度動かして送る(版4)。あとから戻る1回めの差分が、2回めの位置を手元で消してはいけない。
    r.cfg.updateDelay.A = 300; r.cfg.updateDelay.B = 50; r.cfg.respDelay = 0; r.cfg.echoDelay.A = 2000;
    const first = await moveItem(r.a, 0, 300);
    await moveItem(r.b, 0, -500);
    await waitSending(r.a);
    await r.a.waitForFunction(() => SHARED.sending === false && SHARED.version >= 2, null, T);
    const second = await moveItem(r.a, 0, 400);
    await settleAndCompare(r, '戻り待ちが2つ');
    assert.equal(await itemX(r.a, first.id), second.x, 'A の手元が、最後に動かした位置になっていない');
    assert.equal(await itemX(r.b, first.id), second.x);
  },
  async '相手に上書きされた家具を動かし、まだ送っていないうちに自分の差分が戻っても、動かした位置が残って相手に届く'(r) {
    r.cfg.updateDelay.A = 300; r.cfg.updateDelay.B = 50; r.cfg.respDelay = 0; r.cfg.echoDelay.A = 600;
    const first = await moveItem(r.a, 0, 300);
    await moveItem(r.b, 0, -500);
    await waitSending(r.a);
    await r.a.waitForFunction(() => SHARED.sending === false && SHARED.version >= 2, null, T);
    await r.a.evaluate(() => { window.queueSharedSyncReal = window.queueSharedSync; window.queueSharedSync = function () {}; }); // 送信を止めておく
    const second = await moveItem(r.a, 0, 400);
    await r.a.waitForFunction(() => SHARED.version >= 3, null, T); // 1回めの自分の差分が戻った
    assert.equal(await itemX(r.a, first.id), second.x, '自分の差分が戻ったとき、まだ送っていない移動が消えた');
    await r.a.evaluate(() => { window.queueSharedSync = window.queueSharedSyncReal; queueSharedSync(0); });
    await settleAndCompare(r, '未送信のまま戻る');
    assert.equal(await itemX(r.b, first.id), second.x);
  },
  async '送った家具を相手が元の位置へ戻したあと、もう一度同じ位置へ動かしても相手に届く'(r) {
    // A の差分は先に全員へ戻るが、応答は遅い。その間に B が元の位置へ戻す。
    // A の基準は「元の位置」のままでなければならない(送った位置に進めると、次に同じ位置へ動かしても差分が出ない)。
    r.cfg.updateDelay.A = 50; r.cfg.respDelay = 2500;
    const id = await r.a.evaluate((src) => String((0, eval)(src)[0].id), PICK);
    const origin = await itemX(r.a, id);
    const moved = await moveItem(r.a, 0, 300);
    await r.b.waitForFunction(([id, x]) => DATA.items.find((i) => String(i.id) === id).x === x, [id, moved.x], T);
    await moveItem(r.b, 0, -300);
    await r.a.waitForFunction(([id, x]) => DATA.items.find((i) => String(i.id) === id).x === x, [id, origin], T);
    await r.a.waitForFunction(() => SHARED.sending === false, null, T);
    await settleAndCompare(r, '相手が元へ戻す');
    const again = await moveItem(r.a, 0, 300);
    await settleAndCompare(r, 'もう一度動かす');
    assert.equal(await itemX(r.b, id), again.x, '同じ位置へ動かし直した移動が相手に届いていない');
  },
  async '天井に埋めた照明を送り、往復中に横へ動かしても、横の移動が相手に届く'(r) {
    // 自分の差分が戻ると、受け手と同じ補完が走って照明は取付面へ戻る。そのとき、往復中の横の移動を
    // 「共有済み」にしてはいけない。
    r.cfg.updateDelay.A = 400; r.cfg.respDelay = 400;
    const light = await r.a.evaluate(() => {
      const L = DATA.items.find((i) => i.type === 'light-down' && roomAtPointOnFloor(i.floor || 1, i.x + i.w / 2, i.y + i.d / 2));
      ST.selected = L; saveState(); L.elev += 200; draw2d(); ST.selected = null;
      return { id: String(L.id), elev: L.elev - 200 };
    });
    await waitSending(r.a);
    const x = await r.a.evaluate((id) => { const L = DATA.items.find((i) => String(i.id) === id); ST.selected = L; saveState(); L.x += 50; draw2d(); ST.selected = null; return L.x; }, light.id);
    await settleAndCompare(r, '補完と往復中の移動');
    assert.equal(await itemX(r.a, light.id), x, '横の移動が手元で消えた');
    assert.equal(await itemX(r.b, light.id), x, '横の移動が相手に届いていない');
    assert.equal(await r.b.evaluate((id) => DATA.items.find((i) => String(i.id) === id).elev, light.id), light.elev, '照明が取付面へ戻っていない');
  },
  async '送ったあとに動かした家具を相手が上書きしたら、ルームに届いた順(後に届いた自分の1回め)でそろう'(r) {
    // B の差分が版2、A の1回めが版3。A の2回め(まだ送っていない)は、版2 を受けたときに消える(受けた値が勝つ決まり)。
    // そのあと戻る A の1回めは、ルームでは版2 より後なので、2人とも A の1回めの位置になる。
    r.cfg.updateDelay.A = 900; r.cfg.updateDelay.B = 300;
    const first = await moveItem(r.a, 0, 300);
    await moveItem(r.b, 0, -500);
    await waitSending(r.a);
    await moveItem(r.a, 0, 400);
    await settleAndCompare(r, '上書きの前の移動');
    assert.deepEqual(r.log.map((l) => l.from).slice(0, 2), ['B', 'A'], '中継に届いた順が想定と違う');
    assert.equal(await itemX(r.a, first.id), first.x);
    assert.equal(await itemX(r.b, first.id), first.x);
  },
  async '送信に失敗しても、次の送信で相手に届く'(r) {
    r.cfg.fail = 1;
    const moved = await moveItem(r.a, 0, 300);
    await settleAndCompare(r, '失敗のあと');
    assert.equal(await itemX(r.b, moved.id), moved.x);
  },
  async '相手の変更を受けたら、取り消しの履歴は消える(相手の変更を巻き戻さないため)'(r) {
    await moveItem(r.b, 1, 200);
    await settleAndCompare(r, '準備');
    assert.ok(await r.b.evaluate(() => HISTORY.length) > 0);
    await moveItem(r.a, 0, 300);
    await settleAndCompare(r, '相手の変更');
    assert.equal(await r.b.evaluate(() => HISTORY.length), 0);
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
console.log(`PASS shared-relay: ${Object.keys(cases).length} 件`);
