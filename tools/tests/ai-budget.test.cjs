// 月の金額の枠・仮押さえと精算・数えられないときに断る・jev の回数・出どころの確認（worker/ai-budget.mjs・
// worker/ai-price.mjs・worker/ai-quota.mjs）。
//
// 運営者は月 $100 を超えたくない（2026-11 利用者決定）。枠の既定は $80。本物の Claude・OpenAI は呼ばない
// （fetch を偽物にする）。数の持ち主は本物の AiQuota を、偽の storage で動かす。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const KEY = 'sk-test-budget-key';
// 2026-11-20 12:00（日本時間）
const T = Date.UTC(2026, 10, 20, 3, 0, 0);
const realNow = Date.now;
function at(ms) { Date.now = () => ms; }
test.afterEach(() => { Date.now = realNow; });

// 本物の AiQuota を偽の storage で動かす。slow を付けると storage の読み書きのたびに順番を譲る（割り込みを起こす）。
async function realQuota({ slow, seed } = {}) {
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const data = new Map(Object.entries(seed || {}));
  const pause = () => (slow ? new Promise((r) => setImmediate(r)) : Promise.resolve());
  const storage = {
    get: async (keys) => {
      await pause();
      if (Array.isArray(keys)) { const m = new Map(); for (const k of keys) if (data.has(k)) m.set(k, data.get(k)); return m; }
      return data.get(keys);
    },
    put: async (a, b) => { await pause(); if (typeof a === 'string') data.set(a, b); else for (const k of Object.keys(a)) data.set(k, a[k]); },
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

// Claude の偽物。stream なら usage 付きの SSE、そうでなければ usage 付きの返事。
function sse({ input = 1000, output = 2000, cut = false, model = 'claude-opus-5-5' } = {}) {
  const start = `event: message_start\ndata: {"type":"message_start","message":{"model":"${model}","usage":{"input_tokens":${input},"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}}\n\n`;
  const text = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"type\\":\\"message_delta\\"}"}}\n\n';
  if (cut) return start + text;
  return start + text + `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":${output}}}\n\n`
    + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
}
function claude(opts) {
  const sent = [];
  const fetchImpl = async (req) => {
    const text = await req.text();
    const body = JSON.parse(text);
    sent.push(body);
    if (body.stream) return new Response(sse(opts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify({
      model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] }) }],
      usage: { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }), { status: 200 });
  };
  return { sent, fetchImpl };
}

async function callAi(path, body, env, fetchImpl, { headers, host = 'https://example.test' } = {}) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL(host + path);
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(headers || {}) },
    body: JSON.stringify(body),
  });
  return handleAi(request, env, url, { fetchImpl });
}

const ASK = [{ role: 'user', content: '<plan_summary>\n…\n</plan_summary>\n\n<user_request>\nLDK を東へ半間広げて\n</user_request>' }];
function grow(messages, i) {
  const id = 'toolu_' + i;
  return messages.concat([
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'moveObject', input: { id: '12', dx: 910, dy: 0 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '<tool_result>\n{"ok":true}\n</tool_result>' }] },
  ]);
}
const micro = (usd) => Math.ceil(usd * 1e6);

// ── 月の枠 ─────────────────────────────────────────────────────────

test('月の枠に達すると、読み取りもチャットも AI を呼ばずに断る。月が替わると戻る', async () => {
  at(T);
  const q = await realQuota({ seed: { 'usd-month:2026-11': micro(80) - 1000 } });
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = claude();

  const read = await callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl);
  assert.equal(read.status, 429);
  const rb = await read.json();
  assert.equal(rb.error, 'ai_quota_exceeded');
  assert.equal(rb.limit, 'month');
  assert.equal(rb.message, '今月ぶんの AI の受付を終えました。来月1日から再開します。画面の操作では引き続き作れます。');

  const chat = await callAi('/api/ai/chat', { messages: ASK }, env, fetchImpl);
  assert.equal(chat.status, 429);
  const cb = await chat.json();
  assert.equal(cb.error, 'month_exceeded');
  assert.equal(sent.length, 0, '月の枠に達しているのに AI を呼んでいる');

  // 日本時間の 12/1 0時（UTC 11/30 15時）に戻る。
  at(Date.UTC(2026, 10, 30, 15, 0, 1));
  const again = await callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl);
  assert.equal(again.status, 200, '月が替わっても戻らない');
  await again.text();
  assert.equal(sent.length, 1);
});

