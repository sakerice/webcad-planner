// Worker の振り分けと、AI ルートの門番。
//
// worker.mjs は1枚に共通の道具・共有ルーム・HTTPの振り分けが同居していて、
// テストが1件も無かった。AI の呼び出しはここに鍵を置くことになるので、
// 分けたうえで「鍵が無いとき」「変な要求が来たとき」の振る舞いを固定する。
//
// モデルを実際に呼ぶところ(callModel)はまだ実装していない。ここで見るのは
// その手前——**呼ぶ前に弾くべきものを弾けているか**である。
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

// 1x1 の PNG。中身は問わないので、形だけ整っていればよい。
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

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

test('鍵が設定されていなければ、AI は呼ばずに 503 と手順を返す', async () => {
  const res = await post('/api/ai/render', { image: PNG, prompt: 'x' }, {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'ai_not_configured');
  assert.match(body.message, /wrangler secret/, '何をすればよいかが書いてあること');
});

test('鍵はどの応答にも出てこない', async () => {
  const env = { AI_API_KEY: 'sk-secret-value', AI_PROVIDER: 'someprovider' };
  for (const path of ['/api/ai/render', '/api/ai/import-plan']) {
    const res = await post(path, { image: PNG, prompt: 'x' }, env);
    const text = await res.text();
    assert.ok(!text.includes('sk-secret-value'), path + ' の応答に鍵が混ざっている');
  }
});

test('画像が data URL でなければ、モデルを呼ぶ前に 400', async () => {
  const env = { AI_API_KEY: 'k' };
  for (const image of [undefined, '', 'https://example.com/a.png', 'data:text/plain;base64,AAAA']) {
    const res = await post('/api/ai/render', { image, prompt: 'x' }, env);
    assert.equal(res.status, 400, JSON.stringify(image) + ' が通ってしまった');
  }
});

test('指示文が無い・長すぎるものは 400', async () => {
  const env = { AI_API_KEY: 'k' };
  assert.equal((await post('/api/ai/render', { image: PNG, prompt: '   ' }, env)).status, 400);
  assert.equal((await post('/api/ai/render', { image: PNG, prompt: 'あ'.repeat(9000) }, env)).status, 400);
});

test('正しい要求は、未実装(501)まで進む', async () => {
  const res = await post('/api/ai/render', { image: PNG, prompt: '木造2階建ての外観' }, { AI_API_KEY: 'k' });
  assert.equal(res.status, 501);
  assert.equal((await res.json()).error, 'ai_not_implemented');
});

test('GET は受けない（AIの呼び出しは副作用があるので）', async () => {
  const { default: router } = await mod('worker/router.mjs');
  const res = await router.fetch(new Request('https://example.test/api/ai/render'), { AI_API_KEY: 'k' });
  assert.equal(res.status, 405);
});

// ── AI が返した間取りの門番 ────────────────────────────────────────
test('読み込める形でない間取りは 422 で、理由を添えて返す', async () => {
  const { finishImportedPlan } = await mod('worker/routes-ai.mjs');
  const res = finishImportedPlan({ walls: [{ x1: 0, y1: 0, x2: 0, y2: 0, thick: 120 }], rooms: [], items: [] });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'ai_invalid_plan');
  assert.ok(body.problems.length > 0, 'なぜ駄目なのかが返ること');
});

test('読み込める間取りは、均して要約を添えて返す', async () => {
  const { finishImportedPlan } = await mod('worker/routes-ai.mjs');
  const res = finishImportedPlan({
    walls: [{ x1: 0, y1: 0, x2: '4000', y2: 0, thick: 120 }],
    rooms: [{ x: 0, y: 0, w: 4000, d: 3000 }],
    items: [],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.plan.walls[0].x2, 4000, '文字列の数値が数値になっている');
  assert.ok(body.plan.rooms[0].id, 'id が振られている');
  assert.deepEqual(body.summary, { walls: 1, rooms: 1, items: 0, floors: [1] });
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
  // 長さゼロの壁を持つ間取りも、いままでどおり共有できる
  assert.equal(validPlan({ walls: [{ x1: 0, y1: 0, x2: 0, y2: 0 }], items: [], rooms: [] }), true);
  // 真偽値そのものではなく真偽で見る。元の式が plan && ... で、
  // null を渡すと null が返る。そこまで含めて変えていない。
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
