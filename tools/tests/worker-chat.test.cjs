// チャットの受け口 POST /api/ai/chat（worker/chat.mjs）。
//
// 見ているのは次のこと。本物の Claude は呼ばない（fetch を偽物にする）。
//   - Claude へ送る本文の形（道具・システムプロンプト・stream・fallbacks。送ってはいけない欄が無い）。
//     偽の Claude は、受け取った本文が API の決まりに合うかを毎回確かめる（apiCheck）
//   - 道具とシステムプロンプトが毎回同じバイト列（プロンプトキャッシュのため）
//   - 回数: 最初の呼び出しで AI_CHAT_POINTS 点。続き（札あり）は点を使わないが、往復は最初を含めて 8 回、
//     札ごとに送った本文の合計は 1MB まで。札は会話に結び付く（前の messages に足しただけの会話だけが通る）
//   - 回数を数えられないときは AI を呼ばずに止める（読み取りは通すが、チャットは止める）
//   - 送れるブロックの種類（画像・PDF・資料・cache_control を断る）と、入れ子の深さ
//   - 札の改ざん・期限切れ・別の秘密 → ticket_invalid
//   - 本文の大きさ（160KB）、鍵が無い、上流の失敗（失敗の返事にも札）
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const KEY = 'sk-test-chat-secret-key';
// usage を載せる（Worker が流しながら拾い、仮押さえを実額で精算する。worker/ai-budget.mjs の meterStream）。
const SSE = 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}\n\n'
  + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":50}}\n\n'
  + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

// 本物の AiQuota を、偽の storage で動かす（札の数え方まで本物を通す）。
async function realQuota() {
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const data = new Map();
  const storage = {
    get: async (keys) => {
      if (Array.isArray(keys)) { const m = new Map(); for (const k of keys) if (data.has(k)) m.set(k, data.get(k)); return m; }
      return data.get(keys);
    },
    put: async (a, b) => { if (typeof a === 'string') data.set(a, b); else for (const k of Object.keys(a)) data.set(k, a[k]); },
    delete: async (keys) => { for (const k of [].concat(keys)) data.delete(k); },
    list: async (opts) => {
      const m = new Map();
      for (const [k, v] of data) if (!opts || !opts.prefix || String(k).startsWith(opts.prefix)) m.set(k, v);
      return m;
    },
  };
  const obj = new AiQuota({ storage }, {});
  const calls = [];
  const stub = { fetch: async (url) => { calls.push(String(url)); return obj.fetch(new Request(String(url))); } };
  const takes = () => calls.filter((u) => new URL(u).pathname === '/take');
  return { data, calls, takes, AI_QUOTA: { idFromName: () => 'id', get: () => stub } };
}

function env(extra) {
  return { ANTHROPIC_API_KEY: KEY, ...extra };
}

// Claude の Messages API の決まりに合うか（偽の Claude が受け取るたびに確かめる）。
function apiCheck(body) {
  for (const k of ['tool_choice', 'temperature', 'top_p', 'top_k']) assert.equal(k in body, false, `${k} を送っている`);
  const text = JSON.stringify(body);
  assert.equal(text.includes('budget_tokens'), false, 'budget_tokens を送っている');
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(JSON.stringify(body.messages).includes('cache_control'), false, 'messages に cache_control がある');
  const marks = (text.match(/"cache_control"/g) || []).length;
  assert.ok(marks <= 4, `キャッシュの印が ${marks} 個（4つまで）`);
  assert.ok(Array.isArray(body.messages) && body.messages.length > 0);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[body.messages.length - 1].role, 'user', 'アシスタントの書き出し（prefill）になっている');
}

