// チャットの受け口 POST /api/ai/chat（worker/chat.mjs）。
//
// 見ているのは次のこと。本物の Claude は呼ばない（fetch を偽物にする）。
//   - Claude へ送る本文の形（道具・システムプロンプト・stream・fallbacks。送ってはいけない欄が無い）
//   - 道具とシステムプロンプトが毎回同じバイト列（プロンプトキャッシュのため）
//   - 回数: 最初の呼び出しで AI_CHAT_POINTS 点。続き（札あり）は数えないが、往復は札の id ごとに 8 回まで
//   - 回数を数えられないときは AI を呼ばずに止める（読み取りは通すが、チャットは止める）
//   - 札の改ざん・期限切れ・別の秘密 → ticket_invalid
//   - 本文の大きさと形、鍵が無い、上流の失敗
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const KEY = 'sk-test-chat-secret-key';
const SSE = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';

// 本物の AiQuota を、偽の storage で動かす（札の回数の数え方まで本物を通す）。
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
  return { data, calls, AI_QUOTA: { idFromName: () => 'id', get: () => stub } };
}

function env(extra) {
  return { ANTHROPIC_API_KEY: KEY, ...extra };
}

function claude(onBody) {
  const sent = [];
  const fetchImpl = async (req) => {
    const text = await req.text();
    sent.push({ url: req.url, headers: req.headers, text, body: JSON.parse(text) });
    if (onBody) return onBody(sent[sent.length - 1]);
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

const ASK = [{ role: 'user', content: 'LDK を東へ 910 広げて' }];

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
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.equal(body.fallbacks, 'default');
  assert.ok(body.output_config && body.output_config.effort, 'effort が無い');
  assert.deepEqual(body.messages, ASK, '受け取った messages を変えて送っている');
  for (const k of ['tool_choice', 'temperature', 'top_p', 'top_k', 'budget_tokens']) {
    assert.equal(k in body, false, `${k} を送っている`);
  }
  assert.equal(JSON.stringify(body).includes('budget_tokens'), false);

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
  assert.match(body.system[0].text, /置ける物の種類/);
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });

  // 札と回数
  const ticket = res.headers.get('x-chat-ticket');
  assert.ok(ticket && ticket.includes('.'), 'x-chat-ticket が無い');
  assert.equal(res.headers.get('x-chat-rounds-left'), '7');
  // 1人1日 126 点、21 点使って 105 点 = あと 5 回
  assert.equal(res.headers.get('x-chat-remaining'), '5');
  const takes = q.calls.filter((u) => new URL(u).pathname === '/take');
  assert.equal(takes.length, 1);
  assert.equal(new URL(takes[0]).searchParams.get('cost'), '21');
  assert.equal(new URL(takes[0]).searchParams.get('who'), '203.0.113.5');
  // 秘密を札に入れていない
  assert.equal(ticket.includes(KEY), false);
  assert.equal(Buffer.from(ticket.split('.')[0], 'base64url').toString().includes(KEY), false);
});

test('点数は AI_CHAT_POINTS で変えられる', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const res = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA, AI_CHAT_POINTS: '10' }), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(new URL(q.calls[0]).searchParams.get('cost'), '10');
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
  // 送った本文の先頭（messages の前まで）がバイト列として同じ
  const head = (s) => s.text.slice(0, s.text.indexOf('"messages"'));
  assert.equal(head(sent[0]), head(sent[1]));
});

test('続きの呼び出し: 回数を使わず、1つの依頼で合計 8 回まで。9 回めは rounds_exceeded', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const first = await chat({ messages: ASK }, e, fetchImpl);
  const ticket = first.headers.get('x-chat-ticket');
  const lefts = [first.headers.get('x-chat-rounds-left')];
  for (let i = 2; i <= 8; i++) {
    const res = await chat({ ticket, messages: ASK }, e, fetchImpl);
    assert.equal(res.status, 200, `${i} 回めが通らない`);
    assert.equal(res.headers.get('x-chat-ticket'), ticket, '続きの呼び出しでも札を返す');
    assert.equal(res.headers.get('x-chat-remaining'), null, '数えていないのに今日の残りを返している');
    lefts.push(res.headers.get('x-chat-rounds-left'));
  }
  assert.deepEqual(lefts, ['7', '6', '5', '4', '3', '2', '1', '0']);
  const ninth = await chat({ ticket, messages: ASK }, e, fetchImpl);
  assert.equal(ninth.status, 429);
  const body = await ninth.json();
  assert.equal(body.error, 'rounds_exceeded');
  assert.equal(body.code, 'rounds_exceeded');
  assert.ok(body.message);
  assert.equal(sent.length, 8, '上限を超えたのに Claude を呼んでいる');
  // 回数（点）を使ったのは最初の1回だけ
  assert.equal(q.calls.filter((u) => new URL(u).pathname === '/take').length, 1);
});

