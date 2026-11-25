// /api/* の CORS(worker/cors.mjs と worker/router.mjs のつなぎ)。
//
// 見ていること:
//   - 許した別の出どころ(iPhone のアプリ版 capacitor://localhost・本番・手元の開発)にだけ、送られた Origin を返す。`*` は返さない。
//   - 事前の問い合わせ(OPTIONS)はルートに渡さずに返す(AI の数え方に触らない)。
//   - 許していない出どころ・Origin なし・同じ出どころ(Web 版)は、今までと同じ応答(CORS の見出しなし、断る所は断ったまま)。
//   - /api/mcp には付けない(ブラウザに読ませない口)。
// 本物の Worker での届き方は tools/tests/security-headers.browser.mjs が見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const SELF = 'https://cad-planner.srapps.us';
const APP = 'capacitor://localhost';
const EVIL = 'https://evil.example';

// 呼ばれたら落とす束縛。事前の問い合わせや、断るべき要求が中まで届いていないことを見る。
function trapEnv() {
  const calls = [];
  const trap = (name) => new Proxy({}, { get(_, k) { calls.push(name + '.' + String(k)); throw new Error('呼ばれてはいけない: ' + name); } });
  return { env: { AI_QUOTA: trap('AI_QUOTA'), ROOMS: trap('ROOMS'), PLANS: trap('PLANS') }, calls };
}

async function call(method, path, { origin, preflight, body, env } = {}) {
  const { default: router } = await mod('worker/router.mjs');
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (preflight) { headers['access-control-request-method'] = 'POST'; headers['access-control-request-headers'] = 'content-type'; }
  if (body !== undefined) headers['content-type'] = 'application/json';
  return router.fetch(new Request(SELF + path, { method, headers, body }), env || {});
}

const acao = (r) => r.headers.get('access-control-allow-origin');

test('許した出どころの事前の問い合わせは、ルートに渡さず 204 で許可を返す', async () => {
  for (const origin of [APP, 'http://localhost:5173', 'http://127.0.0.1:8932']) {
    for (const p of ['/api/rooms', '/api/rooms/AbCdEfGhIjKlMnOpQrStUv/update', '/api/ai/chat', '/api/ai/read-plan', '/api/csp-report']) {
      const { env, calls } = trapEnv();
      const r = await call('OPTIONS', p, { origin, preflight: true, env });
      assert.equal(r.status, 204, `${origin} ${p}`);
      assert.equal(acao(r), origin, `${origin} ${p}`);
      assert.equal(r.headers.get('access-control-allow-methods'), 'GET, POST');
      assert.equal(r.headers.get('access-control-allow-headers'), 'content-type');
      assert.equal(r.headers.get('access-control-max-age'), '600');
      assert.equal(r.headers.get('access-control-allow-credentials'), null);
      assert.equal(r.headers.get('vary'), 'Origin');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(calls, [], `${p} の事前の問い合わせが中まで届いた`);
    }
  }
});

test('許していない出どころ・Origin なし・同じ出どころの事前の問い合わせは、今までどおりルートへ渡り、許可を返さない', async () => {
  for (const origin of [EVIL, 'null', 'http://evil.localhost.example.com', 'capacitor://evil', undefined, SELF]) {
    const r = await call('OPTIONS', '/api/ai/chat', { origin, preflight: true });
    assert.equal(r.status, 405, String(origin));
    assert.equal(acao(r), null, String(origin));
    assert.equal(r.headers.get('access-control-allow-methods'), null, String(origin));
    const nf = await call('OPTIONS', '/api/nothing', { origin, preflight: true });
    assert.equal(nf.status, 404, String(origin));
    assert.equal(acao(nf), null, String(origin));
  }
});

test('許した出どころの通常の要求には、送られた Origin と読ませる見出しの一覧を付ける(`*` にしない)', async () => {
  const r = await call('GET', '/api/nothing', { origin: APP });
  assert.equal(r.status, 404);
  assert.equal(acao(r), APP);
  assert.notEqual(acao(r), '*');
  assert.equal(r.headers.get('vary'), 'Origin');
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  for (const h of ['x-room-version', 'x-room-expires-at', 'x-room-saved-at', 'x-chat-ticket', 'x-chat-rounds-left', 'x-chat-remaining']) {
    assert.match(r.headers.get('access-control-expose-headers') || '', new RegExp('(^|, )' + h + '(,|$)'), h);
  }
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');

  const csp = await call('POST', '/api/csp-report', { origin: APP, body: '[]' });
  assert.equal(csp.status, 204);
  assert.equal(acao(csp), APP);
});