test('1日の額の上限: 月の残り ÷ 残り日数 × 2 と $8 の小さい方。超えると「本日ぶん」で断る', async () => {
  at(T);  // 11/20。残り 11 日（20日を含む）。$80 × 2 / 11 = $14.5 → $8 が効く
  const q = await realQuota({ seed: { 'usd-day:2026-11-20:2026-11': micro(7.5) } });
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = claude();
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.limit, 'day');
  assert.equal(body.message, '本日ぶんの AI は受付を終えました。明日の朝9時から再開します。画面の操作では引き続き作れます。');
  assert.equal(sent.length, 0);
  // 日本時間の 0〜9 時に断ったときは「明日」ではない（UTC の日付が替わるのは日本時間の朝9時）。
  const { dayLimitMessage } = await mod('worker/ai-budget.mjs');
  assert.equal(dayLimitMessage(Date.UTC(2026, 10, 20, 17, 0)), '本日ぶんの AI は受付を終えました。朝9時から再開します。画面の操作では引き続き作れます。');
});

// ── 仮押さえと精算 ───────────────────────────────────────────────

test('仮押さえ → 精算: 実額が小さければ差が戻る。usage が取れなければ仮押さえのまま', async () => {
  at(T);
  const q = await realQuota();
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, env, claude({ input: 1000, output: 2000 }).fetchImpl);
  assert.equal(res.status, 200);
  const held = q.data.get('usd-month:2026-11');
  assert.ok(held > micro(1), `仮押さえが小さすぎる（${held}）`);
  const text = await res.text();
  assert.ok(text.includes('"message_stop"'), '答えをそのまま流していない');
  // 1,000 × $4 + 2,000 × $20（100万トークンあたり）= $0.044
  assert.equal(q.data.get('usd-month:2026-11'), micro(0.044), '実額に精算されていない');
  assert.equal(q.data.get('usd-day:2026-11-20:2026-11'), micro(0.044));
  assert.equal([...q.data.keys()].filter((k) => k.startsWith('hold:')).length, 0, '精算した仮押さえが残っている');

  // 途中で切れた（message_delta が来ない）→ 仮押さえのまま
  const q2 = await realQuota();
  const res2 = await callAi('/api/ai/read-plan', { images: [PNG] }, { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q2.AI_QUOTA },
    claude({ cut: true }).fetchImpl);
  const before = q2.data.get('usd-month:2026-11');
  await res2.text();
  assert.equal(q2.data.get('usd-month:2026-11'), before, 'usage が分からないのに額を戻している');
});

test('仮押さえ → 精算（まとめて受け取る読み取り）。表に無いモデルは高い単価で数える', async () => {
  at(T);
  const q = await realQuota();
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA, AI_IMPORT_PROVIDER: 'anthropic' };
  await callAi('/api/ai/import-plan', { images: [PNG, PNG] }, env, claude().fetchImpl);
  // 2ページ × (1,000 × $4 + 2,000 × $20) = $0.088
  assert.equal(q.data.get('usd-month:2026-11'), micro(0.088));

  const price = await mod('worker/ai-price.mjs');
  assert.deepEqual(price.priceOf('claude-unknown-9'), price.UNKNOWN_PRICE);
  assert.ok(price.UNKNOWN_PRICE.out >= Math.max(...Object.values(price.PRICES).map((p) => p.out)));
  const usd = price.anthropicUsageUsd({ requested: 'claude-opus-5-5', model: 'claude-fable-5-2', input: 1e6, output: 0 });
  assert.equal(usd, 8, '別のモデルへ切り替わった分を、高い方の単価で数えていない');
});

