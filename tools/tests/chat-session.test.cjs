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
    if (s.delay) {
      const bodyObj = { cancelled: 0, cancel: () => { bodyObj.cancelled++; return Promise.resolve(); }, getReader: () => ({ read: () => Promise.resolve({ done: true }), cancel: () => Promise.resolve() }) };
      s.bodyObj = bodyObj;
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200, headers: { get: () => null }, body: bodyObj }), s.delay));
    }
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
  return { s, fetch, events, applied, tools, getPlan: () => plan, setPlan: (p) => { plan = p; } };
}

const TOOL = (id, name, input) => ({ type: 'tool_use', id, name, input });
// 囲み(<tag>\n中身\n</tag>)の中身を取り出す。形が違えば落とす。
function inner(text, tag) {
  const m = /^<([a-z_]+)>\n([\s\S]*)\n<\/([a-z_]+)>$/.exec(text);
  assert.ok(m && m[1] === m[3], '囲みの形でない: ' + text.slice(0, 80));
  if (tag) assert.equal(m[1], tag);
  return m[2];
}
const userRequest = (text) => '<user_request>\n' + text + '\n</user_request>';
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
  assert.equal(first[0].content, '<plan_summary>\n部屋 1\n</plan_summary>\n\n<user_request>\n書斎を足して\n</user_request>');
  checkChain(fetch.calls, [c1]);
  const tr = fetch.calls[1].body.messages[2].content;
  assert.equal(tr.length, 1);
  assert.equal(tr[0].tool_use_id, 't1');
  assert.equal(tr[0].is_error, undefined);
  assert.deepEqual(JSON.parse(inner(tr[0].content, 'tool_result')).changedIds, [r.plan.rooms[1].id]);
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
  assert.deepEqual(JSON.parse(inner(res.content, 'inspect_result')).warnings, ['部屋が 2 つ']);
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
    [429, { error: 'quota_exceeded', code: 'quota_exceeded', message: 'x', scope: 'who' }, 'quota_exceeded', /^本日ぶんの AI は受付を終えました。(明日の)?朝9時から再開します。画面の操作では引き続き作れます。$/],
    [429, { error: 'month_exceeded', code: 'month_exceeded', message: 'x' }, 'month_exceeded', /^今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。$/],
    [503, { error: 'quota_unavailable', code: 'quota_unavailable', message: 'x' }, 'quota_unavailable', /^いま AI が混み合っています。少し待ってから、もう一度お試しください。$/],
    [413, { error: 'too_large', code: 'too_large', message: 'x' }, 'too_large', /チャットを新しく始めて/],
    [401, { error: 'ticket_invalid', code: 'ticket_invalid', message: 'x' }, 'ticket_invalid', /期限/],
    [429, { error: 'rounds_exceeded', code: 'rounds_exceeded', message: 'x' }, 'rounds_exceeded', /回数を超え/],
    [502, { error: 'ai_upstream_error', code: 'ai_upstream_error', message: 'x', status: 500 }, 'ai_upstream_error', /返事を受け取れません/],
    [500, { error: 'something' }, 'http_error', /使えません/],
  ];
  for (const [status, json, reason, re] of cases) {
    const { s } = makeSession([{ status, json, headers: { 'x-chat-ticket': null } }]);
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
  assert.deepEqual(msgs.slice(0, 2), [{ role: 'user', content: userRequest('ソファを回して') }, { role: 'assistant', content: '回しました。' }]);
  assert.match(msgs[2].content, /^<plan_summary>\n/);
  assert.ok(!JSON.stringify(msgs).includes('thinking'));
  assert.ok(!JSON.stringify(msgs).includes('tool_use'));
  assert.equal(fetch.calls[2].body.ticket, undefined);
  assert.deepEqual(s.history, [{ user: 'ソファを回して', assistant: '回しました。' }, { user: '動かして', assistant: 'どちらへ動かしますか？' }]);
});

