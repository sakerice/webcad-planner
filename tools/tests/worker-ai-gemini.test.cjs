// AI の提供元の予備の3番目、Gemini API（worker/gemini.mjs）。
//
// 実物は呼ばない。fetch を差し替えて、どこへ何回送ったかと、費用の枠の確保・精算を見る。
// 見ているのは次のこと。
//   - 順番は Claude → OpenAI → Gemini。各提供元は1依頼につき1回まで。鍵の無い提供元は飛ばす
//   - Gemini は AI_GEMINI_FALLBACK=on のときだけ使う（既定では Google に何も送らない）
//   - 一時的な失敗でだけ次へ進む。入力の誤り（400）・断り（refusal）では進まない
//   - Gemini の分も月・日・1人の枠に数える（別に確保して、usage どおりに精算する）
//   - 3つとも失敗したら、これまでどおりの失敗の文
//   - 答えが流れ始めたあとの失敗では、別の提供元へ回さない（画面に二重に出さない）
//   - 画面の読み取り（read-plan）から回ってきたときは、同じ Claude をもう一度呼ばない
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

async function callAi(path, body, env, fetchImpl) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test' + path);
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  });
  return handleAi(request, env, url, { fetchImpl });
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const ONE_FLOOR = { floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] };
const UPSTREAM_MESSAGE = 'AI から返事を受け取れませんでした。少し待ってから、もう一度お試しください。';

// 本番の鍵（Vertex は「設定として読めていない」ので入れない）。Gemini は既定では使わない。
function env3(extra) {
  return { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oa', GEMINI_API_KEY: 'gm-test', ...(extra || {}) };
}
const ON = { AI_GEMINI_FALLBACK: 'on' };

function withQuota(env, refuseAt) {
  const takes = [], settles = [];
  const stub = {
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === '/settle') {
        settles.push({ hold: u.searchParams.get('hold'), usd: Number(u.searchParams.get('usd')), exact: u.searchParams.get('exact') });
        return new Response(JSON.stringify({ ok: true }));
      }
      takes.push({ cost: Number(u.searchParams.get('cost')), usd: Number(u.searchParams.get('usd')),
        hold: u.searchParams.get('hold'), who: u.searchParams.get('who') });
      if (refuseAt && takes.length === refuseAt) return new Response(JSON.stringify({ ok: false, scope: 'day' }));
      return new Response(JSON.stringify({ ok: true, scope: 'who', limit: 999, remaining: 999, usdLeft: 1e9 }));
    },
  };
  return { env: { ...env, AI_QUOTA: { idFromName: () => 'id', get: () => stub } }, takes, settles };
}

function claudeError(status, type) {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: type } }), { status });
}
function openaiError(status) {
  return new Response(JSON.stringify({ error: { message: 'e' } }), { status });
}
function geminiReply(obj, extra) {
  return new Response(JSON.stringify({
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300, thoughtsTokenCount: 700, totalTokenCount: 3000 },
    modelVersion: 'gemini-4-hydrogen',
    ...(extra || {}),
  }), { status: 200 });
}
function geminiError(status, s) {
  return new Response(JSON.stringify({ error: { code: status, message: s, status: s } }), { status });
}

function router(handlers) {
  const calls = [];
  const seen = [];
  const fn = async (req) => {
    const url = String(req.url);
    if (url.includes('api.anthropic.com')) { calls.push('anthropic'); return handlers.anthropic(req); }
    if (url.includes('generativelanguage.googleapis.com')) {
      calls.push('gemini');
      seen.push({ url, key: req.headers.get('x-goog-api-key'), body: JSON.parse(await req.clone().text()) });
      return handlers.gemini(req);
    }
    if (url.includes('api.openai.com')) {
      calls.push(req.method === 'POST' ? 'openai' : 'openai-get');
      return req.method === 'POST' ? handlers.openai(req) : handlers.openaiGet(req);
    }
    throw new Error('想定外の送り先: ' + url);
  };
  fn.calls = calls;
  fn.seen = seen;
  return fn;
}
const never = (who) => async () => { throw new Error(who + ' は呼ばれてはいけない'); };

async function quiet(run) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { return { value: await run(), lines }; } finally { console.log = orig; }
}