test('アプリの出どころからの AI の呼び出しは、見出しが付くだけで、数える仕組みの判断はそのまま', async () => {
  // 数える仕組みが無く、手元のホストでもないので、今までどおり断る(AI は呼ばない)。CORS の見出しはアプリが断りの文を読めるよう付く。
  const r = await call('POST', '/api/ai/chat', { origin: APP, body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }) });
  assert.ok(r.status >= 400, '数える仕組みが無いのに通った: ' + r.status);
  assert.equal(acao(r), APP);
});

test('許していない出どころの AI の呼び出しは、今までどおり 403 で、CORS も付かない', async () => {
  const { env, calls } = trapEnv();
  const r = await call('POST', '/api/ai/chat', { origin: EVIL, body: '{}', env });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'forbidden_origin');
  assert.equal(acao(r), null);
  assert.equal(r.headers.get('access-control-expose-headers'), null);
  assert.equal(r.headers.get('vary'), null);
  assert.deepEqual(calls, []);
});

test('Origin なし・同じ出どころ(Web 版)の応答には何も足さない', async () => {
  for (const origin of [undefined, SELF]) {
    const r = await call('POST', '/api/csp-report', { origin, body: '[]' });
    assert.equal(r.status, 204);
    assert.equal(acao(r), null, String(origin));
    assert.equal(r.headers.get('access-control-expose-headers'), null, String(origin));
    assert.equal(r.headers.get('vary'), null, String(origin));
  }
});

test('/api/mcp には、どの出どころでも CORS を付けない(OPTIONS も今までどおり断る)', async () => {
  for (const origin of [APP, 'https://claude.ai', EVIL]) {
    const pre = await call('OPTIONS', '/api/mcp', { origin, preflight: true });
    assert.notEqual(pre.status, 204, origin);
    assert.equal(acao(pre), null, origin);
    const r = await call('POST', '/api/mcp', { origin, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    assert.equal(acao(r), null, origin);
  }
  // 外の AI のサーバー(Origin なし)は今までどおり通る
  const ok = await call('POST', '/api/mcp', { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(ok.status, 200);
  assert.equal(acao(ok), null);
});

test('Durable Object の応答(見出しを書き換えられない)にも写しを作って付け、WebSocket の切り替えはそのまま返す', async () => {
  const { withCors } = await mod('worker/cors.mjs');
  const locked = Response.redirect(SELF + '/', 302);
  assert.throws(() => locked.headers.set('x', '1'), '検査の前提: この応答の見出しは書き換えられない');
  const copy = withCors(locked, APP);
  assert.equal(acao(copy), APP);
  assert.equal(copy.status, 302);

  const ws = new Response(null, { status: 200 });
  Object.defineProperty(ws, 'webSocket', { value: {} });
  assert.equal(withCors(ws, APP), ws);
  assert.equal(acao(ws), null);

  const withVary = new Response('', { headers: { vary: 'Accept-Encoding' } });
  assert.equal(withCors(withVary, APP).headers.get('vary'), 'Accept-Encoding, Origin');
  assert.equal(withCors(new Response(''), null).headers.get('access-control-allow-origin'), null);
});

test('流す応答(SSE)は、中身と種類をそのまま流し、見出しだけ足す(書き換えられない応答の写しでも)', async () => {
  const { withCors } = await mod('worker/cors.mjs');
  const sse = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: a\n\n')); c.enqueue(new TextEncoder().encode('data: b\n\n')); c.close(); } }),
    { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-chat-ticket': 't' } });
  const plain = withCors(sse(), APP);
  assert.equal(acao(plain), APP);
  assert.equal(plain.headers.get('content-type'), 'text/event-stream');
  assert.equal(await plain.text(), 'data: a\n\ndata: b\n\n');
  // fetch で受けた応答(Durable Object から返る形)は見出しを書き換えられない
  const locked = sse();
  Object.defineProperty(locked, 'headers', { value: new Proxy(locked.headers, { get(t, k) { if (k === 'set') return () => { throw new TypeError('immutable'); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }) });
  const copy = withCors(locked, APP);
  assert.notEqual(copy, locked);
  assert.equal(acao(copy), APP);
  assert.equal(copy.headers.get('content-type'), 'text/event-stream');
  assert.equal(copy.headers.get('x-chat-ticket'), 't');
  assert.equal(await copy.text(), 'data: a\n\ndata: b\n\n');
});