function claude(onBody) {
  const sent = [];
  const fetchImpl = async (req) => {
    const text = await req.text();
    const one = { url: req.url, headers: req.headers, text, bytes: Buffer.byteLength(text), body: JSON.parse(text) };
    apiCheck(one.body);
    sent.push(one);
    if (onBody) return onBody(one);
    return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { sent, fetchImpl };
}

async function chat(body, e, fetchImpl, headers) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/chat');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5', ...(headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handleAi(request, e, url, { fetchImpl });
}

// 画面(chat-session.js)が送る形: 要約と依頼を囲み、道具の結果も囲む。この形なら Worker は1バイトも変えずに送る。
const ASK = [{ role: 'user', content: '<plan_summary>\n…\n</plan_summary>\n\n<user_request>\nLDK を東へ半間広げて\n</user_request>' }];

// 画面と同じく、前の messages に Claude の返事と道具の結果を足す。
function grow(messages, i) {
  const id = 'toolu_' + i;
  return messages.concat([
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '考え' + i, signature: 'sig' + i },
      { type: 'tool_use', id, name: 'moveObject', input: { id: '12', dx: 910, dy: 0 } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '<tool_result>\n{"ok":true,"changedIds":["12"]}\n</tool_result>' }] },
  ]);
}

test('最初の呼び出し: 道具とシステムプロンプトを付けて1回だけ呼び、SSE をそのまま返す', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const res = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(await res.text(), SSE, 'Claude の返事をそのまま返していない');
  assert.equal(sent.length, 1);

  const { body, headers, url } = sent[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers.get('x-api-key'), KEY);
  assert.equal(headers.get('anthropic-version'), '2023-06-01');
  assert.equal(headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 8000);
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'medium' }, 'チャットの effort の既定は medium');
  assert.deepEqual(body.messages, ASK, '受け取った messages を変えて送っている');

  // 道具 = 操作の定義 + inspect_plan
  const Catalog = require(join(ROOT, 'assets/js/plan-core/operations-catalog.js'));
  const want = Catalog.OPERATIONS.map((o) => o.name).concat(['inspect_plan']);
  assert.deepEqual(body.tools.map((t) => t.name), want);
  for (const t of body.tools) {
    assert.equal('eager_input_streaming' in t, false, '道具に eager_input_streaming を付けている');
    assert.equal(t.input_schema.type, 'object');
  }
  const inspect = body.tools.find((t) => t.name === 'inspect_plan');
  assert.deepEqual(inspect.input_schema.properties, {});

  // システムプロンプト: 1ブロック、語彙の説明入り、キャッシュの印つき
  assert.ok(Array.isArray(body.system) && body.system.length === 1);
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
  assert.match(body.system[0].text, /house-planner の操作の約束/);
  assert.match(body.system[0].text, /<plan_summary>/);
  assert.match(body.system[0].text, /1820mm|1820 ?mm/);
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });

  // 札と回数
  const ticket = res.headers.get('x-chat-ticket');
  assert.ok(ticket && ticket.includes('.'), 'x-chat-ticket が無い');
  assert.equal(res.headers.get('x-chat-rounds-left'), '7');
  // 1人1日 168 点、21 点使って 147 点 = あと 7 回
  assert.equal(res.headers.get('x-chat-remaining'), '7');
  assert.equal(q.takes().length, 1);
  const take = new URL(q.takes()[0]).searchParams;
  assert.equal(take.get('cost'), '21');
  assert.equal(take.get('who'), '203.0.113.5');
  // 秘密を札に入れていない
  assert.equal(ticket.includes(KEY), false);
  assert.equal(Buffer.from(ticket.split('.')[0], 'base64url').toString().includes(KEY), false);
});

test('チャットの effort は ANTHROPIC_CHAT_EFFORT で変えられ、読み取りの ANTHROPIC_EFFORT は使わない', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA, ANTHROPIC_EFFORT: 'max' }), fetchImpl);
  assert.equal(sent[0].body.output_config.effort, 'medium');
  await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA, ANTHROPIC_CHAT_EFFORT: 'low' }), fetchImpl);
  assert.equal(sent[1].body.output_config.effort, 'low');
});

test('点数は AI_CHAT_POINTS で変えられる', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const res = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA, AI_CHAT_POINTS: '10' }), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(new URL(q.takes()[0]).searchParams.get('cost'), '10');
});