// ── 設定 ─────────────────────────────────────────────────────────
test('Gemini は鍵があっても既定では使わない。AI_GEMINI_FALLBACK=on のときだけ', async () => {
  const { geminiConfig } = await mod('worker/gemini.mjs');
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k' }).usable, false);
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', AI_GEMINI_FALLBACK: 'on' }).usable, true);
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', AI_GEMINI_FALLBACK: 'ON' }).usable, true);
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', AI_GEMINI_FALLBACK: 'yes' }).usable, false, '"on" 以外で有効になる');
  assert.equal(geminiConfig({ AI_GEMINI_FALLBACK: 'on' }).usable, false, '鍵が無いのに使おうとする');
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k' }).model, 'gemini-4-hydrogen');
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.8-flash' }).model, 'gemini-3.8-flash');
});

test('Gemini の単価は公表値で数え、表に無いモデルはいちばん高い単価で数える', async () => {
  const { geminiPriceOf, OTHER_PRICE, holdUsd } = await mod('worker/ai-price.mjs');
  assert.deepEqual({ ...geminiPriceOf('gemini-4-hydrogen') }, { in: 1.5, out: 7.5 });
  assert.equal(geminiPriceOf('gemini-9-unknown').out, OTHER_PRICE.out);
  const g = holdUsd({ gemini: 'gemini-4-hydrogen', inputTokens: 10000, maxOutputTokens: 65536 });
  assert.ok(Math.abs(g - ((12000 * 1.5 + 65536 * 7.5) / 1e6)) < 1e-9, '仮押さえが公表値の計算と合わない: ' + g);
  assert.ok(holdUsd({ gemini: 'gemini-9-unknown', inputTokens: 10000, maxOutputTokens: 65536 }) > g);
});

// ── 読み取り（import-plan） ───────────────────────────────────────
test('Claude が 529・OpenAI が 503 なら Gemini で読み、そのまま間取りを返す。3つとも枠に数える', async () => {
  const { env, takes, settles } = withQuota(env3(ON));
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => openaiError(503),
    gemini: async () => geminiReply(ONE_FLOOR),
  });
  const { value: res, lines } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.plan, '間取りを返していない');
  assert.ok(!JSON.stringify(body).toLowerCase().includes('gemini'), '画面への返事に提供元の名前が入っている');
  assert.deepEqual(f.calls, ['anthropic', 'openai', 'gemini'], '順番か回数が違う');

  // 送り方: 鍵はヘッダ、モデルは既定、JSON で返させる、温度は送らない（新しいモデルでは無視され、将来は 400）。
  const sent = f.seen[0];
  assert.match(sent.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-4-hydrogen:generateContent$/);
  assert.ok(!sent.url.includes('gm-test'), '鍵を URL に入れている');
  assert.equal(sent.key, 'gm-test');
  assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(sent.body.generationConfig.responseJsonSchema.type, 'object');
  assert.equal(sent.body.generationConfig.temperature, undefined);
  const parts = sent.body.contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType, 'image/png');
  assert.ok(sent.body.systemInstruction.parts[0].text.length > 0);

  // 枠: Claude 10点・OpenAI 1点・Gemini 1点を別々に確保し、それぞれ1回だけ精算する。同じ人として数える。
  assert.deepEqual(takes.map((t) => t.cost), [10, 1, 1]);
  assert.equal(new Set(takes.map((t) => t.who)).size, 1);
  assert.deepEqual(settles.map((s) => s.hold), takes.map((t) => t.hold), '精算が抜けた・二重');
  assert.equal(settles[0].usd, 0);
  assert.equal(settles[1].usd, 0);
  // Gemini は usage どおり（入力 2000×$1.5 + 出力 300+思考 700 = 1000×$7.5、100万あたり）。
  assert.equal(settles[2].usd, 10500);
  assert.equal(settles[2].exact, '1');

  const fb = lines.filter((l) => l.includes('"ai_fallback"')).map((l) => JSON.parse(l).ai_fallback);
  assert.deepEqual(fb.map((x) => [x.from, x.to]), [['anthropic', 'openai'], ['openai', 'gemini']]);
  assert.ok(!lines.join('\n').includes('gm-test'), 'ログに鍵が出ている');
});

test('既定（AI_GEMINI_FALLBACK なし）では、鍵があっても Gemini を呼ばない', async () => {
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => openaiError(503),
    gemini: never('Gemini'),
  });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3(), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

