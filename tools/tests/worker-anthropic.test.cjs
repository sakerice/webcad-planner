// 間取りの読み取りを Claude（Anthropic Messages API）へ送る経路。
//
// 実物は呼ばない。fetch を差し替えて、送った中身と、返事の扱いを見る。
// 見ているのは次のこと。
//   - 名指ししたときだけ Claude へ行く（点数で比べ終わるまで既定は OpenAI のまま）
//   - キーはヘッダにだけ載り、本文にも応答にも出ない
//   - 出力の形を JSON Schema で強制している（お願いではなく）
//   - 仕様書までを使い回しの範囲にし、図面はその後ろに置く
//   - 断られた・形が合わない返事を、そのまま間取りとして渡さない
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
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return handleAi(request, env, url, { fetchImpl });
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const ENV = { ANTHROPIC_API_KEY: 'sk-ant-secret', AI_IMPORT_PROVIDER: 'anthropic' };
const PAGE = { floors: [{ floor: 1, width: 3640, depth: 2730, rooms: [] }], notes: [] };

function claudeReply(obj, extra) {
  return new Response(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0, output_tokens: 800 },
    ...(extra || {}),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('AI_IMPORT_PROVIDER=anthropic で Claude へ送る（既定は Opus 5.5・考える深さ high）', async () => {
  let sent = null;
  const res = await callAi('/api/ai/import-plan', { image: PNG }, ENV, async (req) => {
    sent = {
      url: req.url,
      key: req.headers.get('x-api-key'),
      version: req.headers.get('anthropic-version'),
      raw: await req.text(),
    };
    return claudeReply(PAGE);
  });
  assert.equal(res.status, 200);
  assert.match(sent.url, /api\.anthropic\.com\/v1\/messages$/);
  assert.equal(sent.key, 'sk-ant-secret');
  assert.equal(sent.version, '2023-06-01');
  const body = JSON.parse(sent.raw);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.effort, 'high');
  assert.ok(!sent.raw.includes('sk-ant-secret'), '本文にキーが混ざっている');
  assert.ok(!('thinking' in body), 'Opus 5.5 は thinking を送ると断られる種類がある。送らない');
});

test('ANTHROPIC_MODEL と ANTHROPIC_EFFORT で比べる相手を替えられる', async () => {
  let body = null;
  await callAi('/api/ai/import-plan', { image: PNG },
    { ...ENV, ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_EFFORT: 'medium' },
    async (req) => { body = JSON.parse(await req.text()); return claudeReply(PAGE); });
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.output_config.effort, 'medium');
});

test('名指ししなければ、Claude のキーがあっても今までどおり OpenAI へ行く', async () => {
  let url = null;
  await callAi('/api/ai/import-plan', { image: PNG },
    { ANTHROPIC_API_KEY: 'sk-ant', OPENAI_API_KEY: 'sk-oa' },
    async (req) => {
      url = req.url;
      return new Response(JSON.stringify({ id: 'resp_1', status: 'queued' }), { status: 200 });
    });
  assert.match(url, /api\.openai\.com/);
});

test('出力の形を JSON Schema で強制し、仕様書までを使い回しの範囲にする', async () => {
  let body = null;
  await callAi('/api/ai/import-plan', { image: PNG }, ENV,
    async (req) => { body = JSON.parse(await req.text()); return claudeReply(PAGE); });
  const fmt = body.output_config.format;
  assert.equal(fmt.type, 'json_schema');
  assert.equal(fmt.schema.type, 'object');
  assert.equal(fmt.schema.additionalProperties, false, 'Claude は全オブジェクトに additionalProperties:false を求める');
  // 受け付けない制約が混ざっていないこと（混ざると 400 で何も読めない）
  const unsupported = [];
  JSON.stringify(fmt.schema, (k, v) => {
    if (['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf', 'nullable'].includes(k)) unsupported.push(k);
    return v;
  });
  assert.deepEqual(unsupported, []);

  const content = body.messages[0].content;
  const imageAt = content.findIndex((c) => c.type === 'image');
  const cacheAt = content.findIndex((c) => c.cache_control);
  assert.ok(cacheAt >= 0 && cacheAt < imageAt, '仕様書（使い回す部分）は図面より前に置く');
  assert.equal(content[content.length - 1].type, 'text', '今回の依頼は最後');
  assert.ok(body.system && body.system.length > 0, '役割は system に入れる');
});

test('PDF はそのまま document として渡す', async () => {
  let body = null;
  await callAi('/api/ai/import-plan', { image: 'data:application/pdf;base64,JVBERi0=' }, ENV,
    async (req) => { body = JSON.parse(await req.text()); return claudeReply(PAGE); });
  const doc = body.messages[0].content.find((c) => c.type === 'document');
  assert.equal(doc.source.media_type, 'application/pdf');
});

test('使用量は使い回し分も含めて入力として数え、内訳も返す', async () => {
  const res = await callAi('/api/ai/import-plan', { images: [PNG, PNG] }, ENV, async () => claudeReply(PAGE));
  const out = await res.json();
  assert.equal(out.usage.calls, 2);
  assert.equal(out.usage.inputTokens, 2 * (1200 + 3000));
  assert.equal(out.usage.outputTokens, 2 * 800);
  assert.equal(out.usage.cacheWriteTokens, 2 * 3000);
});

test('断られたら間取りとして渡さず 502', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, ENV, async () => claudeReply({}, {
    stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'x' },
  }));
  assert.equal(res.status, 502);
});

test('Anthropic 側のエラーは 502 にして、本文もキーも流さない', async () => {
  const res = await callAi('/api/ai/import-plan', { image: PNG }, ENV, async () => new Response(
    JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529 }));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('sk-ant-secret'));
});

test('キーが無ければ、AI を呼ばずに 503 と手順を返す', async () => {
  let called = false;
  const res = await callAi('/api/ai/import-plan', { image: PNG }, { AI_IMPORT_PROVIDER: 'anthropic' },
    async () => { called = true; return claudeReply(PAGE); });
  assert.equal(res.status, 503);
  assert.equal(called, false);
  assert.match((await res.json()).message, /ANTHROPIC_API_KEY/);
});

test('見直し（revise-plan）も Claude で通る', async () => {
  const res = await callAi('/api/ai/revise-plan', { images: [PNG], renders: [PNG], pages: [PAGE] }, ENV,
    async () => claudeReply(PAGE));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).revised, true);
});