test('2回呼んでも、Claude へ送る system と tools は1バイトも違わない', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  await chat({ messages: ASK }, e, fetchImpl);
  await chat({ messages: [{ role: 'user', content: '別の依頼' }] }, e, fetchImpl);
  const part = (s, key) => JSON.stringify(s.body[key]);
  assert.equal(part(sent[0], 'system'), part(sent[1], 'system'));
  assert.equal(part(sent[0], 'tools'), part(sent[1], 'tools'));
  const head = (s) => s.text.slice(0, s.text.indexOf('"messages"'));
  assert.equal(head(sent[0]), head(sent[1]));
});

// 1つの依頼を、画面と同じやり方（前の messages に足し、最新の札を付ける）で回す。
async function runRounds(e, fetchImpl, rounds, first = ASK) {
  let messages = first;
  const res1 = await chat({ messages }, e, fetchImpl);
  if (res1.status === 200) await res1.clone().text();
  const out = [res1];
  let ticket = res1.headers.get('x-chat-ticket');
  for (let i = 2; i <= rounds; i++) {
    messages = grow(messages, i);
    const res = await chat({ ticket, messages }, e, fetchImpl);
    out.push(res);
    if (res.status !== 200) break;
    // 画面と同じく答えを最後まで読む（読み終えたところで精算され、出力の合計が実際の値に直る）。
    await res.clone().text();
    ticket = res.headers.get('x-chat-ticket');
  }
  return { out, messages, ticket };
}

test('続きの呼び出し: 点を使わず、最初を含めて合計 8 回まで。9 回めは rounds_exceeded', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const { out } = await runRounds(e, fetchImpl, 9);
  assert.deepEqual(out.slice(0, 8).map((r) => r.status), [200, 200, 200, 200, 200, 200, 200, 200]);
  assert.deepEqual(out.slice(0, 8).map((r) => r.headers.get('x-chat-rounds-left')), ['7', '6', '5', '4', '3', '2', '1', '0']);
  for (const r of out.slice(1, 8)) assert.equal(r.headers.get('x-chat-remaining'), null, '数えていないのに今日の残りを返している');
  const ninth = out[8];
  assert.equal(ninth.status, 429);
  const body = await ninth.json();
  assert.equal(body.error, 'rounds_exceeded');
  assert.equal(body.code, 'rounds_exceeded');
  assert.ok(body.message);
  assert.equal(sent.length, 8, '上限を超えたのに Claude を呼んでいる');
  assert.equal(q.takes().length, 1, '点を使ったのは最初の1回だけのはず');
  // 続きの本文は前の本文に足しただけ（プロンプトキャッシュが効く）
  for (let i = 1; i < sent.length; i++) {
    const prev = JSON.stringify(sent[i - 1].body.messages);
    assert.ok(JSON.stringify(sent[i].body.messages).startsWith(prev.slice(0, -1)));
  }
});

// ── 札を会話に結び付ける ─────────────────────────────────────────────

async function startAndContinue(e, fetchImpl) {
  const first = await chat({ messages: ASK }, e, fetchImpl);
  const t1 = first.headers.get('x-chat-ticket');
  const m2 = grow(ASK, 2);
  const second = await chat({ ticket: t1, messages: m2 }, e, fetchImpl);
  assert.equal(second.status, 200);
  return { t1, t2: second.headers.get('x-chat-ticket'), m2 };
}

test('続きで前の会話を書き換えると ticket_invalid（先頭・途中・件数が同じ・減る）', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const { t2, m2 } = await startAndContinue(e, fetchImpl);
  const before = sent.length;
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const firstChanged = clone(grow(m2, 3));
  firstChanged[0].content = '別の会話を始める';
  const midChanged = clone(grow(m2, 3));
  midChanged[1].content[1].input.dx = 1;
  const sameCountChanged = clone(m2);
  sameCountChanged[2].content[0].content = '{"ok":false}';
  const fewer = m2.slice(0, 1);
  const unrelated = grow([{ role: 'user', content: 'まったく別の依頼' }], 3);

  for (const [name, messages] of [['messages[0] を書き換え', firstChanged], ['途中を書き換え', midChanged],
    ['件数が同じで中身が違う', sameCountChanged], ['件数が減る', fewer], ['別の会話', unrelated]]) {
    const res = await chat({ ticket: t2, messages }, e, fetchImpl);
    assert.equal(res.status, 401, name);
    assert.equal((await res.json()).error, 'ticket_invalid', name);
  }
  assert.equal(sent.length, before, '会話が合わないのに Claude を呼んでいる');
  // 正しく足した続きは通る
  const ok = await chat({ ticket: t2, messages: grow(m2, 3) }, e, fetchImpl);
  assert.equal(ok.status, 200);
  assert.equal(q.takes().length, 1);
});

