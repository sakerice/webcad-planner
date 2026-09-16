// Worker の振り分けと、AI ルートの入口。
//
// 見ているのは「モデルを呼ぶ前に弾くべきものを弾けているか」と
// 「返ってきたものを検めてから渡しているか」。日本国内から出ないことは
// tools/tests/vertex-region.test.cjs が見る。実物の Vertex AI を叩く確認は
// 鍵が要るので tools/probe_vertex.cjs で行う。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

async function post(path, body, env) {
  const { default: router } = await mod('worker/router.mjs');
  const request = new Request('https://example.test' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return router.fetch(request, env);
}

// AI ルートを直接呼ぶ（fetch を差し替えたいとき）。
async function callAi(path, body, env, fetchImpl) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test' + path);
  const request = new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return handleAi(request, env, url, { fetchImpl });
}

// 1x1 の PNG。中身は問わないので形だけ整っていればよい。
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
// 署名の経路を本物どおり通したいので、検査用の鍵をその場で作る。
// 偽物の文字列だと署名の時点で失敗し、その先(送信内容・応答の扱い)を
// 1件も見られない。
async function makeTestKey() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}
let VERTEX_ENV;
test('検査用の鍵を用意する', async () => {
  VERTEX_ENV = {
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'plan-import@example.iam.gserviceaccount.com',
      private_key: await makeTestKey(),
      project_id: 'example-project',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  };
});

// 署名を通さずに呼び出しの中身を見たいので、トークン窓口の応答も差し替える。
function vertexFetch(onGenerate) {
  return async (req) => {
    if (String(req.url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
    }
    return onGenerate(req);
  };
}

// Vertex AI の generateContent がこの形で返す。
function vertexReply(obj) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 1500, thoughtsTokenCount: 500, totalTokenCount: 4000 },
  }), { status: 200 });
}

const GOOD_PLAN = {
  walls: [
    { x1: 0, y1: 0, x2: 7280, y2: 0, thick: 120, floor: 1 },
    { x1: 7280, y1: 0, x2: 7280, y2: 4095, thick: 120, floor: 1 },
  ],
  rooms: [{ x: 0, y: 0, w: 2730, d: 1820, n: '洋室', floor: 1 }],
  items: [{ type: 'window', x: 1365, y: 0, w: 1690, d: 150, rot: 0, floor: 1 }],
  notes: ['右下の収納は寸法が読めなかった'],
};

// ── 振り分け ──────────────────────────────────────────────────────────
test('/api/ 以外は静的ファイルへ素通しする', async () => {
  const { default: router } = await mod('worker/router.mjs');
  let asked = null;
  const env = { ASSETS: { fetch: (r) => { asked = r.url; return new Response('page'); } } };
  const res = await router.fetch(new Request('https://example.test/index.html'), env);
  assert.equal(await res.text(), 'page');
  assert.match(asked, /index\.html$/);
});

test('知らない /api/ のパスは 404（静的ファイルへ落とさない）', async () => {
  const { default: router } = await mod('worker/router.mjs');
  let assetsCalled = false;
  const env = { ASSETS: { fetch: () => { assetsCalled = true; return new Response('page'); } } };
  const res = await router.fetch(new Request('https://example.test/api/nope'), env);
  assert.equal(res.status, 404);
  assert.equal(assetsCalled, false);
});

test('GET は受けない（AIの呼び出しは副作用も費用もあるので）', async () => {
  const { default: router } = await mod('worker/router.mjs');
  const res = await router.fetch(new Request('https://example.test/api/ai/import-plan'), VERTEX_ENV);
  assert.equal(res.status, 405);
});

