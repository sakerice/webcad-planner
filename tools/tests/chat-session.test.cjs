// assets/js/chat/chat-session.js の単体テスト。
// 偽の fetch が台本どおりの SSE(chat-sse-fixtures.cjs)を返す。本物の Claude は呼ばない。
// 操作は本物の plan-core(operations.js・operations-catalog.js)を、偽の ctx で写しに当てる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Session = require('../../assets/js/chat/chat-session.js');
const O = require('../../assets/js/plan-core/operations.js');
const Catalog = require('../../assets/js/plan-core/operations-catalog.js');
const { sseFor, eventText } = require('./chat-sse-fixtures.cjs');

function makeCtx() {
  let n = 500;
  return {
    newId: () => ++n,
    catalog: {
      known: (t) => t !== 'kitchen-unit',
      resolveType: (t) => t,
      defaultSize: () => ({ w: 900, d: 900 }),
      defaultColor: () => undefined,
      model: () => null,
      is: () => false,
      canSetElevation: () => false,
      applyLightDefaults: () => {},
      contextExteriorHeight: () => 6000,
      contextFloors: () => 2,
      constants: { rulerThickness: 60, walkRouteThickness: 50, walkDefaultSpeed: 1.2 },
    },
    plan: { wallHeightForFloor: () => 2400, floorRaiseForFloor: () => 0, foundationHeight: () => 0 },
  };
}
function basePlan() {
  return {
    walls: [{ id: 1, x1: 0, y1: 0, x2: 4000, y2: 0, floor: 1, thick: 120 }],
    rooms: [{ id: 'rm_a', type: 'room', x: 0, y: 0, w: 4000, d: 3000, floor: 1, n: '洋室' }],
    items: [{ id: 10, type: 'sofa', x: 1000, y: 1000, w: 1800, d: 900, rot: 0, floor: 1 }],
  };
}