test('OpenAI の鍵が無ければ飛ばして Gemini へ', async () => {
  const env = env3(ON);
  delete env.OPENAI_API_KEY;
  const f = router({ anthropic: async () => claudeError(503, 'api_error'), gemini: async () => geminiReply(ONE_FLOOR) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['anthropic', 'gemini']);
});

test('Gemini の鍵が無ければ、on でも呼ばない', async () => {
  const env = env3(ON);
  delete env.GEMINI_API_KEY;
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: async () => openaiError(500) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

test('Claude の鍵が無い環境（OpenAI が先頭）でも、OpenAI が一時的に失敗したら Gemini へ', async () => {
  const env = env3(ON);
  delete env.ANTHROPIC_API_KEY;
  const { env: e, takes, settles } = withQuota(env);
  const f = router({ openai: async () => openaiError(429), gemini: async () => geminiReply(ONE_FLOOR) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, e, f));
  assert.equal(res.status, 200);
  assert.ok((await res.json()).plan);
  assert.deepEqual(f.calls, ['openai', 'gemini']);
  assert.deepEqual(takes.map((t) => t.cost), [10, 1]);
  assert.deepEqual(settles.map((s) => s.hold), takes.map((t) => t.hold));
});

test('Claude が 400（入力の誤り）なら、OpenAI にも Gemini にも回さない', async () => {
  const f = router({ anthropic: async () => claudeError(400, 'invalid_request_error'), openai: never('OpenAI'), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3(ON), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('OpenAI が 400（入力の誤り）なら、Gemini に回さない', async () => {
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: async () => openaiError(400), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3(ON), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

test('3つとも失敗したら、これまでどおりの失敗の文。確保は全部 0 で精算する', async () => {
  const { env, takes, settles } = withQuota(env3(ON));
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => openaiError(500),
    gemini: async () => geminiError(503, 'UNAVAILABLE'),
  });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'ai_upstream_error');
  assert.equal(body.message, UPSTREAM_MESSAGE);
  assert.deepEqual(f.calls, ['anthropic', 'openai', 'gemini'], '同じ提供元を2回呼んでいる');
  assert.deepEqual(settles.map((s) => s.hold), takes.map((t) => t.hold));
  assert.ok(settles.every((s) => s.usd === 0));
});

test('Gemini に届かなかったときも、これまでどおりの失敗の文（例外で落ちない）', async () => {
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => openaiError(500),
    gemini: async () => { throw new TypeError('fetch failed'); },
  });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3(ON), f));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).message, UPSTREAM_MESSAGE);
});

test('Gemini の分が枠に入らなければ、Gemini へ送らない', async () => {
  const { env } = withQuota(env3(ON), 3);
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: async () => openaiError(500), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

test('OpenAI の分が枠に入らなければ、OpenAI へは送らず Gemini を試す（Gemini の分も枠を確かめる）', async () => {
  const { env, takes, settles } = withQuota(env3(ON), 2);
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: never('OpenAI'), gemini: async () => geminiReply(ONE_FLOOR) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['anthropic', 'gemini']);
  assert.equal(takes.length, 3);
  // 断られた確保（2つめ）は精算しない。通った2つだけを1回ずつ精算する。
  assert.deepEqual(settles.map((s) => s.hold), [takes[0].hold, takes[2].hold]);
});

test('Gemini が断った（安全上の理由）ときは失敗の文。費用は usage どおり', async () => {
  const { env, settles } = withQuota(env3(ON));
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => openaiError(500),
    gemini: async () => new Response(JSON.stringify({
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: { promptTokenCount: 1000, totalTokenCount: 1000 },
    }), { status: 200 }),
  });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env, f));
  assert.equal(res.status, 502);
  assert.equal(settles[2].usd, 1500);
});

