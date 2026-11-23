// AI の提供元が一時的に失敗したとき、別の提供元へ1回だけ切り替える（worker/ai-fallback.mjs）。
//
// 実物は呼ばない。fetch を差し替えて、どこへ何回送ったかと、費用の枠の確保・精算を見る。
// 見ているのは次のこと。
//   - 一時的な失敗（529・5xx・429・401・403・届かない）だけで切り替え、入力の誤り（400）と断り（refusal）では切り替えない
//   - 切り替えは1回まで。切り替え先も失敗したら、これまでどおりのエラー
//   - 切り替え先の費用は別に確保して別に精算する（二重取り・取りっぱなしをしない）
//   - AI_FALLBACK=off と、提供元の名指し（AI_IMPORT_PROVIDER・AI_LOCATE_PROVIDER）では切り替えない
//   - OpenAI へは保存しない（store: false）で送る
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

async function callAi(path, body, env, fetchImpl, headers) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test' + path);
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
  });
  return handleAi(request, env, url, { fetchImpl });
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const ONE_FLOOR = { floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] };

async function makeTestKey() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}
let GOOGLE_JSON;
test('検査用の鍵を用意する', async () => {
  GOOGLE_JSON = JSON.stringify({
    client_email: 'plan-import@example.iam.gserviceaccount.com',
    private_key: await makeTestKey(),
    project_id: 'example-project',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
});

// 本番と同じ3つの鍵。名指しの変数は入っていない。
function prodEnv(extra) {
  return { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oa', GOOGLE_SERVICE_ACCOUNT_JSON: GOOGLE_JSON, ...(extra || {}) };
}

// 数の持ち主（Durable Object）の代わり。確保（/take）と精算（/settle）を覚えておく。
function withQuota(env) {
  const takes = [], settles = [];
  const stub = {
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === '/settle') {
        settles.push({ hold: u.searchParams.get('hold'), usd: Number(u.searchParams.get('usd')), exact: u.searchParams.get('exact') });
        return new Response(JSON.stringify({ ok: true }));
      }
      takes.push({ cost: Number(u.searchParams.get('cost')), usd: Number(u.searchParams.get('usd')), hold: u.searchParams.get('hold') });
      return new Response(JSON.stringify({ ok: true, scope: 'who', limit: 999, remaining: 999, usdLeft: 1e9 }));
    },
  };
  return { env: { ...env, AI_QUOTA: { idFromName: () => 'id', get: () => stub } }, takes, settles };
}

function claudeError(status, type) {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: type } }), { status });
}
function claudeReply(obj, extra) {
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 500 }, ...(extra || {}),
  }), { status: 200 });
}
function openaiDone(obj) {
  return new Response(JSON.stringify({
    id: 'resp_done', status: 'completed', output: [{ content: [{ text: JSON.stringify(obj) }] }],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }), { status: 200 });
}

// 提供元ごとに返事を差し替える。呼ばれた先を順に覚える。
function router(handlers) {
  const calls = [];
  const fn = async (req) => {
    const url = String(req.url);
    if (url.includes('oauth2')) {
      if (handlers.token) return handlers.token(req);
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) { calls.push('anthropic'); return handlers.anthropic(req); }
    if (url.includes('aiplatform.googleapis.com')) { calls.push('vertex'); return handlers.vertex(req); }
    if (url.includes('api.openai.com')) {
      calls.push(req.method === 'POST' ? 'openai' : 'openai-get');
      return req.method === 'POST' ? handlers.openai(req) : handlers.openaiGet(req);
    }
    throw new Error('想定外の送り先: ' + url);
  };
  fn.calls = calls;
  return fn;
}

// console.log に出た切り替えの行を拾う。
async function captureLogs(run) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  try { await run(); } finally { console.log = orig; }
  return lines;
}

