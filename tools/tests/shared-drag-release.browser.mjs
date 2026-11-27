// 共同編集中に、物を長くつかんでドラッグして離したとき、離した位置が相手に届くことを確かめる。
//
// なぜ要るか: ドラッグは、動かし始めに1度だけ saveState を呼ぶ(送る候補の印が付き、約 700ms 後の送信が予約される)。
// 0.7 秒より長くつかんでいると、その送信がドラッグの途中で出て、印が消える。そのあとの動きには印が付かないので、
// 離したときの送信は「変更なし」になり、相手の画面にはドラッグ途中の位置が残っていた。
// shared-relay のテストは saveState を直接呼んで動かすので、この順番(送信 → 印なしの動き → 離す)を通らない。
// ここでは本物のマウス操作(つかむ・動かす・離す)で通す。
//
// 送信の回数も見る。短いドラッグは1回、長いドラッグは2回(途中の1回と、離したときの1回)まで。
//
// サーバーは使わない。shared-relay と同じく、ページを2枚開き、/api/rooms/…/update への fetch と WebSocket を
// 偽物に差し替えて、テスト側の「中継」でつなぐ。
//
// sh tools/run_browser_tests.sh shared-drag-release
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const FIXTURE = join(HERE, 'fixtures', 'house-2f.json');
const T = { timeout: 30000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeRoom(browser) {
  const room = { version: 1, pages: [], log: [], errors: [], chain: Promise.resolve() };
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
      room.chain = room.chain.then(() => {
        for (const p of room.pages) {
          p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {});
        }
      });
      await sleep(20);
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
  out.unsent = !!rest;
  out.busy = tracked || SHARED.sending || !!SHARED.timer;
  return out;
});
function differences(sa, sb) {
  const out = [];
  for (const n of ['walls', 'items', 'rooms', 'fields']) {
    for (const id of new Set([...Object.keys(sa[n]), ...Object.keys(sb[n])])) if (sa[n][id] !== sb[n][id]) out.push(`${n}[${id}]`);
  }
  return out;
}
// 食い違った物の、どの項目が違うか(落ちたときの手がかり)
function fieldDiff(sa, sb, key) {
  const m = key && /^(\w+)\[(.+)\]$/.exec(key); if (!m) return '';
  let a, b; try { a = JSON.parse(sa[m[1]][m[2]] || 'null') || {}; b = JSON.parse(sb[m[1]][m[2]] || 'null') || {}; } catch (e) { return ''; }
  if (typeof a !== 'object' || typeof b !== 'object') return '';
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return ' / ' + keys.slice(0, 6).map((k) => `${k}: ${JSON.stringify(a[k])} と ${JSON.stringify(b[k])}`).join(', ');
}
// 送信が落ち着くまで待つ(予約・送信中が無く、中継に新しい差分が来なくなるまで)。
// 直す前は「送り残しがあるのに、送る予約が無い」状態で止まるので、送り残しの有無では待たない。
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
// 2人の間取りが同じで、送り残しが無いことを確かめる
async function assertSame(r, name) {
  await settle(r);
  const sa = await snap(r.a), sb = await snap(r.b);
  const diff = differences(sa, sb);
  assert.equal(diff.length, 0, `${name}: 離した位置が相手に届いていない(食い違い: ${diff.slice(0, 5).join(' ')}${fieldDiff(sa, sb, diff[0])})`);
  assert.ok(!sa.unsent && !sb.unsent, `${name}: 送り残しがある`);
  assert.deepEqual(r.errors, [], `${name}: ページで例外`);
}

