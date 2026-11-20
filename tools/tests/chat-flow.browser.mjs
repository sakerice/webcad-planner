// チャット欄(assets/js/chat/chat-ui.js)を、実物の画面で通しで動かす。AI は呼ばない。
//
// window.fetch を差し替え、/api/ai/chat を台本どおりの SSE(Claude の Messages API の形)で返す。
// 台本の SSE は tools/tests/chat-sse-fixtures.cjs で作る。間取りは凍結間取り tools/tests/fixtures/house-2f.json。
//
// 見ること:
//   1. 「寝室にベッドを置いて」→ 偽の AI が placeItem を呼ぶ → 終わる。ベッドが1つ増え、取り消しの履歴が1つだけ増え、
//      チャット欄に AI の文と「元に戻す」が出る。「元に戻す」で物の数が戻り、「元に戻しました」が出てボタンが消える
//   2. 1回の依頼で操作3つ(部屋を足す・物を置く・設定を変える)→ 取り消し1回で全部戻る。共同編集の相手にも同じ変更が届く
//   3. 途中で失敗(2回めが 502)・断り・出力の打ち切り・回数切れ・「やめる」・依頼中にパネルを閉じる:
//      プランと取り消しの履歴は依頼の前と同じで、理由ごとの文が出る
//   4. 依頼の途中で本物のプランが変わる → 取り込まず、断りの文が出て、途中で足した物は残る
//   5. 入力欄で Delete・Ctrl+Z・矢印・r を打ってもプランと選択が変わらない。変換中の Enter で送らない。
//      依頼中は入力欄の外で Delete・Ctrl+Z を打ってもプランが変わらない
//   6. 「元に戻す」のあとでなく、取り込みのあとに利用者が別の編集をすると「元に戻す」が消える
//   7. 閉じて開き直しても、やり取りの一覧が残る
//   8. カタログの札を読み終える前に頼むと、読み終えるまで待ってから送る(その間「家具の一覧を読み込んでいます…」)
//   9. 幅 1280 と 375 で、開くボタンとパネルが画面の中にあり、既存の固定の部品と重ならない。ほかのダイアログと
//      ウォークスルーの間は開くボタンを隠す
//  10. チャットを1度も開かないとき、エラーが出ず、チャットの部品(ChatSession)も作られない
//
// 画面写真を output/test-shots/chat-*.png に残す(git の管理外)。
// sh tools/run_browser_tests.sh chat-flow
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { sseFor } = require('./chat-sse-fixtures.cjs');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'house-2f.json');
const PLAN = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const APP = process.env.APP_URL || 'http://localhost:8932/';
const SHOTS = join(ROOT, 'output', 'test-shots');
mkdirSync(SHOTS, { recursive: true });
const T = { timeout: 60000 };
const _pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MSG = {
  conflict: '作業中にプランが変わったため、変更を取り込みませんでした。もう一度お試しください。',
  upstream: 'AI から返事を受け取れませんでした。少し時間をおいてお試しください。',
  refusal: 'AI がこの依頼を断りました。間取りをどう直したいかを書いて、頼み直してください。',
  maxTokens: '返事が長くなりすぎて、途中で止まりました。依頼を小さく分けて頼み直してください。',
  // 本日ぶんの文は時刻で「明日の朝9時」と「朝9時」が変わる（日本時間の 0〜9 時）。共通の部分で見る。
  quota: '本日ぶんの AI は受付を終えました。',
  month: '今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。',
  busy: 'いま AI が混み合っています。少し待ってから、もう一度お試しください。',
  cancelled: '依頼を取り消しました。',
  applyFailed: '変更を取り込めませんでした。',
  undoBlocked: 'そのあとにプランが変わったため、元に戻せませんでした。',
};

// ── 台本 ────────────────────────────────────────────────────────────
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const txt = (text) => ({ type: 'text', text });
const think = (thinking) => ({ type: 'thinking', thinking, signature: 'sig-' + thinking.length });
function ok(content, stop, opts = {}) {
  const headers = { 'x-chat-ticket': 'tk-' + Math.random().toString(36).slice(2), 'x-chat-rounds-left': '5' };
  if (opts.remaining !== undefined) headers['x-chat-remaining'] = String(opts.remaining);
  return { status: 200, body: sseFor(content, { stop: stop || 'end_turn', textPiece: 3 }), headers, hold: opts.hold, holdBody: opts.holdBody };
}
function fail(status, code, opts = {}) {
  return { status, body: JSON.stringify({ error: code, code, message: 'x' }), headers: opts.headers || {}, hold: opts.hold };
}

// 寝室(主寝室 r1086: 2階 中心 1365,5460)にベッドを置く
const BED = { type: 'bed', x: 1365, y: 5800, floor: 2 };

// /api/ai/chat を台本どおりに返す偽物。台本は window.__chat.queue に積む。
// hold: 返事を返す前に待つ門の名前。holdBody: 本文の途中で待つ門の名前。どちらも通信の取り消し(signal)で止まる。
function installFakeChat() {
  window.__chat = { queue: [], calls: [], gates: {} };
  const realFetch = window.fetch.bind(window);
  const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
  window.fetch = function (url, init) {
    if (!String(url).includes('/api/ai/chat')) return realFetch(url, init);
    const c = window.__chat;
    try { c.calls.push(JSON.parse(init.body)); } catch (e) { c.calls.push(null); }
    const step = c.queue.shift();
    const signal = init && init.signal;
    if (!step) return Promise.resolve(new Response(JSON.stringify({ error: 'bad_request', code: 'bad_request' }), { status: 400 }));
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(aborted()); return; }
      if (signal) signal.addEventListener('abort', () => reject(aborted()));
      const go = () => {
        if (signal && signal.aborted) return;
        const headers = Object.assign({ 'content-type': step.status === 200 ? 'text/event-stream' : 'application/json' }, step.headers || {});
        if (step.status !== 200) { resolve(new Response(step.body, { status: step.status, headers })); return; }
        const enc = new TextEncoder();
        const parts = step.body.match(/[\s\S]{1,160}/g) || [''];
        let i = 0;
        resolve(new Response(new ReadableStream({
          async pull(ctrl) {
            if (step.holdBody && i === Math.floor(parts.length / 2)) {
              while (!c.gates[step.holdBody]) {
                if (signal && signal.aborted) { ctrl.error(aborted()); return; }
                await new Promise((r) => setTimeout(r, 30));
              }
            }
            if (signal && signal.aborted) { ctrl.error(aborted()); return; }
            if (i >= parts.length) { ctrl.close(); return; }
            ctrl.enqueue(enc.encode(parts[i++]));
            await new Promise((r) => setTimeout(r, 4));
          },
        }), { status: 200, headers }));
      };
      if (!step.hold) { go(); return; }
      (async () => {
        while (!c.gates[step.hold]) {
          if (signal && signal.aborted) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        go();
      })();
    });
  };
}