test('古い札（前の回の札）の使い回しは ticket_invalid', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const { t1, m2 } = await startAndContinue(e, fetchImpl);
  // 1回めの札で、2回めと同じ件数の別の続きを作る
  const res = await chat({ ticket: t1, messages: grow(ASK, 9) }, e, fetchImpl);
  assert.equal(res.status, 401);
  const res2 = await chat({ ticket: t1, messages: grow(m2, 3) }, e, fetchImpl);
  assert.equal(res2.status, 401);
});

test('最初の呼び出しで Claude が失敗しても札を返し、同じ本文のやり直しは点を使わずに通る', async () => {
  const q = await realQuota();
  let n = 0;
  const { sent, fetchImpl } = claude(() => (++n === 1
    ? new Response('{"type":"error","error":{"type":"overloaded_error","message":"x"}}', { status: 529 })
    : new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const failed = await chat({ messages: ASK }, e, fetchImpl);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, 'ai_upstream_error');
  const ticket = failed.headers.get('x-chat-ticket');
  assert.ok(ticket, '失敗の返事に札が無い');
  assert.equal(failed.headers.get('x-chat-rounds-left'), '7');
  const retry = await chat({ ticket, messages: ASK }, e, fetchImpl);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('x-chat-rounds-left'), '6', 'やり直しも往復に数える');
  assert.equal(q.takes().length, 1, 'やり直しで点を使った');
  assert.equal(sent.length, 2);
});

test('期限の 60 秒後を過ぎた札の記録は消える（60 秒以内は残る）', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  await chat({ messages: ASK }, e, fetchImpl);
  const keys = () => [...q.data.keys()].filter((k) => String(k).startsWith('chat-ticket:'));
  assert.equal(keys().length, 1);
  const old = keys()[0];
  q.data.set(old, { ...q.data.get(old), exp: Date.now() - 30 * 1000 });
  await chat({ messages: ASK }, e, fetchImpl);
  assert.equal(q.data.has(old), true, '期限の 60 秒以内に消している');
  q.data.set(old, { ...q.data.get(old), exp: Date.now() - 61 * 1000 });
  await chat({ messages: ASK }, e, fetchImpl);
  assert.equal(q.data.has(old), false, '期限の過ぎた札の記録が残っている');
  assert.equal(keys().length, 2);
});

test('日の切り替わりの掃除で、札の記録を消さない', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const { t2, m2 } = await startAndContinue(e, fetchImpl);
  // 今日の数を消して「1日の最初の1回」を起こす（forgetOldDays が走る）
  for (const k of [...q.data.keys()]) if (String(k).startsWith('total:') || String(k).startsWith('who:')) q.data.delete(k);
  await chat({ messages: ASK }, e, fetchImpl);
  const res = await chat({ ticket: t2, messages: grow(m2, 3) }, e, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-chat-rounds-left'), '5', '札の記録が消えて、往復の数が戻った');
});

async function firstTicket(e) {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const res = await chat({ messages: ASK }, { ...e, AI_QUOTA: q.AI_QUOTA }, fetchImpl);
  return { ticket: res.headers.get('x-chat-ticket'), q };
}

async function expectInvalid(ticket, e, q) {
  const { sent, fetchImpl } = claude();
  const res = await chat({ ticket, messages: grow(ASK, 2) }, { ...e, AI_QUOTA: q.AI_QUOTA }, fetchImpl);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'ticket_invalid');
  assert.equal(sent.length, 0, '札が駄目なのに Claude を呼んでいる');
}

