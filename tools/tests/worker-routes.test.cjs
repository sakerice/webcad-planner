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
  // 部屋は渡さない。**壁と文字から計算される**のが正しい振る舞い。
  walls: [
    { x1: 0, y1: 0, x2: 7280, y2: 0, thick: 120, floor: 1 },
    { x1: 7280, y1: 0, x2: 7280, y2: 4095, thick: 120, floor: 1 },
    { x1: 7280, y1: 4095, x2: 0, y2: 4095, thick: 120, floor: 1 },
    { x1: 0, y1: 4095, x2: 0, y2: 0, thick: 120, floor: 1 },
    { x1: 3640, y1: 0, x2: 3640, y2: 4095, thick: 120, floor: 1 },
  ],
  labels: [{ text: '洋室', x: 1800, y: 2000, floor: 1 }],
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
test('部屋はAIに出させず、壁と文字から計算する', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV, vertexFetch(() => vertexReply(GOOD_PLAN)));
  assert.equal(res.status, 200);
  const body = await res.json();
  // 間仕切り1本で2部屋。AIは部屋を1つも渡していない。
  assert.equal(body.summary.rooms, 2, '壁から部屋を作れていない: ' + JSON.stringify(body.plan.rooms));
  assert.equal(body.summary.walls, 5);
  const named = body.plan.rooms.find((r) => r.n === '洋室');
  assert.ok(named, '図の文字が部屋名になっていない');
  assert.deepEqual({ x: named.x, y: named.y, w: named.w, d: named.d },
    { x: 0, y: 0, w: 3640, d: 4095 }, '文字の位置にある領域に名前が付いていない');
  assert.ok(body.plan.rooms.every((r) => r.id), 'id が振られている');
  assert.deepEqual(body.notes, ['右下の収納は寸法が読めなかった'], 'AIが読めなかったことは利用者に見せる');
  // 原価を測れるように使用量を返す。思考ぶんは課金対象なので出力に含め、内訳も残す。
  // ページごとに1回ずつ送るので、何回ぶんの合計かも残す。
  assert.deepEqual(body.usage,
    { calls: 1, inputTokens: 2000, answerTokens: 1500, thoughtTokens: 500, outputTokens: 2000, totalTokens: 4000 });
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
  // 送るものは4つ。画像 / 読み取りの例 / 仕様書 / 今回の依頼。
  // 役割ごとに別の部品にしてある。
  const texts = sent.body.contents[0].parts.filter((p) => p.text).map((p) => p.text);
  assert.equal(texts.length, 3, '例・仕様書・依頼文が別の部品になっていない');
  assert.match(texts[0], /日本の住宅の平面図を読む/, '読み取りの例が渡っていない');
  assert.match(texts[1], /house-planner mobile 取り込みデータ仕様/, '仕様書が渡っていない');
  assert.match(texts[2], /1階だけの図です/, '利用者の補足が渡っている');
});