async function openApp(browser, viewport, opts = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  if (opts.beforeLoad) await opts.beforeLoad(page);
  await page.addInitScript(installFakeChat);
  await page.goto(APP + (APP.includes('?') ? '&' : '?') + 'preset=blank');
  await page.waitForFunction(() => window.ST && window.DATA && window.PRESET_CURRENT === 'blank', null, T);
  await page.waitForSelector('#app-loading', { state: 'hidden', ...T });
  await page.evaluate((plan) => {
    ['walls', 'rooms', 'items', 'floorMetadata', 'exteriorWallSettings', 'interiorWallSettings', 'roofAppearance', 'exteriorDetail'].forEach((k) => {
      if (plan[k] !== undefined) DATA[k] = plan[k];
    });
    let maxId = 0;
    DATA.items.concat(DATA.walls).forEach((o) => { const n = Number(o.id); if (isFinite(n) && n > maxId) maxId = n; });
    nextId = Math.max(nextId || 1, Math.floor(maxId) + 1);
    normalizeLoadedPlan({ resetHeights: false, restoreView: false });
    clearEditHistory();
    draw2d();
  }, PLAN);
  if (!opts.skipTags) await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);
  return { context, page, errors };
}

const plan = (page) => page.evaluate(() => ({
  json: JSON.stringify(DATA, (k, v) => (k.charAt(0) === '_' ? undefined : v)),
  history: HISTORY.length,
  items: DATA.items.length,
  rooms: DATA.rooms.length,
  selected: ST.selected ? String(ST.selected.id) : null,
}));
const script = (page, steps) => page.evaluate((s) => { window.__chat.queue.push(...s); }, steps);
const gate = (page, name) => page.evaluate((n) => { window.__chat.gates[n] = true; }, name);
const lastEntry = (page) => page.evaluate(() => {
  const es = document.querySelectorAll('#chat-log .chat-entry');
  const e = es[es.length - 1];
  if (!e) return null;
  const undo = e.querySelector('.chat-undo');
  return {
    user: (e.querySelector('.chat-user') || {}).textContent || '',
    ai: (e.querySelector('.chat-ai') || {}).textContent || '',
    undo: !!(undo && undo.offsetParent),
    count: es.length,
  };
});
async function send(page, text) {
  await page.locator('#chat-input').fill(text);
  await page.locator('#chat-send').click();
}
async function waitIdle(page) {
  await page.waitForFunction(() => window.ChatUI && !ChatUI.state().busy, null, { timeout: 15000 });
}
async function openChatPanel(page) {
  await page.locator('#chat-fab').click();
  await page.waitForSelector('#chat-panel:not([hidden])', { timeout: 5000 });
}
function rectsOverlap(a, b) { return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5; }
// 開くボタン・パネルと、見えている既存の固定の部品との重なり。
const layout = (page) => page.evaluate(() => {
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || b.width < 1 || b.height < 1) return null;
    if (b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) return null;
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  };
  const fixed = {};
  ['statusbar', 'app-version', 'coords', 'props', 'toolbar', 'bottom-nav', 'sidebar', 'surface-control', 'elev-snap-fab', 'walk-dpad', 'help-box']
    .forEach((id) => { const r = vis(document.getElementById(id)); if (r) fixed[id] = r; });
  return { vw: innerWidth, vh: innerHeight, fab: vis(document.getElementById('chat-fab')), panel: vis(document.getElementById('chat-panel')), fixed };
});
const busyNote = (page) => page.evaluate(() => {
  const n = document.querySelector('#chat-busy-cover .chat-busy-note');
  const b = n.getBoundingClientRect();
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
});
function assertInside(r, l, name) {
  assert.ok(r, name + ' が見えない');
  assert.ok(r.left >= 0 && r.top >= 0 && r.right <= l.vw + 0.5 && r.bottom <= l.vh + 0.5, name + ' が画面の外に出ている: ' + JSON.stringify(r));
}
function assertNoOverlap(r, l, name, allow = []) {
  for (const [id, f] of Object.entries(l.fixed)) {
    if (allow.includes(id)) continue;
    assert.ok(!rectsOverlap(r, f), `${name} が #${id} と重なっている: ${JSON.stringify(r)} / ${JSON.stringify(f)}`);
  }
}