// ── 一時的な失敗の見分け方 ───────────────────────────────────────────
test('一時的な失敗だけを切り替えの対象にする', async () => {
  const { transientKind, fallbackEnabled } = await mod('worker/ai-fallback.mjs');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 529 }), 'status_529');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 503 }), 'status_503');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 429 }), 'status_429');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 401 }), 'status_401');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 403 }), 'status_403');
  assert.equal(transientKind({ ok: false, network: true, status: 502 }), 'network');
  assert.equal(transientKind({ ok: false, authFailed: true, unbilled: true, status: 400 }), 'auth');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 400 }), null, '入力の誤りで切り替えている');
  assert.equal(transientKind({ ok: false, unbilled: true, status: 413 }), null);
  assert.equal(transientKind({ ok: false, refused: true, status: 502 }), null, '断られたのに切り替えている');
  assert.equal(transientKind({ ok: false, status: 502, message: 'JSON として読めませんでした' }), null, '2xx で読めなかったものは切り替えない');
  assert.equal(transientKind({ ok: true }), null);
  assert.equal(fallbackEnabled({}), true);
  assert.equal(fallbackEnabled({ AI_FALLBACK: 'off' }), false);
  assert.equal(fallbackEnabled({ AI_FALLBACK: 'OFF' }), false);
});

// ── 読み取り（これまでの読み取り import-plan） ─────────────────────────
test('Claude が 529 を返したら、OpenAI へ投げ直して受付番号を返す（保存しない）', async () => {
  const { env, takes, settles } = withQuota(prodEnv());
  let openaiBody = null;
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async (req) => { openaiBody = JSON.parse(await req.text()); return new Response(JSON.stringify({ id: 'resp_fb', status: 'queued' }), { status: 200 }); },
    openaiGet: async () => openaiDone(ONE_FLOOR),
  });
  let res;
  const logs = await captureLogs(async () => { res = await callAi('/api/ai/import-plan', { image: PNG }, env, f, { 'cf-connecting-ip': '203.0.113.7' }); });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jobs.length, 1, '受付番号を返していない');
  assert.deepEqual(f.calls, ['anthropic', 'openai'], '切り替えは1回だけ');
  assert.equal(openaiBody.model, 'gpt-6-astra', '読み取りの既定のモデルでない');
  assert.equal(openaiBody.store, false, 'OpenAI に保存させている');
  assert.equal(openaiBody.background, true);

  // 費用の枠: Claude ぶんと OpenAI ぶんを別々に確保し、Claude ぶんは 0（上流が 2xx 以外）で精算する。
  assert.equal(takes.length, 2);
  assert.equal(takes[0].cost, 10);
  assert.equal(takes[1].cost, 1, '切り替えで点を余計に取りすぎている');
  assert.ok(takes[1].usd > 0, '切り替え先の費用を確保していない');
  assert.notEqual(takes[0].hold, takes[1].hold);
  assert.deepEqual(settles.map((s) => s.hold), [takes[0].hold], 'Claude ぶんの精算が無い・二重');
  assert.equal(settles[0].usd, 0);

  // 1行のログ。本文・IP は入れない。
  const line = logs.find((l) => l.includes('ai_fallback'));
  assert.ok(line, '切り替えのログが無い');
  assert.deepEqual(JSON.parse(line), { ai_fallback: { route: 'import-plan', from: 'anthropic', to: 'openai', kind: 'status_529' } });
  assert.ok(!logs.join('\n').includes('203.0.113.7'), 'ログに IP が入っている');

  // 受付番号は plan-result で取りに行ける（既定の提供元は Claude のままでも）。
  const got = await callAi('/api/ai/plan-result', { jobs: body.jobs }, env, f);
  assert.equal(got.status, 200);
  const done = await got.json();
  assert.ok(done.plan, '切り替えた読み取りの結果を受け取れない');
});