test('送るものは役割ごとに分かれている（役割・仕様・手順）', async () => {
  const { SYSTEM_PROMPT, buildPlanPrompt, ALLOWED_ITEM_TYPES } = await mod('worker/plan-prompt.mjs');
  const { planSpec } = await mod('worker/plan-spec.mjs');

  // 役割: 何をする人で、何を出すか。
  assert.match(SYSTEM_PROMPT, /JSON/);

  // 仕様: 単位・座標・項目・使える種類。ここだけを見れば形が分かる。
  const spec = planSpec();
  assert.match(spec, /ミリメートル/);
  assert.match(spec, /原点 \(0,0\)/);
  for (const t of ALLOWED_ITEM_TYPES) assert.match(spec, new RegExp(t.replace(/-/g, '\\-')));

  // 手順: どの順に何を埋めるか。仕様の写しを持たない。
  const p = buildPlanPrompt();
  assert.match(p, /手順1/);
  assert.ok(!p.includes('ミリメートル'), '単位が手順にも書かれている（仕様と二重）');
  assert.ok(!/window\b/.test(p), '使える種類が手順にも書かれている（仕様と二重）');
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

// ── ページごとに送る ────────────────────────────────────────────────
//
// **1回のリクエストに画像は1枚だけ。** 複数枚を1回に入れると、各画像が
// 768画素角のタイル1枚に縮められる。実測(3072画素の同じ図面):
//
//   1枚 3,368 トークン / 2枚 530 トークン / 3枚 788 トークン
//
// 枚数を増やすほど1枚あたりの解像度が落ち、寸法の文字が読めなくなる。
test('ページごとに1回ずつ送る（1回に画像を詰め込まない）', async () => {
  const sent = [];
  const twoFloors = (floor) => ({
    floors: [{ floor, width: 3640, depth: 4095,
      rooms: [{ name: floor === 1 ? '洋室' : '寝室', parts: [{ x0: 0, y0: 0, x1: 3640, y1: 4095 }] }] }],
  });
  let n = 0;
  await callAi('/api/ai/import-plan', { images: [PNG, PNG, PNG] }, VERTEX_ENV,
    vertexFetch(async (req) => {
      const body = JSON.parse(await req.text());
      sent.push(body);
      return vertexReply(twoFloors(++n));
    }));
  assert.equal(sent.length, 3, 'ページの数だけ送っていない');
  for (const body of sent) {
    const imgs = body.contents[0].parts.filter((p) => p.inline_data);
    assert.equal(imgs.length, 1, '1回のリクエストに画像を複数入れている');
  }
});

test('ページごとの補足に、何ページ目かを入れる', async () => {
  const seen = [];
  await callAi('/api/ai/import-plan', { images: [PNG, PNG], hint: '東西に長い家です' }, VERTEX_ENV,
    vertexFetch(async (req) => {
      const body = JSON.parse(await req.text());
      seen.push(body.contents[0].parts.filter((p) => p.text).pop().text);
      return vertexReply({ floors: [{ floor: seen.length, width: 3640, depth: 4095, rooms: [] }] });
    }));
  assert.match(seen[0], /1ページ目/);
  assert.match(seen[1], /2ページ目/);
  assert.match(seen[0], /東西に長い家です/, '利用者の補足が消えている');
});

test('同じ階が2回来たら、ページの並び順を正とする', async () => {
  // 見出しの無い図面では階を取り違える。全ページが1階と答えると家にならない。
  let n = 0;
  const res = await callAi('/api/ai/import-plan', { images: [PNG, PNG, PNG] }, VERTEX_ENV,
    vertexFetch(async () => {
      n++;
      return vertexReply({ floors: [{ floor: 1, width: 3640, depth: 4095,
        rooms: [{ name: '洋室' + n, parts: [{ x0: 0, y0: 0, x1: 3640, y1: 4095 }] }] }] });
    }));
  const body = await res.json();
  assert.deepEqual(body.summary.floors, [1, 2, 3], '全ページが同じ階になっている');
});

test('使用量は全ページの合計になる', async () => {
  const res = await callAi('/api/ai/import-plan', { images: [PNG, PNG] }, VERTEX_ENV,
    vertexFetch(async () => vertexReply({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] })));
  const body = await res.json();
  assert.equal(body.usage.calls, 2, '何回送ったかが残っていない');
  assert.equal(body.usage.inputTokens, 4000, 'ページぶんの合計になっていない');
});

// ── 費用の歯止め ──────────────────────────────────────────────────
//
// /api/ai/* には認証が無い。URLを知っていれば誰でも呼べ、1回 ¥4〜16 が
// そのまま請求される。図面1枚につき1回 AI を呼ぶので、8ページのPDFなら
// 1リクエストで8回ぶん。ここが最後の砦になる。
function quotaEnv(extra) {
  // 数を持つ Durable Object の代わり。呼ばれた内容を覚えておく。
  const seen = [];
  let used = 0;
  const stub = {
    fetch: async (url) => {
      const u = new URL(url);
      const cost = Number(u.searchParams.get('cost'));
      const perDay = Number(u.searchParams.get('perDay'));
      seen.push({ cost, who: u.searchParams.get('who'), perDay, totalPerDay: Number(u.searchParams.get('totalPerDay')) });
      if (used + cost > perDay) {
        return new Response(JSON.stringify({ ok: false, scope: 'who', limit: perDay, remaining: perDay - used }));
      }
      used += cost;
      return new Response(JSON.stringify({ ok: true, scope: 'who', limit: perDay, remaining: perDay - used }));
    },
  };
  return {
    env: { ...VERTEX_ENV, ...extra, AI_QUOTA: { idFromName: () => 'id', get: () => stub } },
    seen,
  };
}

test('使う前に数える（送ってから断ると費用は戻らない）', async () => {
  const { env, seen } = quotaEnv({ AI_DAILY_PER_USER: '100' });
  let called = 0;
  await callAi('/api/ai/import-plan', { images: [PNG, PNG, PNG] }, env,
    vertexFetch(async () => { called++; return vertexReply({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] }); }));
  assert.equal(seen.length, 1, '数を取りに行っていない');
  // 数えるのは回数ではなく「点」。呼び出しによって費用が10倍以上違うため。
  // 図面1枚の読み取りが10点。3ページなら30点。
  assert.equal(seen[0].cost, 30, 'ページ数ぶんで数えていない（リクエスト数で数えている）');
  assert.equal(called, 3);
});