const browser = await chromium.launch();
try {
  // ── 10. 1度も開かない ──────────────────────────────────────────────
  {
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => ({ ui: !!window.ChatUI, state: window.ChatUI && ChatUI.state(), fab: !!document.getElementById('chat-fab') }));
    assert.ok(st.ui && st.fab, 'チャット欄の部品と開くボタンが無い');
    assert.equal(st.state.hasSession, false, '開く前にチャットの部品(ChatSession)を作っている');
    assert.equal(st.state.open, false);
    assert.deepEqual(errors, [], '起動でエラーが出た');
    await context.close();
  }

  // ── 1・6・7. ベッドを置く → 元に戻す / 別の編集で消える / 開き直して残る ──
  {
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
    const l0 = await layout(page);
    assertInside(l0.fab, l0, '開くボタン(1280)');
    assertNoOverlap(l0.fab, l0, '開くボタン(1280)');
    await openChatPanel(page);
    const intro = await page.locator('#chat-log').textContent();
    assert.match(intro, /言葉で頼むと、間取りを直します。直した内容は「元に戻す」で取り消せます。/);
    assert.match(intro, /リビングにソファとテレビを置いて/);
    assert.equal(await page.locator('#chat-input').getAttribute('placeholder'), '例：寝室にベッドを置いて');
    const l1 = await layout(page);
    assertInside(l1.panel, l1, 'パネル(1280)');
    assertNoOverlap(l1.panel, l1, 'パネル(1280)');
    await page.screenshot({ path: join(SHOTS, 'chat-1280-open.png') });
    // 例を押すと入力欄に入る(送らない)
    await page.locator('.chat-example', { hasText: '2階に6畳の子ども部屋を足して' }).click();
    assert.equal(await page.locator('#chat-input').inputValue(), '2階に6畳の子ども部屋を足して');
    assert.equal(await page.evaluate(() => window.__chat.calls.length), 0, '例を押しただけで送った');

    const before = await plan(page);
    await script(page, [
      ok([think('寝室を探します。'), txt('主寝室にベッドを置きます。'), tool('tu1', 'placeItem', BED)], 'tool_use', { remaining: 4 }),
      ok([txt('主寝室にベッドを置きました。')], 'end_turn'),
    ]);
    await send(page, '寝室にベッドを置いて');
    await waitIdle(page);
    const after = await plan(page);
    assert.equal(after.items, before.items + 1, 'ベッドが1つ増えていない');
    assert.equal(after.history, before.history + 1, '取り消しの履歴が1つだけ増えていない');
    const bed = await page.evaluate(() => { const it = DATA.items[DATA.items.length - 1]; return { type: it.type, floor: it.floor }; });
    assert.ok(/Bed/i.test(bed.type) && bed.floor === 2, 'ベッドが2階に置かれていない: ' + JSON.stringify(bed));
    let e = await lastEntry(page);
    assert.equal(e.user, '寝室にベッドを置いて');
    assert.match(e.ai, /主寝室にベッドを置きました。/);
    assert.ok(e.undo, '「元に戻す」が出ていない');
    assert.match(await page.locator('#chat-remaining').textContent(), /本日あと 4 回 頼めます/);
    await page.waitForFunction(() => /主寝室にベッドを置きました。/.test(document.getElementById('chat-announce').textContent), null, { timeout: 2000 });
    assert.equal(await page.evaluate(() => document.getElementById('chat-log').hasAttribute('aria-live')), false, '一覧全体が読み上げの対象になっている');
    // 送った本文には要約と依頼文が入り、考えの要約は画面に出さない
    const call0 = await page.evaluate(() => window.__chat.calls[0]);
    assert.match(call0.messages[0].content, /^<plan_summary>[\s\S]*<\/plan_summary>\n\n<user_request>\n寝室にベッドを置いて\n<\/user_request>$/);
    assert.ok(!/寝室を探します/.test(await page.locator('#chat-panel').textContent()), '考えの要約を出している');

    await page.locator('.chat-undo').last().click();
    const undone = await plan(page);
    assert.equal(undone.items, before.items, '「元に戻す」で物の数が戻らない');
    assert.equal(undone.json, before.json, '「元に戻す」で依頼の前のプランに戻らない');
    e = await lastEntry(page);
    assert.ok(!e.undo, '「元に戻す」のあともボタンが残っている');
    assert.match(e.ai, /元に戻しました/);

    // 7. 閉じて開き直しても一覧が残る
    await page.locator('#chat-panel .unity-render-close').click();
    await page.waitForSelector('#chat-panel', { state: 'hidden' });
    await openChatPanel(page);
    e = await lastEntry(page);
    assert.equal(e.count, 1, '開き直すと一覧が消えた');
    assert.match(e.ai, /主寝室にベッドを置きました。/);

    // 6. 取り込みのあとに利用者が別の編集をすると、「元に戻す」が消える
    await script(page, [
      ok([tool('tu2', 'placeItem', BED)], 'tool_use'),
      ok([txt('もう1台置きました。')], 'end_turn'),
    ]);
    await send(page, 'もう1台置いて');
    await waitIdle(page);
    assert.ok((await lastEntry(page)).undo, '2回めの依頼で「元に戻す」が出ていない');
    const histBeforeEdit = (await plan(page)).history;
    await page.evaluate(() => {
      const it = DATA.items.find((o) => o.type === 'fmp-Sofa01' || (o.floor === 1 && o.type !== 'foundation' && !isObjectLocked(o)));
      ST.selected = it; updateProps(); draw2d();
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
    });
    await page.locator('#c2d').focus().catch(() => {});
    await page.keyboard.press('ArrowRight');
    assert.equal((await plan(page)).history, histBeforeEdit + 1, '矢印キーの編集が履歴に積まれていない(テストの前提)');
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('#chat-log .chat-undo')];
      return b.every((x) => !x.offsetParent);
    }, null, { timeout: 3000 });

    // 何件かやり取りがある状態の写真
    await script(page, [ok([txt('どの部屋に置くかを教えてください。')], 'end_turn')]);
    await send(page, 'テレビを置いて');
    await waitIdle(page);
    await page.screenshot({ path: join(SHOTS, 'chat-1280-log.png') });
    // 選択して設定欄が出ていても重ならない
    await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation'); updateProps(); draw2d(); });
    await page.waitForTimeout(300);
    const l2 = await layout(page);
    assert.ok(l2.fixed.props, 'テストの前提: 設定欄が見えていない');
    assertNoOverlap(l2.panel, l2, 'パネル(1280・選択中)');
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 2. 操作3つ → 取り消し1回で全部戻る、共同編集の相手に届く ────────
  {
    const room = await makeRoom(browser);
    const A = room.a, B = room.b;
    await settle(room);
    const a0 = await plan(A), b0 = await plan(B);
    assert.equal(a0.json, b0.json, 'テストの前提: 2人の間取りが同じでない');
    await A.locator('#chat-fab').click();
    await A.waitForSelector('#chat-panel:not([hidden])');
    await script(A, [
      ok([txt('部屋を足して、ソファを置きます。'),
        tool('a1', 'addRoom', { name: '子ども部屋', floor: 2, x: 9100, y: 1365, w: 2730, d: 3640 }),
        tool('a2', 'placeItem', { type: 'sofa', x: 5005, y: 6370, floor: 1 })], 'tool_use'),
      ok([tool('a3', 'setProps', { id: 1002, set: { thick: 150 } })], 'tool_use'),
      ok([txt('子ども部屋を足し、ソファを置き、壁を厚くしました。')], 'end_turn'),
    ]);
    await send(A, '子ども部屋を足して、ソファを置いて、北の壁を厚くして');
    await waitIdle(A);
    const a1 = await plan(A);
    assert.equal(a1.history, a0.history + 1, '操作3つで取り消しの履歴が1つだけ増えていない');
    assert.equal(a1.rooms, a0.rooms + 1, '部屋が増えていない');
    assert.equal(a1.items, a0.items + 1, 'ソファが増えていない');
    assert.equal(await A.evaluate(() => DATA.walls.find((w) => String(w.id) === '1002').thick), 150, '壁の厚さが変わっていない');
    await settle(room);
    const b1 = await plan(B);
    assert.equal(b1.rooms, a1.rooms, '相手の画面に部屋が届いていない');
    assert.equal(b1.items, a1.items, '相手の画面にソファが届いていない');
    assert.equal(await B.evaluate(() => DATA.walls.find((w) => String(w.id) === '1002').thick), 150, '相手の画面に壁の厚さが届いていない');
    await A.locator('.chat-undo').last().click();
    const a2 = await plan(A);
    assert.equal(a2.json, a0.json, '取り消し1回で3つの操作が全部戻らない');
    await settle(room);
    const b2 = await plan(B);
    assert.equal(b2.rooms, a0.rooms, '取り消しが相手に届いていない(部屋)');
    assert.equal(b2.items, a0.items, '取り消しが相手に届いていない(物)');
    assert.deepEqual(room.errors, []);
    await room.close();
  }

  // ── 3・4・5. 失敗・中断・断り・打ち切り・回数切れ・途中の変更・キー操作 ──
  {
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
    await openChatPanel(page);
    const cases = [
      { name: '2回めが 502', steps: [ok([tool('f1', 'placeItem', BED)], 'tool_use'), fail(502, 'ai_upstream_error')], msg: MSG.upstream },
      { name: '断り', steps: [ok([tool('f2', 'placeItem', BED)], 'refusal')], msg: MSG.refusal },
      { name: '打ち切り', steps: [ok([txt('置き'), tool('f3', 'placeItem', BED)], 'tool_use'), ok([txt('置いて')], 'max_tokens')], msg: MSG.maxTokens },
      { name: '回数切れ', steps: [fail(429, 'quota_exceeded')], msg: MSG.quota },
      { name: '今月の枠', steps: [fail(429, 'month_exceeded')], msg: MSG.month },
      { name: '数えられない', steps: [fail(503, 'quota_unavailable')], msg: MSG.busy },
    ];
    for (const c of cases) {
      const before = await plan(page);
      await script(page, c.steps);
      await send(page, 'ベッドを置いて(' + c.name + ')');
      await waitIdle(page);
      const after = await plan(page);
      assert.equal(after.json, before.json, c.name + ': プランが変わった');
      assert.equal(after.history, before.history, c.name + ': 取り消しの履歴が増えた');
      const e = await lastEntry(page);
      assert.ok(e.ai.includes(c.msg), c.name + ': 理由の文が出ていない: ' + e.ai);
      assert.ok(!e.undo, c.name + ': 「元に戻す」が出ている');
    }

    // やめる(依頼中の画面写真もここで撮る)
    {
      const before = await plan(page);
      await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation' && !isObjectLocked(o)); updateProps(); draw2d(); });
      const selBefore = (await plan(page)).selected;
      const before2 = await plan(page);
      await script(page, [ok([tool('c1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました')], 'end_turn', { hold: 'cancel' })]);
      await send(page, 'ベッドを置いて(やめる)');
      await page.waitForFunction(() => window.__chat.calls.length >= 2 && ChatUI.state().busy, null, { timeout: 5000 });
      assert.ok(await page.locator('#chat-busy-cover').isVisible(), '依頼中の覆いが出ていない');
      assert.match(await page.locator('#chat-busy-cover').textContent(), /AIが作業しています/);
      assert.ok(await page.locator('#chat-stop').isVisible(), '「やめる」が出ていない');
      assert.ok(await page.locator('#chat-input').isDisabled(), '依頼中に入力欄が止まっていない');
      // 5. 依頼中は入力欄の外で編集のキーを打っても効かない
      await page.locator('#chat-stop').focus();
      for (const k of ['Delete', 'Backspace', 'Control+z', 'Meta+z', 'ArrowLeft', 'f']) await page.keyboard.press(k);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      for (const k of ['Delete', 'Control+z', 'ArrowUp', 'v']) await page.keyboard.press(k);
      const mid = await plan(page);
      assert.equal(mid.json, before2.json, '依頼中のキー操作でプランが変わった');
      assert.equal(mid.selected, selBefore, '依頼中のキー操作で選択が変わった');
      // 覆いが編集の操作(キャンバスのクリック)を受け止める
      const hit = await page.evaluate(() => { const c = document.getElementById('c2d').getBoundingClientRect(); const el = document.elementFromPoint(c.left + c.width * 0.35, c.top + c.height / 2); return el && el.id; });
      assert.equal(hit, 'chat-busy-cover', '依頼中に作図の領域が覆われていない');
      const tb = await page.evaluate(() => { const r = document.getElementById('toolbar').getBoundingClientRect(); const el = document.elementFromPoint(r.left + 200, r.top + r.height / 2); return el && el.id; });
      assert.equal(tb, 'chat-busy-cover', '依頼中にツールバーが覆われていない');
      // 「AIが作業しています」は既存の部品とパネルに重ならない
      {
        const l = await layout(page);
        const n = await busyNote(page);
        assertInside(n, l, '作業中の文(1280)');
        assertNoOverlap(n, l, '作業中の文(1280)');
        assert.ok(!rectsOverlap(n, l.panel), '作業中の文がパネルに重なっている');
      }
      // 覆いの後ろへ Tab でフォーカスが移らない
      assert.equal(await page.evaluate(() => document.getElementById('toolbar').closest('[inert]') !== null), true, '依頼中にツールバーが inert になっていない');
      await page.locator('#chat-stop').focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const where = await page.evaluate(() => { const a = document.activeElement; return a === document.body || !a ? 'body' : (a.closest('#chat-panel') ? 'panel' : (a.id || a.tagName)); });
        assert.ok(where === 'panel' || where === 'body', '依頼中に Tab で覆いの後ろへフォーカスが移った: ' + where);
      }
      await page.screenshot({ path: join(SHOTS, 'chat-1280-busy.png') });
      await page.locator('#chat-stop').click();
      await waitIdle(page);
      const after = await plan(page);
      assert.equal(after.json, before.json, 'やめる: プランが変わった');
      assert.equal(after.history, before.history, 'やめる: 履歴が増えた');
      assert.ok((await lastEntry(page)).ai.includes(MSG.cancelled), 'やめる: 文が出ていない');
      assert.ok(!(await page.locator('#chat-busy-cover').isVisible()), 'やめたあとも覆いが残っている');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[inert]').length), 0, 'やめたあとも inert が残っている');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'chat-input', '終わったあと入力欄にフォーカスが戻っていない');
      // 門を開けても、取り消した依頼の続きは当たらない
      await gate(page, 'cancel');
      await page.waitForTimeout(300);
      assert.equal((await plan(page)).json, before.json, 'やめたあとに返事が届いて取り込まれた');
    }

    // 依頼中にパネルを閉じる → 取り消し
    {
      const before = await plan(page);
      await script(page, [ok([tool('x1', 'placeItem', BED)], 'tool_use', { holdBody: 'close' })]);
      await send(page, 'ベッドを置いて(閉じる)');
      await page.waitForFunction(() => window.__chat.calls.length >= 1 && ChatUI.state().busy, null, { timeout: 5000 });
      await page.locator('#chat-panel .unity-render-close').click();
      await waitIdle(page);
      await gate(page, 'close');
      await page.waitForTimeout(300);
      const after = await plan(page);
      assert.equal(after.json, before.json, '閉じる: プランが変わった');
      assert.equal(after.history, before.history, '閉じる: 履歴が増えた');
      await openChatPanel(page);
      assert.ok((await lastEntry(page)).ai.includes(MSG.cancelled), '閉じる: 取り消しの文が残っていない');
    }

    // 4. 依頼の途中で本物のプランが変わる
    {
      await page.evaluate(() => { ST.selected = null; updateProps(); });
      const before = await plan(page);
      await script(page, [ok([tool('p1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました')], 'end_turn', { hold: 'mid' })]);
      await send(page, 'ベッドを置いて(途中で変わる)');
      await page.waitForFunction(() => window.__chat.calls.length >= 1 && ChatUI.state().busy, null, { timeout: 5000 });
      // 共同編集の相手の変更と同じく、本物の DATA が変わる(取り消しの履歴には積まれない)
      const added = await page.evaluate(() => {
        const r = PlanCoreOperations.applyOperations(DATA, [{ op: 'placeItem', args: { type: 'chair', x: 5005, y: 4095, floor: 1 } }], planOpsCtx({ inPlace: true }));
        return String(r.changedIds[0]);
      });
      await gate(page, 'mid');
      await waitIdle(page);
      const after = await plan(page);
      assert.equal(after.items, before.items + 1, '途中で足した物が残っていない、またはベッドが入った');
      assert.equal(after.history, before.history, '取り込まなかったのに履歴が増えた');
      assert.ok(await page.evaluate((id) => DATA.items.some((o) => String(o.id) === id), added), '途中で足した物が消えた');
      const e = await lastEntry(page);
      assert.ok(e.ai.includes(MSG.conflict), '断りの文が出ていない: ' + e.ai);
      assert.ok(!e.undo);
      // 取り込まなかった依頼は、次の依頼の会話に入れない(AI が「置いた」と思わないように)
      await script(page, [ok([txt('はい。')], 'end_turn')]);
      await send(page, '次の依頼');
      await waitIdle(page);
      const calls = await page.evaluate(() => window.__chat.calls);
      const last = calls[calls.length - 1];
      assert.ok(!JSON.stringify(last.messages).includes('途中で変わる'), '取り込まなかった依頼が次の依頼の会話に残っている');
    }

    // 5. 入力欄のキー操作がプランと選択を変えない。変換中の Enter で送らない
    {
      await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation' && !isObjectLocked(o)); updateProps(); draw2d(); });
      const before = await plan(page);
      const calls0 = await page.evaluate(() => window.__chat.calls.length);
      await page.locator('#chat-input').fill('');
      await page.locator('#chat-input').focus();
      for (const k of ['Delete', 'Backspace', 'Control+z', 'Meta+z', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'r', 'f', 'v', 'Control+a', 'Control+c', 'Control+v']) await page.keyboard.press(k);
      await page.locator('#chat-input').fill('');
      await page.locator('#chat-input').focus();
      await page.keyboard.type('寝室');
      const after = await plan(page);
      assert.equal(after.json, before.json, '入力欄のキー操作でプランが変わった');
      assert.equal(after.selected, before.selected, '入力欄のキー操作で選択が変わった');
      assert.equal(await page.evaluate(() => ST.placingRot), 0, '入力欄の r で置く向きが変わった');
      await page.evaluate(() => {
        const t = document.getElementById('chat-input');
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__chat.calls.length), calls0, '変換中の Enter で送った');
      assert.equal(await page.locator('#chat-input').inputValue(), '寝室');
      await page.evaluate(() => {
        const t = document.getElementById('chat-input');
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
      });
      assert.ok(await page.locator('#chat-panel').isVisible(), '変換中の Escape でパネルを閉じた');
      // Shift+Enter は改行、Enter は送る
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('に');
      assert.equal(await page.locator('#chat-input').inputValue(), '寝室\nに');
      await script(page, [ok([txt('どの寝室ですか。')], 'end_turn')]);
      await page.keyboard.press('Enter');
      await waitIdle(page);
      assert.equal(await page.evaluate(() => window.__chat.calls.length), calls0 + 1, 'Enter で送っていない');
      assert.equal(await page.locator('#chat-input').inputValue(), '', '送ったあと入力欄が空になっていない');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }


  // ── 取り込みの途中の例外・2回続けた取り込み・相手の変更のあとの「元に戻す」・外壁の設定表・3D ──
  {
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await openChatPanel(page);

    // 1. normalizeLoadedPlan・draw2d が投げても、覆いが外れ、プランと履歴は依頼の前のまま
    for (const fn of ['normalizeLoadedPlan', 'draw2d']) {
      const before = await plan(page);
      await page.evaluate((name) => {
        window.__orig = window[name];
        window[name] = function () { if (window.__throwOn) throw new Error('テストの例外 ' + name); return window.__orig.apply(this, arguments); };
      }, fn);
      await script(page, [ok([tool('e1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました。')], 'end_turn')]);
      await page.evaluate(() => { window.__throwOn = true; });
      await send(page, 'ベッドを置いて(' + fn + ' が投げる)');
      await waitIdle(page);
      await page.evaluate((name) => { window.__throwOn = false; window[name] = window.__orig; draw2d(); }, fn);
      const after = await plan(page);
      assert.equal(after.json, before.json, fn + ' が投げた: プランが依頼の前と違う');
      assert.equal(after.history, before.history, fn + ' が投げた: 取り消しの履歴が増えた');
      assert.ok(!(await page.locator('#chat-busy-cover').isVisible()), fn + ' が投げた: 覆いが残っている');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[inert]').length), 0, fn + ' が投げた: inert が残っている');
      assert.equal(await page.evaluate(() => ChatUI.state().busy), false);
      const e = await lastEntry(page);
      assert.ok(e.ai.includes(MSG.applyFailed), fn + ' が投げた: 文が出ていない: ' + e.ai);
      assert.ok(!e.undo);
      assert.ok(consoleErrors.some((t) => t.includes('テストの例外 ' + fn)), fn + ' の例外が console.error に出ていない');
      // 依頼の前のプランで、キー操作が効く(固まっていない)
      await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation' && !isObjectLocked(o)); updateProps(); draw2d(); document.activeElement && document.activeElement.blur(); });
      const h0 = (await plan(page)).history;
      await page.keyboard.press('ArrowRight');
      assert.equal((await plan(page)).history, h0 + 1, fn + ' が投げた後、キー操作が効かない');
      await page.evaluate(() => { undoAction(); ST.selected = null; updateProps(); });
    }
    errors.length = 0; // テストで投げた例外は pageerror に出ない(後始末で受け止めた)はずだが、念のため数えない

    // 2. 2回続けて取り込むと、「元に戻す」は最後のやり取りにだけ残り、押すと2回めだけ戻る
    {
      await script(page, [ok([tool('d1', 'placeItem', BED)], 'tool_use'), ok([txt('1台めを置きました。')], 'end_turn')]);
      await send(page, '1台め');
      await waitIdle(page);
      const first = await plan(page);
      await script(page, [ok([tool('d2', 'placeItem', { ...BED, x: 1365, y: 4500 })], 'tool_use'), ok([txt('2台めを置きました。')], 'end_turn')]);
      await send(page, '2台め');
      await waitIdle(page);
      const second = await plan(page);
      assert.equal(second.items, first.items + 1);
      const undos = await page.evaluate(() => [...document.querySelectorAll('#chat-log .chat-entry')].map((e) => !!e.querySelector('.chat-undo')));
      assert.deepEqual(undos.filter(Boolean).length, 1, '「元に戻す」が2つ以上ある');
      assert.equal(undos[undos.length - 1], true, '「元に戻す」が最後のやり取りに無い');
      await page.locator('.chat-undo').click();
      const back = await plan(page);
      assert.equal(back.json, first.json, '「元に戻す」で2回めのぶんだけ戻っていない');
    }

    // 3. 取り込みのあとに、履歴に積まれない変更(相手の変更など)が入ったら、巻き戻さない
    {
      await script(page, [ok([tool('g1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました。')], 'end_turn')]);
      await send(page, 'ベッドを置いて(相手の変更のあと)');
      await waitIdle(page);
      await page.evaluate(() => {
        const it = mkItem('chair', 5005, 4095, 0, 1);
        DATA.items.push(it);
        draw2d();
      });
      const mid = await plan(page);
      await page.locator('.chat-undo').click();
      const after = await plan(page);
      assert.equal(after.json, mid.json, '履歴に積まれない変更のあとで「元に戻す」が巻き戻した');
      const e = await lastEntry(page);
      assert.ok(e.ai.includes(MSG.undoBlocked), '戻せなかった文が出ていない: ' + e.ai);
      assert.ok(!e.undo, '戻せなかったあともボタンが残っている');
    }

    // 5. 依頼の途中で外壁の設定表に欄が足されても(3D の作り直しと同じ)、取り込む
    {
      const before = await plan(page);
      await script(page, [ok([tool('x1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました。')], 'end_turn', { hold: 'ews' })]);
      await send(page, 'ベッドを置いて(外壁の設定表)');
      await page.waitForFunction(() => window.__chat.calls.length >= 2, null, { timeout: 5000 });
      await page.evaluate(() => { const s = ensureExteriorWallSettings(); s.walls['テストの壁'] = { color: null, texture: null, textureFlipX: false, textureFlipY: false }; });
      await gate(page, 'ews');
      await waitIdle(page);
      const after = await plan(page);
      assert.equal(after.items, before.items + 1, '外壁の設定表が変わっただけで取り込みを断った');
      assert.ok((await lastEntry(page)).undo);
      assert.equal(await page.evaluate(() => !!(DATA.exteriorWallSettings && DATA.exteriorWallSettings.walls['テストの壁'])), false,
        '外壁の設定表が今の壁と合わせられていない(消えた壁の欄が残っている)');
    }

    // 5. 外観3Dを出した状態でも取り込める
    {
      await page.evaluate(() => setView('3d-ext'));
      await page.waitForFunction(() => window.ren && window.sc3, null, { timeout: 20000 });
      await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 60000 });
      const before = await plan(page);
      const rebuilds = await page.evaluate(() => { window.__rb = 0; const o = window.rebuild3D; window.rebuild3D = function () { window.__rb++; return o.apply(this, arguments); }; return 0; });
      await script(page, [ok([tool('v1', 'placeItem', BED)], 'tool_use'), ok([txt('置きました。')], 'end_turn')]);
      // 3D の準備中はアプリの読み込み表示(#app-loading)が画面を覆うことがあるので、ボタンを押さずに送る
      const t3d = Date.now();
      await page.evaluate(() => ChatUI.send('ベッドを置いて(3D)'));
      await page.waitForFunction(() => !ChatUI.state().busy, null, { timeout: 180000, polling: 500 }).catch(async (e) => {
        console.log('3D の依頼の状態', JSON.stringify(await page.evaluate(() => ({ st: ChatUI.state(), calls: window.__chat.calls.length, q: window.__chat.queue.length, prog: document.getElementById('chat-progress').textContent, tags: !!CATALOGUE_TAGS }))));
        throw e;
      });
      console.log('3D 表示中の依頼: ' + (Date.now() - t3d) + 'ms');
      const after = await plan(page);
      assert.equal(after.items, before.items + 1, '3D 表示中に取り込めない');
      assert.ok(await page.evaluate(() => window.__rb > 0), '3D 表示中の取り込みで 3D を作り直していない');
      assert.equal(await page.evaluate(() => ST.view), '3d-ext', '取り込みで視点が変わった');
      await page.evaluate(() => setView('2d'));
      void rebuilds;
    }
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 8. カタログの札の読み込み前に頼む ──────────────────────────────
  {
    let release;
    const held = new Promise((r) => { release = r; });
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 }, {
      skipTags: true,
      beforeLoad: (p) => p.route('**/assets/models/tags.json', async (route) => { await held; await route.continue(); }),
    });
    assert.equal(await page.evaluate(() => CATALOGUE_TAGS), null, 'テストの前提: 札を読み終えている');
    await openChatPanel(page);
    const before = await plan(page);
    await script(page, [ok([tool('t1', 'placeItem', { type: 'tv', x: 5005, y: 6370, floor: 1 })], 'tool_use'), ok([txt('テレビを置きました。')], 'end_turn')]);
    await send(page, 'リビングにテレビを置いて');
    await page.waitForFunction(() => /家具の一覧を読み込んでいます/.test(document.getElementById('chat-progress').textContent), null, { timeout: 5000 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__chat.calls.length), 0, '札を読み終える前に送った');
    release();
    await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS, null, T);
    await waitIdle(page);
    const after = await plan(page);
    assert.equal(after.items, before.items + 1, '札を読み終えたあとの依頼でテレビが入っていない');
    assert.match((await lastEntry(page)).ai, /テレビを置きました。/);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 9. 375 の幅 ─────────────────────────────────────────────────────
  {
    const { context, page, errors } = await openApp(browser, { width: 375, height: 812 });
    const l0 = await layout(page);
    assertInside(l0.fab, l0, '開くボタン(375)');
    assertNoOverlap(l0.fab, l0, '開くボタン(375)');
    const fabBox = await page.locator('#chat-fab').boundingBox();
    assert.ok(fabBox.width >= 40 && fabBox.height >= 40, 'タッチの的が 40px より小さい');
    assert.equal(await page.locator('#chat-fab').getAttribute('aria-label'), 'AIに頼む');
    // 選んで設定欄の見出しが出ても重ならない
    await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation'); updateProps(); draw2d(); });
    await page.waitForTimeout(400);
    const lSel = await layout(page);
    assertNoOverlap(lSel.fab, lSel, '開くボタン(375・選択中)');
    await page.evaluate(() => { ST.selected = null; updateProps(); draw2d(); });
    await page.waitForTimeout(300);

    await openChatPanel(page);
    const l1 = await layout(page);
    assertInside(l1.panel, l1, 'パネル(375)');
    // 下からのシートは下のナビの上に重ねて出す(下のナビより手前)
    assertNoOverlap(l1.panel, l1, 'パネル(375)', ['bottom-nav']);
    const top = await page.evaluate(() => { const r = document.getElementById('bottom-nav').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(el && el.closest('#chat-panel')); });
    assert.ok(top, 'シートが下のナビの下に隠れている');
    await page.screenshot({ path: join(SHOTS, 'chat-375-open.png') });
    for (const c of [
      [ok([tool('m1', 'placeItem', BED)], 'tool_use'), ok([txt('主寝室にベッドを置きました。')], 'end_turn')],
      [ok([txt('どの部屋にしますか。')], 'end_turn')],
    ]) {
      await script(page, c);
      await send(page, c.length > 1 ? '寝室にベッドを置いて' : 'テレビを置いて');
      await waitIdle(page);
    }
    await page.screenshot({ path: join(SHOTS, 'chat-375-log.png') });
    await script(page, [ok([txt('考えます')], 'end_turn', { hold: 'shot' })]);
    await send(page, '選んでいる物を1つ消して');
    await page.waitForFunction(() => ChatUI.state().busy, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    {
      const l = await layout(page);
      const n = await busyNote(page);
      assertInside(n, l, '作業中の文(375)');
      assertNoOverlap(n, l, '作業中の文(375)');
      assert.ok(!rectsOverlap(n, l.panel), '作業中の文がシートに重なっている(375)');
    }
    await page.screenshot({ path: join(SHOTS, 'chat-375-busy.png') });
    await gate(page, 'shot');
    await waitIdle(page);

    // ほかのダイアログ・ウォークスルーの間は開くボタンを隠す
    await page.locator('#chat-panel .unity-render-close').click();
    assert.ok(await page.locator('#chat-fab').isVisible());
    await page.evaluate(() => openPlanImport());
    await page.waitForSelector('#plan-import-modal.show');
    assert.ok(!(await page.locator('#chat-fab').isVisible()), 'ダイアログが開いている間も開くボタンが見えている');
    await page.evaluate(() => closePlanImport());
    await page.evaluate(() => { document.getElementById('c3d-wrap').style.display = 'block'; document.getElementById('walk-hud').style.display = 'block'; });
    assert.ok(!(await page.locator('#chat-fab').isVisible()), 'ウォークスルーの間も開くボタンが見えている');
    await page.evaluate(() => { document.getElementById('walk-hud').style.display = 'none'; document.getElementById('c3d-wrap').style.display = 'none'; });
    assert.ok(await page.locator('#chat-fab').isVisible());
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 900 の幅(769〜1100 の間) ─────────────────────────────────────
  {
    const { context, page, errors } = await openApp(browser, { width: 900, height: 800 });
    const l0 = await layout(page);
    assertInside(l0.fab, l0, '開くボタン(900)');
    assertNoOverlap(l0.fab, l0, '開くボタン(900)');
    await openChatPanel(page);
    const l1 = await layout(page);
    assertInside(l1.panel, l1, 'パネル(900)');
    assertNoOverlap(l1.panel, l1, 'パネル(900)');
    await page.screenshot({ path: join(SHOTS, 'chat-900-open.png') });
    await page.evaluate(() => { ST.selected = DATA.items.find((o) => o.floor === 1 && o.type !== 'foundation'); updateProps(); draw2d(); });
    await page.waitForTimeout(300);
    const l2 = await layout(page);
    assertNoOverlap(l2.panel, l2, 'パネル(900・選択中)');
    await script(page, [ok([txt('考えます')], 'end_turn', { hold: 'w900' })]);
    await send(page, 'テレビを置いて');
    await page.waitForFunction(() => ChatUI.state().busy, null, { timeout: 5000 });
    const l3 = await layout(page);
    const n = await busyNote(page);
    assertInside(n, l3, '作業中の文(900)');
    assertNoOverlap(n, l3, '作業中の文(900)');
    assert.ok(!rectsOverlap(n, l3.panel), '作業中の文がパネルに重なっている(900)');
    await gate(page, 'w900');
    await waitIdle(page);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ── 図面の画像を付ける → 読み取りを開く ─────────────────────────────
  {
    const { context, page, errors } = await openApp(browser, { width: 1280, height: 800 });
    await openChatPanel(page);
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 150;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 150); g.strokeRect(20, 20, 100, 80);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#chat-file').setInputFiles({ name: 'madori.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForSelector('#plan-import-modal.show', { timeout: 5000 });
    await page.waitForSelector('#plan-import-step2', { state: 'visible', timeout: 5000 });
    assert.match(await page.locator('#chat-log').textContent(), /図面の読み取りを開きました/);
    assert.equal(await page.evaluate(() => window.__chat.calls.length), 0, '画像を付けただけで AI に送った');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}

// ── 共同編集の2画面(shared-relay.browser.mjs と同じ仕組み) ─────────────
async function makeRoom(browserArg) {
  const room = { version: 1, pages: [], log: [], errors: [], chain: Promise.resolve() };
  async function open(label) {
    const context = await browserArg.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => room.errors.push(`[${label}] ${e.message}`));
    page.on('dialog', (d) => d.accept());
    await page.exposeFunction('__relayUpdate', async (body) => {
      const payload = JSON.parse(body);
      await sleep(20);
      const version = ++room.version;
      const msg = { type: 'patch', version, expiresAt: Date.now() + 1e9, clientId: payload.clientId, patch: payload.patch };
      room.log.push({ from: label, version });
      room.chain = room.chain.then(() => {
        for (const p of room.pages) p.page.evaluate((m) => window.__ws && window.__ws.onmessage && window.__ws.onmessage({ data: JSON.stringify(m) }), msg).catch(() => {});
      });
      await sleep(20);
      return JSON.stringify({ version, expiresAt: msg.expiresAt, savedAt: 0, checkpointPending: true, conflict: false });
    });
    await page.addInitScript(installFakeChat);
    await page.addInitScript((lb) => {
      try { sessionStorage.setItem('webcad-collab-client', 'client-' + lb + '-0000000000000000'); } catch (e) {}
      class FakeWS { constructor() { this.readyState = 1; window.__ws = this; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} }
      window.WebSocket = FakeWS;
      const prev = window.fetch.bind(window);
      window.fetch = function (url, init) {
        if (typeof url === 'string' && /\/api\/rooms\/[^/]+\/update$/.test(url)) {
          return window.__relayUpdate(init.body).then((t) => new Response(t, { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return prev(url, init);
      };
    }, label);
    await page.goto(APP + '?preset=blank');
    await page.waitForFunction(() => window.DATA && DATA.walls && window.ST && window._defaultPlanPending === false, null, T);
    await page.evaluate(() => { window.__before = DATA; });
    await page.setInputFiles('#import-file', FIXTURE);
    await page.waitForFunction(() => window.DATA !== window.__before && DATA.walls.length > 4, null, T);
    await page.waitForFunction(() => typeof CATALOGUE_TAGS !== 'undefined' && CATALOGUE_TAGS && CATALOGUE_TAGS.items, null, T);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.queueSharedLocalAutoSave = function () {};
      SHARED.roomId = 'testroomtestroomtestro'; SHARED.version = 1;
      SHARED.baseline = sharedBaselineFrom(DATA); sharedResetDirtyTracking();
      connectSharedSocket(); clearDirty(); clearEditHistory();
    });
    room.pages.push({ label, page, context });
    return page;
  }
  room.a = await open('A'); room.b = await open('B');
  room.close = async () => { for (const p of room.pages) await p.context.close(); };
  return room;
}
async function settle(room) {
  let quiet = 0, last = -1;
  for (let i = 0; i < 40 && quiet < 3; i++) {
    await sleep(400);
    await room.chain;
    const idle = await Promise.all(room.pages.map((p) => p.page.evaluate(() => !SHARED.sending && !SHARED.timer && !sharedHasTrackedChanges())));
    const okNow = idle.every(Boolean) && room.log.length === last;
    quiet = okNow ? quiet + 1 : 0; last = room.log.length;
  }
}