test('同時に 50 件来ても、枠を超えて通さない', async () => {
  at(T);
  const q = await realQuota({ slow: true });
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA, AI_MONTHLY_BUDGET_USD: '10', AI_DAILY_BUDGET_MAX_USD: '100' };
  const { sent, fetchImpl } = claude();
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl, { headers: { 'cf-connecting-ip': '198.51.100.' + i } })));
  const passed = results.filter((r) => r.status === 200).length;
  assert.ok(passed > 0, '1件も通らない');
  assert.ok(results.every((r) => r.status === 200 || r.status === 429));
  assert.equal(sent.length, passed);
  // 月 $10・残り 11 日 → 1日の額の上限は $10 × 2 / 11 ≒ $1.82（月より先にこちらが効く）。
  const cap = Math.floor(2 * micro(10) / 11);
  const held = q.data.get('usd-month:2026-11');
  assert.ok(held <= cap, `1日の上限 ${cap / 1e6} ドルを超えて仮押さえした（${held / 1e6} ドル）`);
  const one = held / passed;
  assert.ok(held + one > cap, 'まだ入るのに断っている');
  // 断った理由は「本日ぶん」。
  const refused = results.find((r) => r.status === 429);
  assert.equal((await refused.json()).limit, 'day');
});

// ── 数えられないときは断る ───────────────────────────────────────────

const OPENAI_ENV = { OPENAI_API_KEY: 'sk-test-openai', AI_IMPORT_PROVIDER: 'openai' };
function openaiFetch() {
  let n = 0;
  return async (req) => {
    if (req.method === 'POST') return new Response(JSON.stringify({ id: 'resp_' + (++n), status: 'queued' }), { status: 200 });
    return new Response(JSON.stringify({
      id: 'resp_1', status: 'completed', output: [{ content: [{ text: '{"floors":[]}' }] }], usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 });
  };
}

test('数える仕組みが返らない・例外のとき、運営者の費用がかかるすべての入口が AI を呼ばずに断る', async () => {
  at(T);
  // 先に受付番号を作る（plan-result の入口を見るため）。
  const ok = await realQuota();
  const started = await callAi('/api/ai/import-plan', { images: [PNG] }, { ...OPENAI_ENV, AI_QUOTA: ok.AI_QUOTA }, openaiFetch());
  const jobs = (await started.json()).jobs;
  assert.ok(Array.isArray(jobs) && jobs.length === 1);

  const hang = { idFromName: () => 'id', get: () => ({ fetch: () => new Promise(() => {}) }) };
  const boom = { idFromName: () => 'id', get: () => ({ fetch: async () => { throw new Error('down'); } }) };
  for (const AI_QUOTA of [boom, hang]) {
    let called = 0;
    const count = (f) => async (req) => { called++; return f(req); };
    const anth = { ANTHROPIC_API_KEY: KEY, AI_QUOTA };
    const cases = [
      ['/api/ai/read-plan', { images: [PNG] }, anth, claude().fetchImpl],
      ['/api/ai/review-plan-3d', { images: [PNG], shots: [{ image: PNG, label: '1階' }], answer: {} }, anth, claude().fetchImpl],
      ['/api/ai/import-plan', { images: [PNG] }, { ...anth, AI_IMPORT_PROVIDER: 'anthropic' }, claude().fetchImpl],
      ['/api/ai/revise-plan', { images: [PNG], renders: [PNG], pages: [{ floors: [] }] }, { ...anth, AI_IMPORT_PROVIDER: 'anthropic' }, claude().fetchImpl],
      ['/api/ai/import-plan', { images: [PNG] }, { ...OPENAI_ENV, AI_QUOTA }, openaiFetch()],
      ['/api/ai/find-plan', { image: PNG }, { OPENAI_API_KEY: 'sk-test-openai', AI_QUOTA }, openaiFetch()],
      ['/api/ai/chat', { messages: ASK }, anth, claude().fetchImpl],
      ['/api/ai/finish-plan', { rooms: [{ id: 'r0', name: '洋室', w: 3640, d: 3640, kinds: [] }] }, anth, claude().fetchImpl],
      ['/api/ai/plan-result', { jobs }, { ...OPENAI_ENV, AI_QUOTA }, null],
    ];
    const res = await Promise.all(cases.map(([path, body, env, f]) => callAi(path, body, env, count(f || openaiFetch()))));
    for (let i = 0; i < cases.length; i++) {
      assert.equal(res[i].status, 503, `${cases[i][0]} が数えられないのに通した（${res[i].status}）`);
      const b = await res[i].json();
      if (cases[i][0] === '/api/ai/chat') assert.equal(b.error, 'quota_unavailable');
      else assert.equal(b.message, 'いま AI が混み合っています。少し待ってから、もう一度お試しください。');
    }
    // plan-result は結果を取りに行く（費用はかからない）。それ以外は AI を呼ばない。
    assert.ok(called <= 1, `数えられないのに AI を ${called} 回呼んだ`);
  }
});

test('数える仕組みが無いとき: 手元のホストでは通し、本番などのホストでは断る', async () => {
  at(T);
  const { sent, fetchImpl } = claude();
  const env = { ANTHROPIC_API_KEY: KEY };
  const local = await callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl, { host: 'http://127.0.0.1:8787' });
  assert.equal(local.status, 200);
  await local.text();
  const prod = await callAi('/api/ai/read-plan', { images: [PNG] }, env, fetchImpl, { host: 'https://cad-planner.srapps.us' });
  assert.equal(prod.status, 503, '本番で数える仕組みが外れていても通している');
  const preview = await callAi('/api/ai/finish-plan', { rooms: [{ id: 'r0', name: '洋室', w: 1, d: 1, kinds: [] }] }, env, fetchImpl,
    { host: 'https://abc-webcad-planner.someone.workers.dev' });
  assert.equal(preview.status, 503);
  assert.equal(sent.length, 1);
});