test('forgetLast(): 最後に済んだ依頼を履歴から外し、次の依頼の messages に入れない', async () => {
  const c1 = [{ type: 'text', text: '回しました。' }];
  const c2 = [{ type: 'text', text: '置きました。' }];
  const c3 = [{ type: 'text', text: 'はい。' }];
  const { s, fetch } = makeSession([{ sse: sseFor(c1) }, { sse: sseFor(c2) }, { sse: sseFor(c3) }]);
  assert.equal((await s.send('ソファを回して')).ok, true);
  assert.equal((await s.send('ベッドを置いて')).ok, true);
  s.forgetLast();
  assert.deepEqual(s.history, [{ user: 'ソファを回して', assistant: '回しました。' }]);
  assert.equal((await s.send('次へ')).ok, true);
  const msgs = fetch.calls[2].body.messages;
  assert.equal(msgs.length, 3);
  assert.ok(!JSON.stringify(msgs).includes('置きました'));
  s.forgetLast(); s.forgetLast(); s.forgetLast();
  assert.deepEqual(s.history, []);
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

// ── 送る量の決まり ───────────────────────────────────────────────────

test('前の依頼は直近 6 件まで、文はそれぞれ 400 字までに切る(利用者の文は依頼の上限 300 字なので切れない)', async () => {
  const script = [];
  for (let i = 0; i < 8; i++) script.push({ sse: sseFor([{ type: 'text', text: 'い'.repeat(500) + i }]) });
  const { s, fetch } = makeSession(script);
  for (let i = 0; i < 8; i++) assert.equal((await s.send('あ'.repeat(299) + i)).ok, true);
  const msgs = fetch.calls[7].body.messages;
  assert.equal(msgs.length, 13);
  const u0 = inner(msgs[0].content, 'user_request');
  assert.equal(u0, 'あ'.repeat(299) + '1');   // 前の依頼は直近 6 件(1〜6 回め。0 回めは落ちる)。切れずにそのまま
  assert.equal(msgs[1].content.length, 400);
  assert.ok(msgs[1].content.endsWith('…'));
  // 直近 6 件は 2〜7 回めの依頼(0・1 回めは落ちる)
  assert.equal(fetch.calls[6].body.messages.length, 13);
  assert.ok(msgs[12].content.endsWith(userRequest('あ'.repeat(299) + '7')));
});

test('道具の結果の文は 2,000 字まで。検査の指摘と警告は 10 件ずつ、残りは「ほか N 件」', async () => {
  const c1 = [TOOL('t1', 'inspect_plan', {})];
  const { s, fetch, tools } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', emptyJson: true }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }]);
  tools.inspectPlan = () => ({ ok: false, errors: Array.from({ length: 30 }, (_, i) => 'E' + i), warnings: Array.from({ length: 30 }, (_, i) => 'W' + i + 'う'.repeat(300)) });
  await s.send('確かめて');
  const res = fetch.calls[1].body.messages[2].content[0];
  assert.ok(inner(res.content, 'inspect_result').length <= 2000, '長さ ' + res.content.length);
  assert.ok(res.content.includes('"E9"') && !res.content.includes('"E10"'));
  assert.ok(res.content.includes('ほか 20 件'));
});

test('最初の本文が大きすぎるときは、前の依頼を古い順に落として送る', async () => {
  let big = false;
  const script = [];
  for (let i = 0; i < 7; i++) script.push({ sse: sseFor([{ type: 'text', text: 'い'.repeat(400) }]) });
  const { s, fetch } = makeSession(script, { summarize: () => (big ? 'あ'.repeat(50000) : '小') });
  for (let i = 0; i < 6; i++) await s.send('依頼' + i);
  big = true;
  const r = await s.send('今回');
  assert.equal(r.ok, true);
  const last = fetch.calls[6];
  assert.ok(Buffer.byteLength(last.raw) <= 150 * 1024, 'バイト数 ' + Buffer.byteLength(last.raw));
  assert.ok(last.body.messages.length < 13 && last.body.messages.length >= 1);
  assert.equal(last.body.messages[0].role, 'user');
  assert.ok(last.body.messages[last.body.messages.length - 1].content.endsWith(userRequest('今回')));
  // 落としたのは古い方(残っているのは直近の依頼で、並びはそのまま)
  const users = last.body.messages.filter((m, i) => m.role === 'user' && i < last.body.messages.length - 1).map((m) => m.content);
  const k = users.length;
  assert.ok(k < 6, '落としていない');
  assert.deepEqual(users, ['依頼0', '依頼1', '依頼2', '依頼3', '依頼4', '依頼5'].slice(6 - k).map(userRequest));
});

test('今回の依頼だけで大きすぎれば送らずに too_long', async () => {
  const { s, fetch } = makeSession([], { summarize: () => 'あ'.repeat(60000) });
  const r = await s.send('部屋');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_long');
  assert.match(r.message, /頼みごとが多すぎて/);
  assert.equal(fetch.calls.length, 0);
});

test('続きの本文が大きすぎれば、messages を変えずに too_long で終える(写しは捨てる)', async () => {
  const c1 = [{ type: 'text', text: 'え'.repeat(20000) }, TOOL('t1', 'rotateObject', { id: '10', by: 10 })];
  const { s, fetch } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', textPiece: 5000 }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }],
    { summarize: () => 'あ'.repeat(35000) });
  const r = await s.send('回して');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_long');
  assert.equal(r.plan, undefined);
  assert.equal(fetch.calls.length, 1);
});

// ── 失敗の返事の札でのやり直し ─────────────────────────────────────

test('最初の呼び出しが ai_upstream_error で札があれば、その札で同じ本文を1回だけ送り直す', async () => {
  const fail = { status: 502, json: { error: 'ai_upstream_error', code: 'ai_upstream_error', message: 'x', status: 529 } };
  const { s, fetch } = makeSession([fail, { sse: sseFor([{ type: 'text', text: 'はい' }]) }]);
  const r = await s.send('部屋');
  assert.equal(r.ok, true);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].body.ticket, undefined);
  assert.equal(fetch.calls[1].body.ticket, 'T1');
  assert.equal(JSON.stringify(fetch.calls[1].body.messages), JSON.stringify(fetch.calls[0].body.messages));
  // 2度めも失敗したら終える
  const two = makeSession([fail, fail, { sse: sseFor([{ type: 'text', text: 'はい' }]) }]);
  const r2 = await two.s.send('部屋');
  assert.equal(r2.reason, 'ai_upstream_error');
  assert.equal(two.fetch.calls.length, 2);
  // 札が無ければやり直さない
  const none = makeSession([{ ...fail, headers: { 'x-chat-ticket': null } }]);
  assert.equal((await none.s.send('部屋')).reason, 'ai_upstream_error');
  assert.equal(none.fetch.calls.length, 1);
  // 続きの呼び出しの失敗はやり直さない
  const later = makeSession([{ sse: sseFor([TOOL('t1', 'rotateObject', { id: '10', by: 10 })], { stop: 'tool_use' }) }, fail, { sse: sseFor([{ type: 'text', text: 'x' }]) }]);
  assert.equal((await later.s.send('回して')).reason, 'ai_upstream_error');
  assert.equal(later.fetch.calls.length, 2);
});