// ── 鍵が無いとき ──────────────────────────────────────────────────────
test('Google の鍵が無ければ、間取り読み取りは呼ばずに 503 と手順を返す', async () => {
  const res = await post('/api/ai/import-plan', { image: PNG }, {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'ai_not_configured');
  assert.match(body.message, /wrangler secret/, '何をすればよいかが書いてあること');
});

test('OpenAI の鍵が無ければ、レンダーは呼ばずに 503', async () => {
  const res = await post('/api/ai/render', { image: PNG, prompt: 'x' }, {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'ai_not_configured');
});

test('鍵はどの応答にも出てこない', async () => {
  const env = { ...VERTEX_ENV, OPENAI_API_KEY: 'sk-secret-value' };
  const cases = [
    ['/api/ai/render', { image: PNG, prompt: 'x' }],
    ['/api/ai/import-plan', { image: 'こわれた' }],
  ];
  for (const [path, body] of cases) {
    const text = await (await post(path, body, env)).text();
    assert.ok(!text.includes('secret-value'), path + ' の応答に鍵が混ざっている');
    assert.ok(!text.includes('sk-secret'), path + ' の応答に鍵が混ざっている');
  }
});

// ── 入口の検査 ────────────────────────────────────────────────────────
test('画像が data URL でなければ、モデルを呼ぶ前に 400', async () => {
  let called = false;
  const fetchImpl = vertexFetch(() => { called = true; return vertexReply(GOOD_PLAN); });
  for (const image of [undefined, '', 'https://example.com/a.png', 'data:text/plain;base64,AAAA']) {
    const res = await callAi('/api/ai/import-plan', { image }, VERTEX_ENV, fetchImpl);
    assert.equal(res.status, 400, JSON.stringify(image) + ' が通ってしまった');
  }
  assert.equal(called, false, '弾くべきものでモデルを呼んでいる（お金がかかる）');
});

test('レンダーは指示文が無い・長すぎるものを 400 で弾く', async () => {
  const env = { OPENAI_API_KEY: 'k' };
  assert.equal((await post('/api/ai/render', { image: PNG, prompt: '   ' }, env)).status, 400);
  assert.equal((await post('/api/ai/render', { image: PNG, prompt: 'あ'.repeat(9000) }, env)).status, 400);
});

// ── 国内処理の担保 ────────────────────────────────────────────────────
// 日本国内から出ないことの検査は tools/tests/vertex-region.test.cjs にある。

// ── 呼んだあと ────────────────────────────────────────────────────────
test('読めた間取りは、検めて均してから返す', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV, vertexFetch(() => vertexReply(GOOD_PLAN)));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.summary, { walls: 2, rooms: 1, items: 1, floors: [1] });
  assert.ok(body.plan.rooms[0].id, 'id が振られている');
  assert.deepEqual(body.notes, ['右下の収納は寸法が読めなかった'], 'AIが読めなかったことは利用者に見せる');
  assert.deepEqual(body.usage,
    { inputTokens: 2000, answerTokens: 1500, thoughtTokens: 500, outputTokens: 2000, totalTokens: 4000 },
    '原価を測れるように使用量を返す。思考ぶんは課金対象なので出力に含め、内訳も残す');
});

test('前置きや ``` で囲まれた返事からも JSON を取り出す', async () => {
  const { extractJson } = await mod('worker/vertex.mjs');
  const want = { walls: [], rooms: [], items: [] };
  assert.deepEqual(extractJson(JSON.stringify(want)), want);
  assert.deepEqual(extractJson('```json\n' + JSON.stringify(want) + '\n```'), want);
  assert.deepEqual(extractJson('読み取りました。\n' + JSON.stringify(want)), want);
  assert.equal(extractJson('すみません、読めませんでした'), null);
  assert.equal(extractJson(''), null);
});

test('読み込める形でない間取りは 422 で、理由を添えて返す', async () => {
  // 長さゼロの壁。芯線が点なので面が張れない。
  const broken = { walls: [{ x1: 0, y1: 0, x2: 0, y2: 0, thick: 120 }], rooms: [], items: [] };
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV, vertexFetch(() => vertexReply(broken)));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'ai_invalid_plan');
  assert.ok(body.problems.length > 0, 'なぜ駄目なのかが返ること');
});

test('JSON になっていない返事は 502', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV,
    vertexFetch(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'わかりません' }] } }] }), { status: 200 })));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'ai_bad_response');
});

test('Vertex 側のエラーは 502 にして、本文をそのまま流さない', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV,
    vertexFetch(() => new Response(JSON.stringify({ error: { message: 'Permission denied on resource project' } }), { status: 403 })));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'ai_upstream_error');
  assert.equal(body.status, 403);
});