test('上限を超えたら、AIを呼ばずに断る', async () => {
  const { env, seen } = quotaEnv({ AI_DAILY_PER_USER: '20' });
  let called = 0;
  const res = await callAi('/api/ai/import-plan', { images: [PNG, PNG, PNG] }, env,
    vertexFetch(async () => { called++; return vertexReply({ floors: [] }); }));
  assert.equal(res.status, 429);
  assert.equal(called, 0, '上限を超えているのに AI を呼んでいる（費用が出ている）');
  const body = await res.json();
  assert.equal(body.error, 'ai_quota_exceeded');
  assert.match(body.message, /使い切りました/, '利用者に何が起きたか伝わらない');
});

test('数の仕組みが無い環境では通す（機能まで止めない）', async () => {
  let called = 0;
  const res = await callAi('/api/ai/import-plan', { image: PNG }, VERTEX_ENV,
    vertexFetch(async () => { called++; return vertexReply({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] }); }));
  assert.equal(res.status, 200);
  assert.equal(called, 1);
});

test('数える相手は接続元。上限は環境変数で変えられる', async () => {
  const { env, seen } = quotaEnv({ AI_DAILY_PER_USER: '70', AI_DAILY_TOTAL: '990' });
  await callAi('/api/ai/import-plan', { image: PNG }, env,
    vertexFetch(async () => vertexReply({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] })),
    { 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(seen[0].who, '203.0.113.9');
  assert.equal(seen[0].perDay, 70);
  assert.equal(seen[0].totalPerDay, 990);
});

// ── どのモデルに読ませるか ──────────────────────────────────────────
//
// 実測（同じ切り出し画像・同じ指示文・同じ仕様書、1階の図面1枚）:
//
//                    費用   所要   L字  廻り階段  寸法線4辺
//   gemini-2.5-pro   ¥16    79秒   ✗     ✗       ✓
//   gpt-5            ¥26   140秒   ✗     ✗       右辺✗
//   gpt-6-astra      ¥40    73秒   ✓     ✓       ✓
//
// L字の部屋と廻り階段は、他の2つでは手順を書き直しても出なかった。
test('鍵があれば OpenAI へ送る（既定は gpt-6-astra）', async () => {
  let sent = null;
  const env = { ...VERTEX_ENV, OPENAI_API_KEY: 'sk-test' };
  await callAi('/api/ai/import-plan', { image: PNG }, env, async (req) => {
    sent = { url: req.url, auth: req.headers.get('authorization'), body: JSON.parse(await req.text()) };
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ content: [{ text: JSON.stringify({ floors: [{ floor: 1, width: 3640, depth: 4095, rooms: [] }] }) }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.match(sent.url, /api\.openai\.com/, 'OpenAI へ送っていない');
  assert.equal(sent.body.model, 'gpt-6-astra');
  assert.match(sent.auth, /^Bearer /);
  assert.ok(!JSON.stringify(sent.body).includes('sk-test'), '本文にキーが混ざっている');
});

test('OPENAI_MODEL と AI_IMPORT_PROVIDER で切り替えられる', async () => {
  let model = null;
  await callAi('/api/ai/import-plan', { image: PNG },
    { ...VERTEX_ENV, OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-5.6-sol' },
    async (req) => {
      model = JSON.parse(await req.text()).model;
      return new Response(JSON.stringify({
        status: 'completed',
        output: [{ content: [{ text: JSON.stringify({ floors: [] }) }] }], usage: {},
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  assert.equal(model, 'gpt-5.6-sol');

  // provider を vertex に倒せば、キーがあっても Gemini へ行く
  let url = null;
  await callAi('/api/ai/import-plan', { image: PNG },
    { ...VERTEX_ENV, OPENAI_API_KEY: 'sk-test', AI_IMPORT_PROVIDER: 'vertex' },
    vertexFetch(async (req) => { url = req.url; return vertexReply({ floors: [] }); }));
  assert.match(url, /aiplatform\.googleapis\.com/, 'vertex に倒せていない');
});

test('図面の位置は gemini-2.5-flash に聞く（安くて当たるから）', async () => {
  // 実測（同じページ、正解は縦 0.240〜0.600）:
  //   gemini-2.5-flash  0.240〜0.600  ほぼ一致       ¥0.2
  //   gpt-5.4-mini      0.184〜0.308  上端だけを切る  ¥0.1
  // 安ければどれでもよいわけではない。外した範囲で切り出すと、読み取りが
  // 「図面が無い」と答えて何も返らなくなる。
  let url = null;
  await callAi('/api/ai/find-plan', { image: PNG },
    { ...VERTEX_ENV, OPENAI_API_KEY: 'sk-test' },
    vertexFetch(async (req) => {
      url = req.url;
      return vertexReply({ found: true, x0: 100, y0: 100, x1: 900, y1: 900 });
    }));
  assert.match(url, /aiplatform\.googleapis\.com/, 'OpenAI の鍵があると位置探しまで持っていかれている');
  assert.match(url, /gemini-2\.5-flash/, '安いモデルを使っていない');
});