// つかめる物と、つかむ画面上の位置を探す。kind は 'item'(家具・開口部)・'wall'(壁の線)・'roomLabel'(部屋)。
// 条件: ロックされていない・その位置でいちばん手前に当たる・キャンバスの上にあり、右へ動かす余地がある。
// 戻り値: {id, coll, x, y}(x, y はページ上の位置)
const findGrab = (page, kind, typeSrc) => page.evaluate(([kind, typeSrc]) => {
  ST.selected = null; clearMultiSelection(); DRAG.active = false;
  const typeOk = typeSrc ? new RegExp(typeSrc) : null;
  const rect = canvas.getBoundingClientRect();
  const coll = kind === 'wall' ? 'walls' : (kind === 'roomLabel' ? 'rooms' : 'items');
  for (const obj of DATA[coll]) {
    if ((obj.floor || 1) !== ST.floor || isObjectLocked(obj)) continue;
    if (typeOk && !typeOk.test(obj.type || '')) continue;
    // つかむ位置の候補。壁は線の上を何か所か試す(真ん中は、部屋の名前や建具と重なっていることが多い)
    let points;
    if (kind === 'wall') points = [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85].map((t) => ({ x: obj.x1 + (obj.x2 - obj.x1) * t, y: obj.y1 + (obj.y2 - obj.y1) * t }));
    else if (kind === 'roomLabel') points = [{ x: obj.x + obj.w / 2, y: obj.y + obj.d / 2 }];
    else { const pose = getItemDisplayPose(obj); points = [{ x: pose.x, y: pose.y }]; }
    for (const w of points) {
      // マウスの位置は整数で届く。つかむ処理(canvas.onmousedown)と同じ計算で、その位置に当たる物を調べる
      const c0 = w2c(w.x, w.y), px = Math.round(rect.left + c0.cx), py = Math.round(rect.top + c0.cy);
      const c = { cx: px - rect.left, cy: py - rect.top };
      if (c.cx < 40 || c.cy < 40 || c.cx > rect.width - 200 || c.cy > rect.height - 80) continue;
      if (document.elementFromPoint(px, py) !== canvas || document.elementFromPoint(px + 120, py) !== canvas) continue;
      const at = c2w(c.cx, c.cy);
      const cands = collect2DPickCandidates(c.cx, c.cy, snapV(at.x), snapV(at.y), { includeRoomArea: false });
      if (!cands.length || cands[0].obj !== obj || cands[0].kind !== kind) continue;
      return { id: String(obj.id), coll, x: px, y: py };
    }
  }
  return null;
}, [kind, typeSrc || '']);

const readObj = (page, g) => page.evaluate((g) => {
  const o = DATA[g.coll].find((i) => String(i.id) === g.id);
  return o ? JSON.stringify(o, (k, v) => (k === '_texObj' ? undefined : v)) : null;
}, g);
// A が送った回数。since は、数え始める前に済んでいた回数(選んだだけで出る送信を除くため)
const sendsFromA = (r, since = 0) => r.log.filter((l) => l.from === 'A').length - since;

// 本物のマウスでつかんで右へ動かし、離す。moveMs の間に steps 回動かし、holdMs だけ止めてから離す。
async function drag(page, from, { dx = 96, dy = 0, moveMs = 1600, steps = 16, holdMs = 0 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + dx * i / steps, from.y + dy * i / steps);
    await sleep(moveMs / steps);
  }
  if (holdMs) await sleep(holdMs);
  await page.mouse.up();
}

// 長いドラッグ: 離した位置が相手に届く。送信は途中の1回と離したときの1回で、2回まで。
async function longDragCase(r, name, g, opts, since = 0) {
  assert.ok(g, `${name}: つかめる物がテスト用のプランに見つからない`);
  const before = await readObj(r.a, g);
  await drag(r.a, g, opts);
  const after = await readObj(r.a, g);
  assert.notEqual(after, before, `${name}: ドラッグで動いていない(テストの操作が効いていない)`);
  await assertSame(r, name);
  assert.equal(await readObj(r.b, g), after, `${name}: 相手の画面の位置が、離した位置と違う`);
  const n = sendsFromA(r, since);
  assert.ok(n >= 1 && n <= 2, `${name}: 送信は2回までのはずが ${n} 回`);
  return n;
}

const FURNITURE = '^(fmp-|im0261-|washer|car$|bicycle)';
const OPENING = '^(window|door)';