// ── チャットの続きの往復 ───────────────────────────────────────────

async function chatRound(env, fetchImpl, ticket, messages) {
  const res = await callAi('/api/ai/chat', ticket ? { ticket, messages } : { messages }, env, fetchImpl);
  if (res.status === 200) await res.clone().text();
  return res;
}

test('チャットの続き: 1依頼の出力の合計（既定 24,000）で止まる。最後の往復は残りの分しか出させない', async () => {
  at(T);
  const q = await realQuota();
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = claude({ input: 500, output: 7000 });
  let messages = ASK;
  let res = await chatRound(env, fetchImpl, null, messages);
  const statuses = [res.status];
  for (let i = 2; i <= 8 && res.status === 200; i++) {
    const ticket = res.headers.get('x-chat-ticket');
    messages = grow(messages, i);
    res = await chatRound(env, fetchImpl, ticket, messages);
    statuses.push(res.status);
  }
  // 7,000 × 3 = 21,000。4回めは残り 3,000 だけ出させ、5回めで止まる。
  assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
  assert.deepEqual(sent.map((b) => b.max_tokens), [8000, 8000, 8000, 3000]);
  assert.equal((await res.json()).error, 'rounds_exceeded');
});

test('チャットの続き: 札を作り変えても通らない。月の枠でも止まる', async () => {
  at(T);
  const q = await realQuota();
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const { sent, fetchImpl } = claude({ input: 500, output: 100 });
  const first = await chatRound(env, fetchImpl, null, ASK);
  const ticket = first.headers.get('x-chat-ticket');
  const [body, sig] = ticket.split('.');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(data.out, 24000, '札に出力の合計の上限が書かれていない');
  const forged = Buffer.from(JSON.stringify({ ...data, out: 10000000, max: 64 })).toString('base64url') + '.' + sig;
  const bad = await chatRound(env, fetchImpl, forged, grow(ASK, 2));
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, 'ticket_invalid');

  q.data.set('usd-month:2026-11', micro(80));
  const month = await chatRound(env, fetchImpl, ticket, grow(ASK, 2));
  assert.equal(month.status, 429);
  assert.equal((await month.json()).error, 'month_exceeded');
  assert.equal(sent.length, 1);
});

// ── jev の窓口の回数 ─────────────────────────────────────────────────

test('jev の窓口（仕上げ）は回数で止まる。普通の読み取り1回の流れ（多くて2回）は止まらない', async () => {
  at(T);
  const q = await realQuota();
  const room = { rooms: [{ id: 'r0', name: '洋室', w: 3640, d: 3640, kinds: [] }] };
  const env = { AI_QUOTA: q.AI_QUOTA };
  for (let i = 0; i < 2; i++) assert.equal((await callAi('/api/ai/finish-plan', room, env, null)).status, 200);
  const tight = { AI_QUOTA: q.AI_QUOTA, AI_JEV_DAILY_PER_USER: '3' };
  assert.equal((await callAi('/api/ai/finish-plan', room, tight, null)).status, 200);
  const over = await callAi('/api/ai/finish-plan', room, tight, null);
  assert.equal(over.status, 429);
  assert.equal((await over.json()).error, 'ai_quota_exceeded');
  // AI の点（読み取り・チャット）とは別に数える。
  assert.equal(q.data.get('total:2026-11-20'), undefined);
  assert.equal(q.data.get('jev-total:2026-11-20'), 3);
});