test('札を1文字変えると ticket_invalid', async () => {
  const { ticket, q } = await firstTicket(env());
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  await expectInvalid(flip(ticket, 3), env(), q);
  await expectInvalid(flip(ticket, ticket.length - 2), env(), q);
  await expectInvalid('', env(), q);
  await expectInvalid('abc', env(), q);
  await expectInvalid(ticket + 'x', env(), q);
});

test('別の秘密で作った札は ticket_invalid。CHAT_TICKET_SECRET があればそれで署名する', async () => {
  const { ticket, q } = await firstTicket(env({ CHAT_TICKET_SECRET: 'one' }));
  await expectInvalid(ticket, env({ CHAT_TICKET_SECRET: 'two' }), q);
  await expectInvalid(ticket, env(), q);
  const { sent, fetchImpl } = claude();
  const ok = await chat({ ticket, messages: grow(ASK, 2) }, env({ CHAT_TICKET_SECRET: 'one', ANTHROPIC_API_KEY: 'other-key', AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(ok.status, 200, 'Claude の鍵を替えても、札の秘密が同じなら通る');
  assert.equal(sent.length, 1);
});

test('期限の切れた札は ticket_invalid（10分）', async () => {
  const { ticket, q } = await firstTicket(env());
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 10 * 60 * 1000 + 1000;
    await expectInvalid(ticket, env(), q);
  } finally {
    Date.now = realNow;
  }
});

test('札の中身を書き換えて上限を上げても、署名が合わない', async () => {
  const { ticket, q } = await firstTicket(env());
  const [p, sig] = ticket.split('.');
  const data = JSON.parse(Buffer.from(p, 'base64url').toString());
  data.max = 1000;
  const forged = Buffer.from(JSON.stringify(data)).toString('base64url') + '.' + sig;
  await expectInvalid(forged, env(), q);
});

// ── Review Focus 1: 数えられないときは止める ──────────────────────────

test('AI_QUOTA が無い環境では quota_unavailable で、Claude を呼ばない', async () => {
  const { sent, fetchImpl } = claude();
  const res = await chat({ messages: ASK }, env(), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'quota_unavailable');
  assert.equal(sent.length, 0);
});

test('AI_QUOTA の get が例外なら quota_unavailable で、Claude を呼ばない', async () => {
  const { sent, fetchImpl } = claude();
  const AI_QUOTA = { idFromName: () => 'id', get: () => { throw new Error('boom'); } };
  const res = await chat({ messages: ASK }, env({ AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'quota_unavailable');
  assert.equal(sent.length, 0);
});

test('AI_QUOTA の fetch が 5 秒返らなければ quota_unavailable で、Claude を呼ばない', async () => {
  const { sent, fetchImpl } = claude();
  let called;
  const calledP = new Promise((r) => { called = r; });
  const AI_QUOTA = { idFromName: () => 'id', get: () => ({ fetch: () => { called(); return new Promise(() => {}); } }) };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = chat({ messages: ASK }, env({ AI_QUOTA }), fetchImpl);
    // 数を取りに行かずに返ったときも止まらないよう、返事と競わせる
    const first = await Promise.race([calledP.then(() => 'called'), pending.then(() => 'returned')]);
    assert.equal(first, 'called', '回数を取りに行っていない');
    mock.timers.tick(4999);
    await Promise.resolve();
    mock.timers.tick(1);
    const res = await pending;
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'quota_unavailable');
  } finally {
    mock.timers.reset();
  }
  assert.equal(sent.length, 0);
});

test('AI_QUOTA が形の違う返事を返したら quota_unavailable', async () => {
  const { sent, fetchImpl } = claude();
  const AI_QUOTA = { idFromName: () => 'id', get: () => ({ fetch: async () => new Response('oops', { status: 500 }) }) };
  const res = await chat({ messages: ASK }, env({ AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'quota_unavailable');
  assert.equal(sent.length, 0);
});

test('札の回数を数えられないとき（続きの呼び出し）も止める', async () => {
  const { ticket } = await firstTicket(env());
  const { sent, fetchImpl } = claude();
  const AI_QUOTA = { idFromName: () => 'id', get: () => ({ fetch: async () => { throw new Error('down'); } }) };
  const res = await chat({ ticket, messages: grow(ASK, 2) }, env({ AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'quota_unavailable');
  const res2 = await chat({ ticket, messages: grow(ASK, 2) }, env(), fetchImpl);
  assert.equal(res2.status, 503);
  assert.equal(sent.length, 0);
});

test('札の記録が無い（Durable Object が忘れた）ときは ticket_invalid', async () => {
  const { ticket } = await firstTicket(env());
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const res = await chat({ ticket, messages: grow(ASK, 2) }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});

test('今日の回数を使い切ったら quota_exceeded で、Claude を呼ばない', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  // 1人1日 1 回の読み取り = 63 点。チャット 21 点は 3 回まで
  const e = env({ AI_QUOTA: q.AI_QUOTA, AI_DAILY_IMPORTS_PER_USER: '1' });
  for (let i = 0; i < 3; i++) assert.equal((await chat({ messages: ASK }, e, fetchImpl)).status, 200);
  const res = await chat({ messages: ASK }, e, fetchImpl);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, 'quota_exceeded');
  assert.match(body.message, /本日ぶんの AI は受付を終えました。.*9時から再開します。画面の操作では引き続き作れます。/);
  assert.equal(sent.length, 3);
});

// ── 本文の大きさ ───────────────────────────────────────────────────
// 大きい本文は要約の側で作る(依頼の文は 300 字まで)。
const bigAsk = (n) => '<plan_summary>\n' + 'a'.repeat(n) + '\n</plan_summary>\n\n<user_request>\nx\n</user_request>';

test('本文が 160KB を超えたら too_large（Claude も回数も使わない）', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const big = { messages: [{ role: 'user', content: 'a'.repeat(161 * 1024) }] };
  const res = await chat(big, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'too_large');
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0);
  // 依頼の文は 300 字までなので、大きさは要約の側で作る
  const ok = await chat({ messages: [{ role: 'user', content: bigAsk(150 * 1024) }] }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(ok.status, 200, '160KB 以内が通らない');
});

test('札ごとに、Claude へ送った本文の合計が 1MB を超えたら rounds_exceeded', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const { out } = await runRounds(e, fetchImpl, 8, [{ role: 'user', content: bigAsk(140 * 1024) }]);
  const last = out[out.length - 1];
  assert.equal(last.status, 429, '1MB を超えても通っている');
  assert.equal((await last.json()).error, 'rounds_exceeded');
  assert.ok(out.length < 8, '往復の上限より先に、合計の上限で止まるはず');
  const total = sent.reduce((s, x) => s + x.bytes, 0);
  assert.ok(total <= 1024 * 1024, `送った合計 ${total} バイトが 1MB を超えている`);
  assert.ok(total + sent[sent.length - 1].bytes > 1024 * 1024, '上限よりずっと手前で止まっている');
});

// ── 送れるブロックの種類と、入れ子の深さ ───────────────────────────────

const B64 = 'iVBORw0KGgoAAAANSUhEUg==';
const BAD_MESSAGES = {
  'user の image': [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } }, { type: 'text', text: 'これ' }] }],
  'user の document（base64）': [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: B64 } }] }],
  'user の document（url）': [{ role: 'user', content: [{ type: 'document', source: { type: 'url', url: 'https://example.com/a.pdf' } }] }],
  'user の search_result': [{ role: 'user', content: [{ type: 'search_result', source: 'x', title: 't', content: [{ type: 'text', text: 'a' }] }] }],
  'tool_result の中の image': [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'inspect_plan', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } }] }] },
  ],
  'assistant の中の source': [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: [{ type: 'mystery', payload: { deep: { source: { type: 'url', url: 'https://example.com' } } } }] },
    { role: 'user', content: 'b' },
  ],
  'messages の中の cache_control（user）': [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }] }],
  'messages の中の cache_control（assistant の奥）': [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: [{ type: 'text', text: 'b', extra: [{ cache_control: { type: 'ephemeral' } }] }] },
    { role: 'user', content: 'c' },
  ],
  'user の tool_use': [{ role: 'user', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] }],
};