test('Claude に届かなかった（通信の失敗）ときも切り替える', async () => {
  const f = router({
    anthropic: async () => { throw new TypeError('fetch failed'); },
    openai: async () => new Response(JSON.stringify({ id: 'resp_fb', status: 'queued' }), { status: 200 }),
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, prodEnv(), f);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).jobs);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

test('Claude が 400（入力の誤り）を返したら切り替えない', async () => {
  const f = router({
    anthropic: async () => claudeError(400, 'invalid_request_error'),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, prodEnv(), f);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'ai_upstream_error');
  assert.deepEqual(f.calls, ['anthropic']);
});

test('Claude が断った（refusal）ときは切り替えない', async () => {
  const f = router({
    anthropic: async () => claudeReply({}, { stop_reason: 'refusal' }),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, prodEnv(), f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('切り替え先も失敗したら、これまでどおりのエラー。切り替え先の確保は 0 で精算する', async () => {
  const { env, takes, settles } = withQuota(prodEnv());
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => new Response(JSON.stringify({ error: { message: 'server error' } }), { status: 500 }),
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, env, f);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'ai_upstream_error');
  assert.deepEqual(f.calls, ['anthropic', 'openai'], '2回目の切り替えをしている');
  assert.equal(takes.length, 2);
  // 確保した2つとも、ちょうど1回ずつ精算されている（取りっぱなし・二重の精算が無い）。
  assert.deepEqual(settles.map((s) => s.hold).sort(), takes.map((t) => t.hold).sort());
  assert.ok(settles.every((s) => s.usd === 0), '上流が 2xx 以外なのに費用を残している');
});

test('切り替え先の費用が枠に入らなければ、OpenAI へ送らずにこれまでどおりのエラー', async () => {
  const takes = [];
  const stub = { fetch: async (url) => {
    const u = new URL(url);
    if (u.pathname === '/settle') return new Response(JSON.stringify({ ok: true }));
    takes.push(1);
    // 1回目（Claude ぶん）は通し、2回目（切り替え先）は月の枠で断る。
    return new Response(JSON.stringify(takes.length === 1 ? { ok: true, remaining: 99 } : { ok: false, scope: 'month' }));
  } };
  const env = { ...prodEnv(), AI_QUOTA: { idFromName: () => 'id', get: () => stub } };
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => { throw new Error('枠を超えて送っている'); },
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, env, f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('AI_FALLBACK=off なら切り替えない', async () => {
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, prodEnv({ AI_FALLBACK: 'off' }), f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('AI_IMPORT_PROVIDER で名指ししていれば切り替えない（名指しの振る舞いは変えない）', async () => {
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, prodEnv({ AI_IMPORT_PROVIDER: 'anthropic' }), f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('OpenAI の鍵が無ければ切り替えない', async () => {
  const env = prodEnv();
  delete env.OPENAI_API_KEY;
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error') });
  const res = await callAi('/api/ai/import-plan', { image: PNG }, env, f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

test('見直し（revise-plan）も同じく切り替える', async () => {
  const f = router({
    anthropic: async () => claudeError(503, 'api_error'),
    openai: async () => new Response(JSON.stringify({ id: 'resp_fb', status: 'queued' }), { status: 200 }),
  });
  const res = await callAi('/api/ai/revise-plan', { images: [PNG], renders: [PNG], pages: [ONE_FLOOR] }, prodEnv(), f);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).jobs.length, 1);
  assert.deepEqual(f.calls, ['anthropic', 'openai']);
});

// ── 短い指示の読み取り（read-plan） ─────────────────────────────────
//
// 答えは Claude の流れ（SSE）のまま画面が読むので、OpenAI の答えをこの窓口から返せない。
// 404 を返すと、画面はこれまでの読み取り（import-plan）へ移る。
test('read-plan で Claude が 529 なら、404 で画面をこれまでの読み取りへ回す（OpenAI はここでは呼ばない）', async () => {
  const { env, takes, settles } = withQuota(prodEnv());
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => { throw new Error('ここでは呼ばない'); },
  });
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, env, f);
  assert.equal(res.status, 404, '画面がこれまでの読み取りへ移る合図になっていない');
  const body = await res.json();
  assert.equal(body.fallback, 'import-plan');
  assert.deepEqual(f.calls, ['anthropic']);
  assert.equal(takes.length, 1);
  assert.deepEqual(settles.map((s) => [s.hold, s.usd]), [[takes[0].hold, 0]], '確保を精算していない');
});

test('read-plan で Claude が 400 なら、これまでどおり 502', async () => {
  const f = router({ anthropic: async () => claudeError(400, 'invalid_request_error') });
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, prodEnv(), f);
  assert.equal(res.status, 502);
});

test('read-plan も AI_FALLBACK=off なら、これまでどおり 502', async () => {
  const f = router({ anthropic: async () => claudeError(529, 'overloaded_error') });
  const res = await callAi('/api/ai/read-plan', { images: [PNG] }, prodEnv({ AI_FALLBACK: 'off' }), f);
  assert.equal(res.status, 502);
});

test('見直し（review-plan-3d）は切り替えない（画面は最初の答えを使う）', async () => {
  const f = router({
    anthropic: async () => claudeError(529, 'overloaded_error'),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/review-plan-3d',
    { images: [PNG], shots: [{ label: '1階 平面図', image: PNG }], answer: {} }, prodEnv(), f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['anthropic']);
});

// ── 図面の位置探し（find-plan） ─────────────────────────────────────
const BOX = { found: true, x0: 100, y0: 100, x1: 900, y1: 900 };

test('Vertex が 503 を返したら、OpenAI で1回だけやり直す。費用は両方ぶん精算する', async () => {
  const { env, takes, settles } = withQuota(prodEnv());
  let openaiBody = null;
  const f = router({
    vertex: async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 }),
    openai: async (req) => { openaiBody = JSON.parse(await req.text()); return openaiDone(BOX); },
  });
  let res;
  const logs = await captureLogs(async () => { res = await callAi('/api/ai/find-plan', { image: PNG }, env, f); });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.box, '切り替え先の答えを返していない');
  assert.deepEqual(f.calls, ['vertex', 'openai']);
  assert.equal(openaiBody.store, false);
  assert.equal(openaiBody.model, 'gpt-6-astra');
  assert.equal(takes.length, 2);
  assert.deepEqual(takes.map((t) => t.cost), [1, 1]);
  assert.deepEqual(settles.map((s) => s.hold), takes.map((t) => t.hold), '確保ごとに1回ずつ精算していない');
  assert.equal(settles[0].usd, 0, 'Vertex の失敗（2xx 以外）に費用を残している');
  assert.ok(settles[1].usd > 0, 'OpenAI の実費を精算していない');
  assert.equal(settles[1].exact, '1');
  assert.ok(logs.some((l) => l.includes('"ai_fallback"') && l.includes('find-plan') && l.includes('status_503')));
});

test('Vertex に届かなかったときも切り替える（例外で落ちない）', async () => {
  const f = router({
    vertex: async () => { throw new TypeError('fetch failed'); },
    openai: async () => openaiDone(BOX),
  });
  const res = await callAi('/api/ai/find-plan', { image: PNG }, prodEnv(), f);
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['vertex', 'openai']);
});

test('Vertex の認証が通らないときも切り替える', async () => {
  const f = router({
    token: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    vertex: async () => { throw new Error('トークンが無いのに呼んでいる'); },
    openai: async () => openaiDone(BOX),
  });
  // トークンは使い回されるので（worker/google-auth.mjs）、別の鍵の名前にして取りに行かせる。
  const fresh = JSON.stringify({ ...JSON.parse(GOOGLE_JSON), client_email: 'expired@example.iam.gserviceaccount.com' });
  const res = await callAi('/api/ai/find-plan', { image: PNG }, prodEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: fresh }), f);
  assert.equal(res.status, 200);
  assert.deepEqual(f.calls, ['openai']);
});

test('Vertex が 400 なら切り替えない', async () => {
  const f = router({
    vertex: async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }),
    openai: async () => { throw new Error('呼ばれてはいけない'); },
  });
  const res = await callAi('/api/ai/find-plan', { image: PNG }, prodEnv(), f);
  assert.equal(res.status, 502);
  assert.deepEqual(f.calls, ['vertex']);
});