const enc = new TextEncoder();
// 台本の1件: {sse, headers} か {status, json, headers} か {reject: Error} か {hang: true}
function fakeFetch(script) {
  const calls = [];
  const fn = (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body, raw: init.body });
    const s = script[calls.length - 1];
    if (!s) return Promise.reject(new Error('台本に無い呼び出し'));
    if (s.reject) return Promise.reject(s.reject);
    if (s.hang) {
      return new Promise((resolve, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    const headers = Object.assign({ 'x-chat-ticket': 'T' + calls.length, 'x-chat-rounds-left': String(8 - calls.length) }, s.headers || {});
    const get = (k) => (Object.prototype.hasOwnProperty.call(headers, k.toLowerCase()) ? headers[k.toLowerCase()] : null);
    if (s.json) {
      return Promise.resolve({ ok: false, status: s.status, headers: { get }, json: () => Promise.resolve(s.json), text: () => Promise.resolve(JSON.stringify(s.json)) });
    }
    const bytes = enc.encode(s.sse);
    let pos = 0;
    const reader = {
      read: () => {
        if (pos >= bytes.length) return Promise.resolve({ done: true });
        const chunk = bytes.slice(pos, pos + 17); pos += 17;
        return Promise.resolve({ done: false, value: chunk });
      },
      cancel: () => Promise.resolve(),
    };
    return Promise.resolve({ ok: true, status: 200, headers: { get }, body: { getReader: () => reader } });
  };
  fn.calls = calls;
  return fn;
}

function makeSession(script, over) {
  const fetch = fakeFetch(script);
  const events = [];
  const applied = [];
  let plan = basePlan();
  const tools = {
    checkArgs: Catalog.checkArgs,
    applyOperations: (p, ops, ctx) => { applied.push(ops[0].op); return O.applyOperations(p, ops, ctx); },
    inspectPlan: (p) => ({ ok: true, errors: [], warnings: ['部屋が ' + p.rooms.length + ' つ'] }),
    clonePlan: O.clonePlan,
  };
  const s = Session.create(Object.assign({
    fetch, getPlan: () => plan, ctxFor: makeCtx, tools,
    summarize: (p) => '部屋 ' + p.rooms.length,
    onEvent: (ev) => events.push(ev),
    AbortController,
  }, over || {}));
  return { s, fetch, events, applied, getPlan: () => plan, setPlan: (p) => { plan = p; } };
}

const TOOL = (id, name, input) => ({ type: 'tool_use', id, name, input });
const THINK = { type: 'thinking', thinking: '部屋を足す', signature: 'c2lnbmF0dXJl' };

// 毎回: 前の呼び出しの messages が今回の先頭にそのまま入っている。件数が増えている。
// 受け取った assistant の content が1バイトも変わらず次に入っている。user は text と tool_result(中身は文字列)だけ。
function checkChain(calls, sentContents) {
  for (let i = 1; i < calls.length; i++) {
    const prev = JSON.stringify(calls[i - 1].body.messages);
    const now = calls[i].body.messages;
    assert.ok(now.length > calls[i - 1].body.messages.length, '件数が増えている');
    assert.equal(JSON.stringify(now.slice(0, calls[i - 1].body.messages.length)), prev, '前回の messages が先頭にそのまま入っている');
    assert.ok(calls[i].raw.includes(prev.slice(1, -1)), '本文の文字列としても先頭が同じ');
  }
  (sentContents || []).forEach((c, i) => {
    const next = calls[i + 1];
    if (!next) return;
    const assistants = next.body.messages.filter((m) => m.role === 'assistant');
    assert.equal(JSON.stringify(assistants[assistants.length - 1].content), JSON.stringify(c), '受け取った content がそのまま');
  });
  for (const c of calls) {
    for (const m of c.body.messages) {
      if (m.role !== 'user' || typeof m.content === 'string') continue;
      for (const b of m.content) {
        assert.ok(b.type === 'text' || b.type === 'tool_result', 'user のブロックは text か tool_result');
        if (b.type === 'tool_result') assert.equal(typeof b.content, 'string');
      }
    }
  }
}

test('道具1回 → 終わり。写しに当たり、本物のプランは変わらない', async () => {
  const c1 = [THINK, { type: 'text', text: '足します。' }, TOOL('t1', 'addRoom', { name: '書斎', x: 6000, y: 1000, w: 2000, d: 2000 })];
  const c2 = [{ type: 'text', text: '書斎を足しました。' }];
  const { s, fetch, events, getPlan } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }), headers: { 'x-chat-remaining': '5' } }, { sse: sseFor(c2) }]);
  const before = JSON.stringify(getPlan());
  const r = await s.send('書斎を足して');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.changed, 1);
  assert.equal(r.plan.rooms.length, 2);
  assert.equal(r.plan.rooms[1].n, '書斎');
  assert.deepEqual(r.changedIds, [r.plan.rooms[1].id]);
  assert.deepEqual(r.removedIds, []);
  assert.equal(r.text, '書斎を足しました。');
  assert.equal(JSON.stringify(getPlan()), before);
  // 呼び出しの本文
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].url, '/api/ai/chat');
  assert.equal(fetch.calls[0].body.ticket, undefined);
  assert.equal(fetch.calls[1].body.ticket, 'T1');
  const first = fetch.calls[0].body.messages;
  assert.equal(first.length, 1);
  assert.equal(first[0].content, '<plan_summary>\n部屋 1\n</plan_summary>\n\n書斎を足して');
  checkChain(fetch.calls, [c1]);
  const tr = fetch.calls[1].body.messages[2].content;
  assert.equal(tr.length, 1);
  assert.equal(tr[0].tool_use_id, 't1');
  assert.equal(tr[0].is_error, undefined);
  assert.deepEqual(JSON.parse(tr[0].content).changedIds, [r.plan.rooms[1].id]);
  // 知らせ
  assert.ok(events.some((e) => e.type === 'round' && e.round === 1));
  assert.ok(events.some((e) => e.type === 'round' && e.round === 2));
  assert.ok(events.some((e) => e.type === 'thinking' && e.delta));
  assert.ok(events.some((e) => e.type === 'text' && e.delta));
  assert.ok(events.some((e) => e.type === 'tool' && e.label === '部屋を足しています' && !/addRoom/.test(e.label)));
  assert.ok(events.some((e) => e.type === 'remaining' && e.left === 5));
  assert.equal(s.history.length, 1);
});