// ── 送っている中身 ────────────────────────────────────────────────────
test('東京の窓口へ、画像と指示文を1往復で送っている', async () => {
  let sent = null;
  await callAi('/api/ai/import-plan', { image: PNG, hint: '1階だけの図です' }, VERTEX_ENV,
    vertexFetch(async (req) => {
      sent = { url: req.url, auth: req.headers.get('authorization'), body: JSON.parse(await req.text()) };
      return vertexReply(GOOD_PLAN);
    }));
  assert.match(sent.url, /^https:\/\/asia-northeast1-aiplatform\.googleapis\.com\//, '東京の窓口ではない');
  assert.match(sent.url, /\/locations\/asia-northeast1\//);
  assert.match(sent.url, /:generateContent$/);
  assert.match(sent.auth, /^Bearer /);
  assert.ok(!sent.auth.includes('secret-value-do-not-leak'), '認証ヘッダに秘密鍵そのものが出ている');
  assert.equal(sent.body.contents.length, 1, '1往復で収める（往復を増やすと原価が倍になる）');
  assert.equal(sent.body.contents[0].parts[0].inline_data.mime_type, 'image/png');
  assert.equal(sent.body.contents[0].parts[0].inline_data.data, PNG.split(',')[1]);
  assert.equal(sent.body.generationConfig.temperature, 0, '図面の読み取りは創作ではない');
  assert.match(sent.body.contents[0].parts[1].text, /1階だけの図です/, '利用者の補足が渡っている');
});

test('指示文は、読ませる範囲と座標の約束を明示している', async () => {
  const { buildPlanPrompt, ALLOWED_ITEM_TYPES } = await mod('worker/plan-prompt.mjs');
  const p = buildPlanPrompt();
  assert.match(p, /910/, '日本の住宅の基本寸法');
  assert.match(p, /ミリメートル/);
  assert.match(p, /芯/, '壁は芯線であること');
  assert.match(p, /家具/, '家具を読ませない指示');
  for (const t of ['window', 'door-swing', 'stair']) assert.ok(ALLOWED_ITEM_TYPES.includes(t));
  // 使える種類を列挙して渡している（列挙が空なら指示として成り立たない）
  for (const t of ALLOWED_ITEM_TYPES) assert.match(p, new RegExp(t.replace(/-/g, '\\-')));
});

// ── 移した部分が変わっていないこと ──────────────────────────────────
test('差分の当て方は元のまま（追加・更新・削除・フィールド）', async () => {
  const { applyPatch } = await mod('worker/shared.mjs');
  const plan = { walls: [{ id: 'a', x1: 0 }, { id: 'b', x1: 1 }], items: [], rooms: [], viewState: { z: 1 } };
  applyPatch(plan, {
    collections: { walls: { upserts: [{ id: 'b', x1: 99 }, { id: 'c', x1: 3 }], removes: ['a'] } },
    fields: { northDeg: 90, viewState: { z: 9 } },
  });
  assert.deepEqual(plan.walls, [{ id: 'b', x1: 99 }, { id: 'c', x1: 3 }]);
  assert.equal(plan.northDeg, 90);
  assert.deepEqual(plan.viewState, { z: 1 }, 'viewState は各自のものなので運ばない');
});

test('共有の門番はゆるいまま（整理で仕様を変えていない）', async () => {
  const { validPlan } = await mod('worker/shared.mjs');
  assert.equal(validPlan({ walls: [{ x1: 0, y1: 0, x2: 0, y2: 0 }], items: [], rooms: [] }), true);
  // 元の式が plan && ... なので null を渡すと null が返る。そこまで含めて変えていない。
  assert.ok(!validPlan({ walls: [], items: [] }));
  assert.ok(!validPlan(null));
});

test('ルームIDの形が違えば Durable Object を作らない', async () => {
  const { default: router } = await mod('worker/router.mjs');
  let touched = false;
  const env = { ROOMS: { idFromName: () => { touched = true; }, get: () => ({ fetch: () => new Response('') }) } };
  const res = await router.fetch(new Request('https://example.test/api/rooms/short'), env);
  assert.equal(res.status, 404);
  assert.equal(touched, false);
});