const cases = {
  async '家具を 1.6 秒かけてドラッグして離すと、離した位置が相手に届く(送信は2回)'(r) {
    const n = await longDragCase(r, '家具の長いドラッグ', await findGrab(r.a, 'item', FURNITURE));
    assert.equal(n, 2, `ドラッグの途中で1回、離して1回の計2回のはずが ${n} 回`);
  },
  async '家具を短くドラッグしたときは、送信は1回のまま'(r) {
    const g = await findGrab(r.a, 'item', FURNITURE);
    assert.ok(g, 'つかめる家具がテスト用のプランに見つからない');
    await drag(r.a, g, { moveMs: 240, steps: 6 });
    const after = await readObj(r.a, g);
    await assertSame(r, '家具の短いドラッグ');
    assert.equal(await readObj(r.b, g), after);
    assert.equal(sendsFromA(r), 1, `短いドラッグの送信は1回のはずが ${sendsFromA(r)} 回`);
  },
  async '家具を動かしたあと、止めたまま 1 秒つかんでから離したときは、送信は1回のまま'(r) {
    // 途中の送信が最後の位置をもう運んでいる。離したときに同じ物をもう一度送らない。
    const g = await findGrab(r.a, 'item', FURNITURE);
    assert.ok(g, 'つかめる家具がテスト用のプランに見つからない');
    await drag(r.a, g, { moveMs: 240, steps: 6, holdMs: 1200 });
    const after = await readObj(r.a, g);
    await assertSame(r, '止めてから離す');
    assert.equal(await readObj(r.b, g), after);
    assert.equal(sendsFromA(r), 1, `送信は1回のはずが ${sendsFromA(r)} 回`);
  },
  async 'つかんだだけで動かさずに離したときは、何も送らない'(r) {
    const g = await findGrab(r.a, 'item', FURNITURE);
    assert.ok(g, 'つかめる家具がテスト用のプランに見つからない');
    await r.a.mouse.move(g.x, g.y); await r.a.mouse.down(); await sleep(1000); await r.a.mouse.up();
    assert.equal(await r.a.evaluate((id) => !!ST.selected && String(ST.selected.id) === id, g.id), true, '家具をつかめていない');
    await settle(r);
    assert.deepEqual(r.errors, [], 'ページで例外');
    assert.equal(sendsFromA(r), 0, `送信は0回のはずが ${sendsFromA(r)} 回`);
    assert.equal(await r.a.evaluate(() => !!sharedHasTrackedChanges()), false, '動かしていないのに、送る候補の印が付いた');
  },
  async '開口部(窓・ドア)を長くドラッグして離すと、離した位置が相手に届く'(r) {
    await longDragCase(r, '開口部の長いドラッグ', await findGrab(r.a, 'item', OPENING));
  },
  async '壁を長くドラッグして離すと、離した位置が相手に届く'(r) {
    await longDragCase(r, '壁の長いドラッグ', await findGrab(r.a, 'wall'), { dx: 60, dy: 60 });
  },
  async '壁の端を長くドラッグして離すと、離した位置が相手に届く'(r) {
    const g = await findGrab(r.a, 'wall');
    assert.ok(g, 'つかめる壁がテスト用のプランに見つからない');
    // 壁をクリックで選んでから、端の取っ手をつかむ
    await r.a.mouse.move(g.x, g.y); await r.a.mouse.down(); await r.a.mouse.up();
    await sleep(100);
    const end = await r.a.evaluate((id) => {
      const w = DATA.walls.find((i) => String(i.id) === id);
      if (ST.selected !== w) return null;
      const rect = canvas.getBoundingClientRect(), c = w2c(w.x1, w.y1);
      return { handle: hitWallHandle(w, c.cx, c.cy), x: rect.left + c.cx, y: rect.top + c.cy };
    }, g.id);
    assert.ok(end && end.handle === 'wall-a', '壁の端の取っ手をつかめる位置が取れない');
    // 壁を選ぶと、外壁の設定の欄が補われて1回送られることがある。ドラッグの送信と分けて数える
    await settle(r);
    await longDragCase(r, '壁の端の長いドラッグ', { ...g, x: end.x, y: end.y }, { dx: 70, dy: 50 }, sendsFromA(r));
  },
  async '部屋を長くドラッグして離すと、離した位置が相手に届く'(r) {
    await longDragCase(r, '部屋の長いドラッグ', await findGrab(r.a, 'roomLabel'));
  },
  async '家具の大きさを取っ手で長くドラッグして変えると、離したときの大きさが相手に届く'(r) {
    const g = await findGrab(r.a, 'item', '^custom-block$') || await findGrab(r.a, 'item', FURNITURE);
    assert.ok(g, 'つかめる家具がテスト用のプランに見つからない');
    await r.a.mouse.move(g.x, g.y); await r.a.mouse.down(); await r.a.mouse.up();
    await sleep(100);
    // 選んだ家具のまわりを探して、大きさを変える取っ手(move・回転以外)に当たる位置を取る
    const h = await r.a.evaluate((id) => {
      const it = DATA.items.find((i) => String(i.id) === id);
      if (ST.selected !== it) return null;
      const rect = canvas.getBoundingClientRect(), pose = getItemDisplayPose(it), c = w2c(pose.x, pose.y);
      for (let dx = 0; dx <= 400; dx += 2) {
        const hit = hitHandle(it, c.cx + dx, c.cy);
        if (hit && hit !== 'move' && /^[nsew]+$/.test(hit)) {
          const px = rect.left + c.cx + dx, py = rect.top + c.cy;
          if (document.elementFromPoint(px, py) === canvas && document.elementFromPoint(px + 100, py) === canvas) return { handle: hit, x: px, y: py };
        }
      }
      return null;
    }, g.id);
    assert.ok(h, '大きさを変える取っ手をつかめる位置が取れない');
    await settle(r);
    await longDragCase(r, '大きさの長いドラッグ', { ...g, x: h.x, y: h.y }, undefined, sendsFromA(r));
  },
  async '3D の矢印で家具を長くドラッグして離すと、離した位置が相手に届く'(r) {
    // 3D の矢印に当たったかの判定(pickGizmoAxis3D)だけを差し替え、つかむ・動かす・離すは本物の関数を通す。
    const g = await findGrab(r.a, 'item', FURNITURE);
    assert.ok(g, 'つかめる家具がテスト用のプランに見つからない');
    await r.a.evaluate((id) => { ST.selected = DATA.items.find((i) => String(i.id) === id); setView('3d-ext'); }, g.id);
    await r.a.waitForFunction(() => typeof ren !== 'undefined' && !!ren && typeof sc3 !== 'undefined' && !!sc3 && typeof camExt !== 'undefined' && !!camExt, null, { timeout: 120000, polling: 200 });
    const started = await r.a.evaluate(() => {
      // headless では 3D の描画が1枚に何秒もかかり、操作の間隔が保てない。絵は見ないので、描く処理だけ止める
      ren.render = function () {}; if (typeof composer !== 'undefined' && composer) composer.render = function () {};
      window.pickGizmoAxis3D = function () { return 'x'; };
      return start3DGizmoDrag({ clientX: 600, clientY: 450 });
    });
    assert.equal(started, true, '3D の矢印のドラッグを始められない');
    const before = await readObj(r.a, g);
    for (let i = 1; i <= 16; i++) {
      await r.a.evaluate((i) => apply3DGizmoDrag({ clientX: 600 + i * 6, clientY: 450 + i * 3 }), i);
      await sleep(100);
    }
    await r.a.evaluate(() => finish3DGizmoDrag());
    const after = await readObj(r.a, g);
    assert.notEqual(after, before, '3D の矢印のドラッグで動いていない(テストの操作が効いていない)');
    await assertSame(r, '3D の矢印の長いドラッグ');
    assert.equal(await readObj(r.b, g), after, '相手の画面の位置が、離した位置と違う');
    const n = sendsFromA(r);
    assert.ok(n >= 1 && n <= 2, `送信は2回までのはずが ${n} 回`);
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
console.log(`PASS shared-drag-release: ${Object.keys(cases).length} 件`);