test('期限の過ぎた札の記録は消える', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const first = await chat({ messages: ASK }, e, fetchImpl);
  await chat({ ticket: first.headers.get('x-chat-ticket'), messages: ASK }, e, fetchImpl);
  const keys = () => [...q.data.keys()].filter((k) => String(k).startsWith('chat-ticket:'));
  assert.equal(keys().length, 1);
  // 記録の期限を過去にずらし、別の依頼の続きを呼ぶと、古い記録が消える
  const old = keys()[0];
  q.data.set(old, { ...q.data.get(old), exp: Date.now() - 1000 });
  const second = await chat({ messages: ASK }, e, fetchImpl);
  await chat({ ticket: second.headers.get('x-chat-ticket'), messages: ASK }, e, fetchImpl);
  assert.equal(q.data.has(old), false, '期限の過ぎた札の記録が残っている');
  assert.equal(keys().length, 1);
});

test('日の切り替わりの掃除で、札の記録を消さない', async () => {
  const q = await realQuota();
  const { fetchImpl } = claude();
  const e = env({ AI_QUOTA: q.AI_QUOTA });
  const first = await chat({ messages: ASK }, e, fetchImpl);
  const ticket = first.headers.get('x-chat-ticket');
  await chat({ ticket, messages: ASK }, e, fetchImpl);
  // 今日の数を消して「1日の最初の1回」を起こす（forgetOldDays が走る）
  for (const k of [...q.data.keys()]) if (String(k).startsWith('total:') || String(k).startsWith('who:')) q.data.delete(k);
  await chat({ messages: ASK }, e, fetchImpl);
  const res = await chat({ ticket, messages: ASK }, e, fetchImpl);
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
  const res = await chat({ ticket, messages: ASK }, { ...e, AI_QUOTA: q.AI_QUOTA }, fetchImpl);
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
  const ok = await chat({ ticket, messages: ASK }, env({ CHAT_TICKET_SECRET: 'one', ANTHROPIC_API_KEY: 'other-key', AI_QUOTA: q.AI_QUOTA }), fetchImpl);
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
  const res = await chat({ ticket, messages: ASK }, env({ AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'quota_unavailable');
  const res2 = await chat({ ticket, messages: ASK }, env(), fetchImpl);
  assert.equal(res2.status, 503);
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
  assert.match(body.message, /使い切りました/);
  assert.equal(sent.length, 3);
});

// ── 本文の大きさと形 ───────────────────────────────────────────────

test('本文が 256KB を超えたら too_large（Claude も回数も使わない）', async () => {
  const q = await realQuota();
  const { sent, fetchImpl } = claude();
  const big = { messages: [{ role: 'user', content: 'あ'.repeat(90 * 1024) }] }; // 約 270KB
  const res = await chat(big, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'too_large');
  assert.equal(sent.length, 0);
  assert.equal(q.calls.length, 0);
  // 256KB 以内なら通る（読み取りの約40MBの上限とは別に分けている）
  const ok = await chat({ messages: [{ role: 'user', content: 'a'.repeat(200 * 1024) }] }, env({ AI_QUOTA: q.AI_QUOTA }), fetchImpl);
  assert.equal(ok.status, 200);
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
  // 届かなかったとき
  const { fetchImpl: down } = claude(() => { throw new Error('connect failed ' + KEY); });
  const res2 = await chat({ messages: ASK }, env({ AI_QUOTA: q.AI_QUOTA }), down);
  assert.equal(res2.status, 502);
  const text2 = await res2.text();
  assert.equal(JSON.parse(text2).error, 'ai_upstream_error');
  assert.equal(text2.includes(KEY), false);
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
  assert.match(m.CHAT_SYSTEM, /mm/);
  assert.equal(JSON.stringify(m.chatTools()), JSON.stringify(m.chatTools()));
  assert.equal(m.chatTools().at(-1).name, 'inspect_plan');
});