function nest(levels) {
  // messages(1) > message(2) > content(3) > block(4) > … で、合計 levels 段の入れ子にする
  let inner = {};
  for (let i = 0; i < levels - 4; i++) inner = { a: inner };
  return [{ role: 'user', content: 'a' }, { role: 'assistant', content: [inner] }, { role: 'user', content: 'b' }];
}

test('画像・PDF・資料・cache_control を含む会話は bad_request（Claude を呼ばず、点も使わない）', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  for (const [name, messages] of Object.entries(BAD_MESSAGES)) {
    const res = await chat({ messages }, e, fetchImpl);
    assert.equal(res.status, 400, name);
    assert.equal((await res.json()).error, 'bad_request', name);
  }
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0, '断る会話で回数を使っている');
});

test('入れ子は 12 段まで。13 段は bad_request', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  assert.equal((await chat({ messages: nest(12) }, e, fetchImpl)).status, 200, '12 段が通らない');
  const res = await chat({ messages: nest(13) }, e, fetchImpl);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_request');
  assert.equal(sent.length, 1);
  assert.equal(q.takes().length, 1);
});

test('150KB の深い入れ子でも例外が外へ出ず、点も減らない', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const depth = 70 * 1024;
  const raw = '{"messages":[{"role":"user","content":"a"},{"role":"assistant","content":[{"type":"x","v":'
    + '['.repeat(depth) + ']'.repeat(depth) + '}]},{"role":"user","content":"b"}]}';
  assert.ok(raw.length > 140 * 1024 && raw.length < 160 * 1024);
  const res = await chat(raw, e, fetchImpl);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_request');
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0, '点を使っている');
  // 札の続きでも同じ
  const { ticket } = await firstTicket(env());
  const res2 = await chat(raw.replace('{"messages"', `{"ticket":"${ticket}","messages"`), e, fetchImpl);
  assert.equal(res2.status, 400);
});