test('位置探しで両方失敗したら、これまでどおりのエラー（切り替えは1回まで）', async () => {
  const { env, takes, settles } = withQuota(prodEnv());
  const f = router({
    vertex: async () => new Response('{}', { status: 500 }),
    openai: async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 503 }),
  });
  const res = await callAi('/api/ai/find-plan', { image: PNG }, env, f);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'ai_upstream_error');
  assert.deepEqual(f.calls, ['vertex', 'openai']);
  assert.deepEqual(settles.map((s) => s.hold), takes.map((t) => t.hold));
  assert.ok(settles.every((s) => s.usd === 0));
});

test('位置探しも AI_FALLBACK=off・AI_LOCATE_PROVIDER の名指しでは切り替えない', async () => {
  for (const extra of [{ AI_FALLBACK: 'off' }, { AI_LOCATE_PROVIDER: 'vertex' }]) {
    const f = router({
      vertex: async () => new Response('{}', { status: 503 }),
      openai: async () => { throw new Error('呼ばれてはいけない'); },
    });
    const res = await callAi('/api/ai/find-plan', { image: PNG }, prodEnv(extra), f);
    assert.equal(res.status, 502, JSON.stringify(extra));
    assert.deepEqual(f.calls, ['vertex'], JSON.stringify(extra));
  }
});