// ── 細かい守り ─────────────────────────────────────────────────────

test('道具の名前が constructor などでも、表の引き方で取り違えない', async () => {
  const c1 = [TOOL('t1', 'constructor', {}), TOOL('t2', 'toString', {})];
  const { s, fetch, events } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', emptyJson: true }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }]);
  await s.send('x');
  const res = fetch.calls[1].body.messages[2].content;
  assert.equal(res[0].is_error, true);
  assert.equal(res[1].is_error, true);
  const labels = events.filter((e) => e.type === 'tool').map((e) => e.label);
  assert.deepEqual(labels, ['間取りを直しています', '間取りを直しています']);
});

test('取り消したあとに返事が届いたら、通信を閉じる(AbortController が無くても)', async () => {
  const script = [{ delay: 30 }];
  const { s } = makeSession(script, { AbortController: undefined });
  const p = s.send('部屋');
  await new Promise((r) => setTimeout(r, 5));
  s.cancel();
  assert.equal((await p).reason, 'cancelled');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(script[0].bodyObj.cancelled, 1);
});

test('inspect_plan は ctx の withPlan の中で写しを検査する', async () => {
  const c1 = [TOOL('t1', 'inspect_plan', {})];
  const seen = [];
  const { s, tools } = makeSession([{ sse: sseFor(c1, { stop: 'tool_use', emptyJson: true }) }, { sse: sseFor([{ type: 'text', text: 'x' }]) }], {
    ctxFor: () => Object.assign(makeCtx(), { withPlan: (work, run) => { seen.push({ work, inside: true }); const r = run(); seen.push({ after: true }); return r; } }),
  });
  let insideCall = null;
  tools.inspectPlan = (p) => { insideCall = seen.length === 1 ? p : 'outside'; return { ok: true, errors: [], warnings: [] }; };
  const r = await s.send('確かめて');
  assert.equal(r.ok, true);
  assert.equal(seen.length, 2);
  assert.equal(insideCall, seen[0].work);
  assert.equal(insideCall, r.plan);
});

test('グローバルに触らない', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../assets/js/chat/chat-session.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const w of ['DATA', 'ST.', 'document', 'window.', 'localStorage', 'PlanCoreOperations', 'itemTypeLabel']) assert.ok(!src.includes(w), w + ' が残っている');
  assert.ok(!/[^.\w]fetch\(/.test(src), 'グローバルの fetch を呼んでいる');
});

test('依頼の文は 300 字まで。超えたら送らずに request_too_long(絵文字は1字)', async () => {
  const { s, fetch } = makeSession([{ sse: sseFor([{ type: 'text', text: 'はい' }]) }]);
  const r = await s.send('あ'.repeat(301));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'request_too_long');
  assert.equal(r.message, '頼む文は300字までにしてください。');
  assert.equal(fetch.calls.length, 0);
  assert.equal((await s.send('😀'.repeat(300))).ok, true);
});