test('messages の形が違えば bad_request', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const cases = [
    {},
    { messages: 'こんにちは' },
    { messages: [] },
    { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
    { messages: [{ role: 'system', content: 'a' }] },
    { messages: [{ role: 'user' }] },
    { messages: [{ role: 'user', content: 5 }] },
    { messages: [null] },
    { messages: [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }] },
    { ticket: 5, messages: ASK },
  ];
  for (const c of cases) {
    const res = await chat(c, e, fetchImpl);
    assert.equal(res.status, 400, JSON.stringify(c));
    assert.equal((await res.json()).error, 'bad_request');
  }
  const broken = await chat('{"messages": [', e, fetchImpl);
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error, 'bad_request');
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0, '形が違うのに回数を使っている');
});

test('GET は受けない', async () => {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/chat');
  const res = await handleAi(new Request(url), env(), url, {});
  assert.equal(res.status, 405);
});

test('Claude の鍵が無ければ ai_unavailable（回数を使わない）', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const res = await chat({ messages: ASK }, { AI_QUOTA: q.AI_QUOTA, CHAT_TICKET_SECRET: 's' }, fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ai_unavailable');
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0);
});

test('Claude が失敗したら ai_upstream_error。上流の本文も鍵も出さない', async () => {
  const q = await realQuota();
  const upstream = JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'secret detail ' + KEY } });
  const { fetchImpl } = claude(() => new Response(upstream, { status: 500 }));
  const res = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 502);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.error, 'ai_upstream_error');
  assert.equal(body.status, 500);
  assert.equal(text.includes(KEY), false, '鍵が出ている');
  assert.equal(text.includes('secret detail'), false, '上流の本文が出ている');
  const { fetchImpl: down } = claude(() => { throw new Error('connect failed ' + KEY); });
  const res2 = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA }), down);
  assert.equal(res2.status, 502);
  const text2 = await res2.text();
  assert.equal(JSON.parse(text2).error, 'ai_upstream_error');
  assert.equal(text2.includes(KEY), false);
  assert.ok(res2.headers.get('x-chat-ticket'));
});