test('AI_FALLBACK=off なら Gemini にも回さない', async () => {
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: never('OpenAI'), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3({ ...ON, AI_FALLBACK: 'off' }), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('見直し（revise-plan）も Gemini まで回る', async () => {
  const f = router({
    anthropic: async () => claudeError(503, 'api_error'),
    openai: async () => openaiError(502),
    gemini: async () => geminiReply(ONE_FLOOR),
  });
  const { value: res } = await quiet(() => callAi('/api/ai/revise-plan', { images: [PNG], renders: [PNG], pages: [ONE_FLOOR] }, env3(ON), f));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.plan);
  assert.equal(body.revised, true);
  assert.deepEqual(f.calls, ['anthropic', 'openai', 'gemini']);
  // 元の図面が先、描き直した絵が後（2枚とも渡す）。
  assert.equal(f.seen[0].body.contents[0].parts.filter((p) => p.inlineData).length, 2);
});

// ── 画面の読み取り（read-plan）から回ってきたとき ────────────────────
test('read-plan で Claude が 529 なら、Gemini しか無くても 404 で画面をこれまでの読み取りへ回す', async () => {
  const env = env3(ON);
  delete env.OPENAI_API_KEY;
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/read-plan', { images: [PNG] }, env, f));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).fallback, 'import-plan');
});

test('read-plan で Claude が 529 でも、予備が無ければ（OpenAI 無し・Gemini 既定で無効）これまでどおり 502', async () => {
  const env = env3();
  delete env.OPENAI_API_KEY;
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error') });
  const { value: res } = await quiet(() => callAi('/api/ai/read-plan', { images: [PNG] }, env, f));
  assert.equal(res.status, 502);
});

test('read-plan から回ってきた読み取り（after: read-plan）は、Claude をもう一度呼ばずに次から始める', async () => {
  const { env, takes } = withQuota(env3(ON));
  const f = router({ anthropic: never('Claude'), openai: async () => openaiError(503), gemini: async () => geminiReply(ONE_FLOOR) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { images: [PNG], after: 'read-plan' }, env, f));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['openai', 'gemini']);
  // 画面の操作1回ぶんの点は、ここで初めて取る（10点）。予備は1点。
  assert.deepEqual(takes.map((t) => t.cost), [10, 1]);
});

test('after: read-plan でも予備が1つも無ければ、これまでどおり Claude で読む', async () => {
  const env = env3();
  delete env.OPENAI_API_KEY;
  const f = router({
    anthropic: async () => new Response(JSON.stringify({
      id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(ONE_FLOOR) }], stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200 }),
  });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { images: [PNG], after: 'read-plan' }, env, f));
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('答えが流れ始めたあとに Claude が止まっても、別の提供元へ回さない（画面に二重に出さない）', async () => {
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"floors\\""}}\n\n',
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
  ].join('');
  const f = router({
    anthropic: async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    openai: never('OpenAI'), gemini: never('Gemini'),
  });
  const { value: res } = await quiet(async () => {
    const r = await callAi('/api/ai/read-plan', { images: [PNG] }, env3(ON), f);
    const text = await r.text();
    return { status: r.status, text };
  });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('overloaded_error'), '途中の失敗を画面へ流していない');
  assert.deepEqual(f.calls, ['anthropic']);
});

test('組み立てた家の見直し（review-plan-3d）は Gemini にも回さない', async () => {
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error'), openai: never('OpenAI'), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/review-plan-3d',
    { images: [PNG], shots: [{ label: '1階 平面図', image: PNG }], answer: {} }, env3(ON), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

// ── 名指し（鍵が効くかを、Claude を止めずに確かめるため） ─────────────
test('AI_IMPORT_PROVIDER=gemini（と on）なら Gemini だけで読む。予備には回さない', async () => {
  const f = router({ anthropic: never('Claude'), openai: never('OpenAI'), gemini: async () => geminiReply(ONE_FLOOR) });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3({ ...ON, AI_IMPORT_PROVIDER: 'gemini' }), f));
  assert.equal(res.status, 200);
  assert.ok((await res.json()).plan);
  assert.deepEqual(f.calls, ['gemini']);
});

test('AI_IMPORT_PROVIDER=gemini でも AI_GEMINI_FALLBACK=on が無ければ送らない（503）', async () => {
  const f = router({ anthropic: never('Claude'), openai: never('OpenAI'), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/import-plan', { image: PNG }, env3({ AI_IMPORT_PROVIDER: 'gemini' }), f));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ai_not_configured');
  assert.deepEqual(f.calls, []);
});

test('位置探し（find-plan）は Gemini に回さない（失敗しても画面はページ全体で読む）', async () => {
  const f = router({ openai: async () => openaiError(503), gemini: never('Gemini') });
  const { value: res } = await quiet(() => callAi('/api/ai/find-plan', { image: PNG }, env3(ON), f));
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['openai']);
});