test('道具が失敗 → is_error の結果を返し、次の回で成功', async () => {
  const c1 = [TOOL('t1', 'moveObject', { id: '999', dx: 100, dy: 0 })];
  const c2 = [TOOL('t2', 'moveObject', { id: '10', dx: 100, dy: 0 })];
  const c3 = [{ type: 'text', text: '動かしました。' }];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor(c2, { stop: 'tool_use' }) }, { sse: sseFor(c3) }]);
  const r = await s.send('ソファを東へ');
  assert.equal(r.ok, true);
  assert.equal(r.plan.items[0].x, 1100);
  assert.deepEqual(r.changedIds, [10]);
  const res1 = fetch.calls[1].body.messages[2].content[0];
  assert.equal(res1.is_error, true);
  assert.match(res1.content, /999/);
  checkChain(fetch.calls, [c1, c2]);
});

test('引数の形が違う(checkArgs)と当てずに is_error', async () => {
  const c1 = [TOOL('t1', 'addRoom', { x: 1, y: 1, w: 1000, d: 1000, color: 'red' })];
  const { s, fetch, applied } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor([{ type: 'text', text: 'できませんでした' }]) }]);
  const r = await s.send('部屋');
  assert.equal(r.ok, true);
  assert.equal(r.changed, 0);
  assert.deepEqual(applied, []);
  const res = fetch.calls[1].body.messages[2].content[0];
  assert.equal(res.is_error, true);
  assert.match(res.content, /color/);
});

test('1回の返事に道具2つ: 結果は1つの user に2つ。1つが失敗しても他は残る', async () => {
  const c1 = [
    { type: 'text', text: '' },
    TOOL('a', 'placeItem', { type: 'kitchen-unit', x: 0, y: 0 }),
    TOOL('b', 'rotateObject', { id: '10', rot: 90 }),
  ];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor([{ type: 'text', text: '回しました' }]) }]);
  const r = await s.send('回して');
  assert.equal(r.ok, true);
  assert.equal(r.plan.items.length, 1);
  assert.equal(r.plan.items[0].rot, 90);
  const msgs = fetch.calls[1].body.messages;
  assert.equal(msgs.length, 3);
  assert.equal(msgs[2].content.length, 2);
  assert.equal(msgs[2].content[0].tool_use_id, 'a');
  assert.equal(msgs[2].content[0].is_error, true);
  assert.equal(msgs[2].content[1].tool_use_id, 'b');
  assert.equal(msgs[2].content[1].is_error, undefined);
  // 空の text ブロックだけは返さない(API が受け付けない)。ほかはそのまま。
  assert.equal(JSON.stringify(msgs[1].content), JSON.stringify(c1.slice(1)));
  checkChain(fetch.calls, [c1.slice(1)]);
});

test('inspect_plan は写しを検査した結果を返す(写しは変えない)', async () => {
  const c1 = [TOOL('t1', 'addRoom', { x: 6000, y: 0, w: 1000, d: 1000 }), TOOL('t2', 'inspect_plan', {})];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', emptyJson: true }) }, { sse: sseFor([{ type: 'text', text: '確かめました' }]) }]);
  const r = await s.send('足して確かめて');
  assert.equal(r.ok, true);
  const res = fetch.calls[1].body.messages[2].content[1];
  assert.equal(res.tool_use_id, 't2');
  assert.deepEqual(JSON.parse(res.content).warnings, ['部屋が 2 つ']);
});

test('知らない道具名は is_error', async () => {
  const c1 = [TOOL('t1', 'dropTable', {})];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', emptyJson: true }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }]);
  await s.send('x');
  const res = fetch.calls[1].body.messages[2].content[0];
  assert.equal(res.is_error, true);
});