test('ルーター経由でも /api/ai/chat に届く', async () => {
  const { default: router } = await mod('worker/router.mjs');
  const res = await router.fetch(new Request('https://example.test/api/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[]}',
  }), env());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_request');
});

test('chat.mjs が出すもの: CHAT_SYSTEM・chatTools()', async () => {
  const m = await mod('worker/chat.mjs');
  assert.equal(typeof m.handleChat, 'function');
  assert.equal(typeof m.CHAT_SYSTEM, 'string');
  assert.match(m.CHAT_SYSTEM, /<plan_summary>/);
  assert.match(m.CHAT_SYSTEM, /8 回/);
  assert.match(m.CHAT_SYSTEM, /半間は 910mm/);
  assert.equal(JSON.stringify(m.chatTools()), JSON.stringify(m.chatTools()));
  assert.equal(m.chatTools().at(-1).name, 'inspect_plan');
});

test('本文の文字列は JSON.stringify(buildConversationRequest(...)) と同じ', async () => {
  const a = await mod('worker/anthropic.mjs');
  const m = await mod('worker/chat.mjs');
  const messages = grow(ASK, 2);
  const config = { model: 'claude-opus-5-5', effort: 'medium' };
  const viaText = a.conversationBodyText({ config, system: m.chatSystem(), tools: m.chatTools(), messagesJson: JSON.stringify(messages) });
  const viaObj = JSON.stringify(a.buildConversationRequest({ config, system: m.chatSystem(), tools: m.chatTools(), messages }));
  assert.equal(viaText, viaObj);
});

// ── 依頼の文の長さ(1件 300 字。文字=コードポイントで数える) ──────────────
test('依頼の文は 300 字まで。301 字は 400(Claude も回数も使わない)。絵文字は1字。古い形・前の依頼にも効く', async () => {
  const wrap = (t) => '<plan_summary>\n要約\n</plan_summary>\n\n<user_request>\n' + t + '\n</user_request>';
  const cases = [
    ['300字', [{ role: 'user', content: wrap('あ'.repeat(300)) }], 200],
    ['絵文字300個', [{ role: 'user', content: wrap('😀'.repeat(300)) }], 200],
    ['301字', [{ role: 'user', content: wrap('あ'.repeat(301)) }], 400],
    ['絵文字301個', [{ role: 'user', content: wrap('😀'.repeat(301)) }], 400],
    ['古い形 300字', [{ role: 'user', content: '<plan_summary>\n' + 'い'.repeat(3000) + '\n</plan_summary>\n\n' + 'あ'.repeat(300) }], 200],
    ['古い形 301字', [{ role: 'user', content: '<plan_summary>\n要約\n</plan_summary>\n\n' + 'あ'.repeat(301) }], 400],
    ['囲みなし 301字', [{ role: 'user', content: 'あ'.repeat(301) }], 400],
    ['text ブロック 301字', [{ role: 'user', content: [{ type: 'text', text: 'あ'.repeat(301) }] }], 400],
    ['前の依頼 301字', [{ role: 'user', content: '<user_request>\n' + 'あ'.repeat(301) + '\n</user_request>' }, { role: 'assistant', content: 'はい' }, { role: 'user', content: wrap('次') }], 400],
  ];
  for (const [name, messages, want] of cases) {
    const q = await realQuota();
    const { sent, fetchImpl } = claude();
    const res = await chat({ messages }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
    assert.equal(res.status, want, name);
    if (want === 400) {
      const body = await res.json();
      assert.equal(body.code, 'request_too_long', name);
      assert.equal(body.message, '頼む文は300字までにしてください。', name);
      assert.equal(sent.length, 0, name + ': Claude を呼んだ');
      assert.equal(q.calls.length, 0, name + ': 回数を数えた');
    }
  }
  // 道具の結果は依頼の文ではないので、この上限では見ない(本文の上限だけ)
  const q = await realQuota();
  const { fetchImpl } = claude();
  const long = [{ role: 'user', content: wrap('x') }, { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'inspect_plan', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '<tool_result>\n' + 'a'.repeat(3000) + '\n</tool_result>' }] }];
  assert.equal((await chat({ messages: long }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl)).status, 200);
});