// ── 出どころ ───────────────────────────────────────────────────────

test('Origin が他サイトなら断り、自サイト・手元・Origin なしは通す', async () => {
  at(T);
  const { sent, fetchImpl } = claude();
  const env = { ANTHROPIC_API_KEY: KEY };
  const go = (origin, path = '/api/ai/read-plan', body = { images: [PNG] }) =>
    callAi(path, body, env, fetchImpl, { headers: origin === undefined ? {} : { origin } });
  for (const bad of ['https://evil.example', 'null', 'https://cad-planner.srapps.us.evil.example']) {
    const res = await go(bad);
    assert.equal(res.status, 403, `${bad} を通している`);
  }
  assert.equal((await go('https://evil.example', '/api/ai/chat', { messages: ASK })).status, 403);
  assert.equal(sent.length, 0);
  for (const fine of [undefined, 'https://cad-planner.srapps.us', 'https://example.test', 'http://localhost:8932', 'http://127.0.0.1:8787']) {
    const res = await go(fine);
    assert.equal(res.status, 200, `${fine} を断っている`);
    await res.text();
  }
});

// ── 古い保存値 ─────────────────────────────────────────────────────

test('古い保存値（月の欄が無い・札に出力の欄が無い）の AiQuota が動く', async () => {
  at(T);
  const ticketId = 'AAAAAAAAAAAAAAAAAAAAAA';
  const q = await realQuota({ seed: {
    'total:2026-11-20': 100, 'who:2026-11-20:203.0.113.7': 21, 'total:2026-11-10': 50,
  } });
  const env = { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA };
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, env, claude().fetchImpl);
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(q.data.get('total:2026-11-20'), 110);
  assert.ok(q.data.get('usd-month:2026-11') > 0);

  // 札の記録に out の無い古い形でも、続きの往復が数えられる。
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const hash = 'a'.repeat(64);
  q.data.set('chat-ticket:' + ticketId, { n: 1, exp: T + 600000, count: 1, hash, bytes: 10 });
  const r = await q.AI_QUOTA.get().fetch('https://ai-quota/ticket?' + new URLSearchParams({
    id: ticketId, exp: String(T + 600000), count: '3', hash: 'b'.repeat(64), bytes: '10', prevCount: '1', prefix: hash,
    max: '8', maxBytes: '1048576', outCap: '24000', want: '8000',
  }));
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.grant, 8000);
  assert.ok(AiQuota);

  // 新しい日の最初の1回で古い日を捨てても、月の額は消さない。
  at(T + 24 * 3600 * 1000);
  const next = await callAi('/api/ai/read-plan', { images: [PNG] }, env, claude().fetchImpl);
  await next.text();
  assert.equal(q.data.has('total:2026-11-10'), false, '古い日の数が残っている');
  assert.ok(q.data.get('usd-month:2026-11') > 0, '月の額まで消した');
});

// ── 本日あと何回 ───────────────────────────────────────────────────

test('/api/ai/quota: 月の枠が尽きたら 0 と月の文。金額の枠で先に止まりうるときは数を出さない。金額は返さない', async () => {
  at(T);
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const peek = async (q, extra) => {
    const url = new URL('https://example.test/api/ai/quota');
    return (await handleAi(new Request(url), { ANTHROPIC_API_KEY: KEY, AI_QUOTA: q.AI_QUOTA, ...extra }, url, {})).json();
  };
  const full = await peek(await realQuota({ seed: { 'usd-month:2026-11': micro(80) } }));
  assert.equal(full.left, 0);
  assert.equal(full.limit, 'month');
  assert.match(full.message, /今月ぶん/);
  const fresh = await peek(await realQuota());
  assert.equal(fresh.left, 2, '金額に余裕があるのに回数を出さない');
  assert.deepEqual(Object.keys(fresh).sort(), ['counted', 'left', 'perUser', 'total']);
  const thin = await peek(await realQuota({ seed: { 'usd-day:2026-11-20:2026-11': micro(6) } }));
  assert.equal(thin.left, null, '金額の枠で先に止まりうるのに回数を出している');
  assert.equal(thin.counted, false);
  for (const v of [full, fresh, thin]) assert.ok(!JSON.stringify(v).match(/usd|dollar/i));
});