for (const stop of ['refusal', 'max_tokens', 'pause_turn']) {
  test(stop + ' では、その回の道具を実行せず失敗で終える(plan は返さない)', async () => {
    const c1 = [TOOL('t1', 'addRoom', { x: 0, y: 0, w: 1000, d: 1000 })];
    const { s, applied, fetch } = makeSession([{ sse: sseFor(c1, { stop }) }]);
    const r = await s.send('部屋');
    assert.equal(r.ok, false);
    assert.equal(r.reason, stop);
    assert.equal(r.plan, undefined);
    assert.ok(r.message && !/[a-z_]{4,}/.test(r.message), '利用者向けの日本語の文: ' + r.message);
    assert.deepEqual(applied, []);
    assert.equal(fetch.calls.length, 1);
    assert.equal(s.history.length, 0);
  });
}

test('HTTP の失敗は code ごとの文で終える(回数切れ・長すぎ・札の期限切れ・その他)', async () => {
  const cases = [
    [429, { error: 'quota_exceeded', code: 'quota_exceeded', message: 'x', scope: 'who' }, 'quota_exceeded', /本日ぶんのチャットを使い切りました。明日またお試しください。/],
    [413, { error: 'too_large', code: 'too_large', message: 'x' }, 'too_large', /チャットを新しく始めて/],
    [401, { error: 'ticket_invalid', code: 'ticket_invalid', message: 'x' }, 'ticket_invalid', /期限/],
    [429, { error: 'rounds_exceeded', code: 'rounds_exceeded', message: 'x' }, 'rounds_exceeded', /回数を超え/],
    [502, { error: 'ai_upstream_error', code: 'ai_upstream_error', message: 'x', status: 500 }, 'ai_upstream_error', /返事を受け取れません/],
    [500, { error: 'something' }, 'http_error', /使えません/],
  ];
  for (const [status, json, reason, re] of cases) {
    const { s } = makeSession([{ status, json }]);
    const r = await s.send('部屋');
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.match(r.message, re);
    assert.equal(r.plan, undefined);
  }
});

test('通信の失敗', async () => {
  const { s } = makeSession([{ reject: new TypeError('Failed to fetch') }]);
  const r = await s.send('部屋');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
  assert.equal(r.plan, undefined);
});

test('SSE の error・途中切れ・壊れた JSON は、例外を出さず失敗で終える', async () => {
  const errSse = sseFor([{ type: 'text', text: '途中' }], { noStop: true }) + eventText('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  const full = sseFor([TOOL('t1', 'addRoom', { x: 1 })], { stop: 'tool_use' });
  const cut = full.slice(0, full.indexOf('event: message_delta'));
  const broken = full.replace('"partial_json":"{\\"x\\":1}"', '"partial_json":"{\\"x\\":"');
  for (const [sse, reason] of [[errSse, 'ai_error'], [cut, 'interrupted'], [broken, 'bad_response']]) {
    const { s, applied } = makeSession([{ sse }]);
    const r = await s.send('部屋');
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.deepEqual(applied, []);
  }
});

test('往復の上限: rounds-left が 0 の返事でさらに道具を呼ばれたら、当てずに失敗で終える', async () => {
  const c = [TOOL('t1', 'rotateObject', { id: '10', by: 10 })];
  const { s, applied, fetch } = makeSession([{ sse: sseFor(c, { stop: 'tool_use' }), headers: { 'x-chat-rounds-left': '0' } }]);
  const r = await s.send('回して');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rounds_exceeded');
  assert.deepEqual(applied, []);
  assert.equal(fetch.calls.length, 1);
});

test('往復の上限: 見出しが無くても 8 回で止める', async () => {
  const script = [];
  for (let i = 0; i < 9; i++) script.push({ sse: sseFor([TOOL('t' + i, 'rotateObject', { id: '10', by: 10 })], { stop: 'tool_use' }), headers: { 'x-chat-rounds-left': null } });
  const { s, fetch, applied } = makeSession(script);
  const r = await s.send('回し続けて');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rounds_exceeded');
  assert.equal(fetch.calls.length, 8);
  assert.equal(applied.length, 7);
  checkChain(fetch.calls);
});

test('cancel(): すぐに取り消しの結果を返し、次の依頼を受けられる', async () => {
  const { s, fetch } = makeSession([{ hang: true }, { sse: sseFor([{ type: 'text', text: 'はい' }]) }]);
  const p = s.send('部屋');
  await new Promise((r) => setTimeout(r, 5));
  s.cancel();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cancelled');
  assert.equal(r.plan, undefined);
  assert.ok(fetch.calls[0].init.signal.aborted);
  assert.equal(s.history.length, 0);
  const r2 = await s.send('もう一度');
  assert.equal(r2.ok, true);
  assert.equal(fetch.calls[1].body.ticket, undefined, '取り消した依頼の札は使わない');
});

test('cancel(): 道具の返事を読んだ直後でも、次を呼ばない', async () => {
  const c1 = [TOOL('t1', 'rotateObject', { id: '10', by: 10 })];
  let session;
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }], {
    onEvent: (ev) => { if (ev.type === 'tool') session.cancel(); },
  });
  session = s;
  const r = await s.send('回して');
  assert.equal(r.reason, 'cancelled');
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(fetch.calls.length, 1);
});

