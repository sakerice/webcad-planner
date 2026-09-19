// 間取り図が日本国内から出ないこと。
//
// ここが一番危ない検査対象である。グローバルの窓口へ流れても**エラーには
// ならず、黙って国外で処理される**。動いてしまうので気づけない。
// 間取り図には施主名・敷地住所が入りうるので、窓口の組み立てと、
// 送信前に止める判断を、コードではなく検査で固定する。
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

test('既定の送り先は東京', async () => {
  const { DEFAULT_LOCATION, vertexConfig } = await mod('worker/vertex.mjs');
  assert.equal(DEFAULT_LOCATION, 'asia-northeast1');
  assert.equal(vertexConfig({}).location, 'asia-northeast1');
});

test('日本国内のリージョンだけを通す', async () => {
  const { isJapanLocation } = await mod('worker/vertex.mjs');
  assert.equal(isJapanLocation('asia-northeast1'), true, '東京');
  assert.equal(isJapanLocation('asia-northeast2'), true, '大阪');
  for (const bad of ['global', 'us-central1', 'asia-southeast1', 'asia-northeast3', '', null, undefined]) {
    assert.equal(isJapanLocation(bad), false, JSON.stringify(bad) + ' を通してしまう');
  }
  // asia-northeast3 はソウル。名前が似ているので取り違えやすい。
});

test('窓口のホスト名にリージョンが入り、国外なら組み立てを拒む', async () => {
  const { endpointFor } = await mod('worker/vertex.mjs');
  const url = endpointFor({ location: 'asia-northeast1', project: 'p', model: 'gemini-2.5-flash' });
  assert.match(url, /^https:\/\/asia-northeast1-aiplatform\.googleapis\.com\//, 'ホストが東京ではない');
  assert.match(url, /\/locations\/asia-northeast1\//, 'パスのリージョンが東京ではない');
  assert.doesNotMatch(url, /global/, 'グローバル窓口になっている');
  for (const bad of ['global', 'us-central1', 'asia-southeast1']) {
    assert.throws(() => endpointFor({ location: bad, project: 'p', model: 'm' }),
      /日本国内ではない/, bad + ' の窓口を組み立ててしまう');
  }
});

test('国外の設定なら、送信せずに 500 で止める', async () => {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  let called = false;
  const fetchImpl = () => { called = true; return new Response('{}', { status: 200 }); };
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----', project_id: 'p' }),
    VERTEX_LOCATION: 'us-central1',
  };
  const url = new URL('https://example.test/api/ai/import-plan');
  const res = await handleAi(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }),
  }), env, url, { fetchImpl });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'ai_region_not_japan');
  assert.equal(called, false, '送ってしまってからでは取り返しがつかない');
});

test('鍵が無ければ、何もせず 503 と手順を返す', async () => {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/import-plan');
  const res = await handleAi(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }),
  }), {}, url, {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'ai_not_configured');
  assert.match(body.message, /wrangler secret/);
});

test('サービスアカウントの鍵は、応答にもエラーにも出ない', async () => {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const secret = '-----BEGIN PRIVATE KEY-----\nSECRETVALUEDONOTLEAK\n-----END PRIVATE KEY-----';
  const env = {
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: secret, project_id: 'p' }),
    VERTEX_LOCATION: 'us-central1',   // 送信前に止まる経路
  };
  const url = new URL('https://example.test/api/ai/import-plan');
  const res = await handleAi(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }),
  }), env, url, {});
  const text = await res.text();
  assert.ok(!text.includes('SECRETVALUEDONOTLEAK'), '応答に秘密鍵が混ざっている');
});

// ── 使用量は必ず返す（費用を推定ではなく実測で押さえるため）──────────
test('使用トークンは、思考ぶんと答えぶんを分けて返す', async () => {
  const { generate } = await mod('worker/vertex.mjs');
  const fetchImpl = async (req) => {
    if (String(req.url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"walls":[]}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 900, totalTokenCount: 1200 },
    }), { status: 200 });
  };
  const r = await generate({
    config: {
      credentials: { client_email: 'x@y', private_key: 'k', token_uri: 'https://oauth2.googleapis.com/token' },
      project: 'p', location: 'asia-northeast1', model: 'gemini-2.5-flash',
    },
    text: 'x', fetchImpl,
    // 署名を通さずに済むよう、トークンはキャッシュ済みとして渡す
    now: Date.now(),
  }).catch((e) => ({ ok: false, message: String(e) }));
  // 署名は本物の鍵が要るので、ここでは失敗してもよい。失敗しても
  // 「認証に失敗しました」で止まり、鍵の中身は出ない。
  if (r.ok) {
    assert.equal(r.usage.answerTokens, 200);
    assert.equal(r.usage.thoughtTokens, 900, '思考ぶんを分けて数えていない');
    assert.equal(r.usage.outputTokens, 1100, '課金対象は答え＋思考');
  } else {
    assert.match(r.message, /認証に失敗/);
  }
});

test('出力の上限は、図面1枚が収まる大きさ', async () => {
  // 8192 だと途中で切れた JSON が返り、課金だけされて1件も使えない。
  const { readFileSync } = require('node:fs');
  const src = readFileSync(join(ROOT, 'worker', 'vertex.mjs'), 'utf8');
  const m = /maxOutputTokens = (\d+)/.exec(src);
  assert.ok(m, 'maxOutputTokens の既定値が読めない');
  assert.ok(Number(m[1]) >= 32768, '既定の出力上限が小さすぎる: ' + m[1]);
});