test('実行中にもう一度 send すると断る。空の文も断る', async () => {
  const { s } = makeSession([{ hang: true }]);
  const p = s.send('部屋');
  const r = await s.send('もう1つ');
  assert.equal(r.reason, 'busy');
  s.cancel();
  await p;
  assert.equal((await s.send('   ')).reason, 'empty');
});

test('2回めの依頼: 前の依頼は「利用者の文」と「AI の最後の文」だけを文字で入れる(考え・道具は入れない)', async () => {
  const c1 = [THINK, TOOL('t1', 'rotateObject', { id: '10', by: 90 })];
  const c2 = [{ type: 'text', text: '回しました。' }];
  const c3 = [{ type: 'text', text: 'どちらへ動かしますか？' }];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor(c2) }, { sse: sseFor(c3) }]);
  const r1 = await s.send('ソファを回して');
  assert.equal(r1.ok, true);
  const r2 = await s.send('動かして');
  assert.equal(r2.ok, true);
  assert.equal(r2.changed, 0);
  const msgs = fetch.calls[2].body.messages;
  assert.deepEqual(msgs.slice(0, 2), [{ role: 'user', content: 'ソファを回して' }, { role: 'assistant', content: '回しました。' }]);
  assert.match(msgs[2].content, /^<plan_summary>\n/);
  assert.ok(!JSON.stringify(msgs).includes('thinking'));
  assert.ok(!JSON.stringify(msgs).includes('tool_use'));
  assert.equal(fetch.calls[2].body.ticket, undefined);
  assert.deepEqual(s.history, [{ user: 'ソファを回して', assistant: '回しました。' }, { user: '動かして', assistant: 'どちらへ動かしますか？' }]);
});

test('置いて消した物は removedIds に入れない。元からある物を消せば入る', async () => {
  const c1 = [TOOL('a', 'placeItem', { type: 'chair', x: 0, y: 0 })];
  const c2 = [TOOL('b', 'deleteObjects', { ids: ['501', '10'] })];
  const { s } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use' }) }, { sse: sseFor(c2, { stop: 'tool_use' }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }]);
  const r = await s.send('x');
  assert.equal(r.ok, true);
  assert.deepEqual(r.changedIds, []);
  assert.deepEqual(r.removedIds, [10]);
  assert.equal(r.changed, 1);
});

test('道具の名前と利用者向けの文の表は、操作 10 個と検査をすべて持つ', () => {
  const names = Catalog.OPERATIONS.map((o) => o.name).concat(['inspect_plan']);
  for (const n of names) assert.ok(Session.TOOL_LABELS[n], n);
  // 道具の名前・コード名(英小文字)を利用者に出さない。「AI」は読み取りの文言と同じく使う。
  for (const v of Object.values(Session.TOOL_LABELS)) assert.ok(!/[A-Za-z]/.test(v), v);
  for (const v of Object.values(Session.MESSAGES)) assert.ok(!/[a-z]/.test(v), v);
});

test('グローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/chat/chat-session.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'localStorage', 'PlanCoreOperations', 'itemTypeLabel']) assert.ok(!src.includes(w), w + ' が残っている');
  assert.ok(!/[^.\w]fetch\(/.test(src), 'グローバルの fetch を呼んでいる');
});
