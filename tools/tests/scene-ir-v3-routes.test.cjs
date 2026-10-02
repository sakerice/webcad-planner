// Real handleAi dispatch and OpenAI wire helpers, entirely injected HTTP/storage.
// No live provider, secrets, remote quota or deployment is used by this suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createHmac } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '../..');
const mod = file => import(pathToFileURL(path.join(ROOT, file)).href);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const V3 = 'scene-ir-v3';
const IP = '192.0.2.4';
const sha = text => createHash('sha256').update(text).digest('hex');
const fact = value => ({ value, status: 'observed', source: 'Synthetic source diagram' });
function scene() {
  return { sceneVersion: 3, units: 'mm', coordinateSystem: 'x-east-y-south-clockwise', annotations: [], walls: [],
    rooms: [{ id: 'l-room', floor: fact(1), boundaryBasis: fact('clear-face'), shape: fact({ kind: 'rectUnion', rectangles: [{ x: 0, y: 0, w: 4000, d: 3000 }, { x: 0, y: 3000, w: 2500, d: 2000 }] }) }],
    openings: [], objects: [], siteRegions: [], buildingFootprints: [], bindings: [], connections: [] };
}
const response = (text, status = 'completed', id = 'resp_v3') => ({ id, status, output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 } });
function fixture() {
  const records = new Map(), calls = [], quotaCalls = [];
  const env = {
    SCENE_IR_V3_ENABLED: 'true', OPENAI_API_KEY: 'test-only-provider-key', OPENAI_MODEL: 'test-model',
    PLANS: { async put(key, value) { records.set(key, value); }, async get(key) { const text = records.get(key); return text === undefined ? null : { json: async () => JSON.parse(text) }; } },
    AI_QUOTA: { idFromName: () => 'quota', get: () => ({ async fetch(url) { quotaCalls.push(url); return Response.json({ ok: true, scope: 'user', remaining: 200 }); } }) },
    AI: { async run() { throw Error('No secondary/finish/revise model call is allowed'); } },
  };
  let replies = [{ id: 'resp_v3', status: 'queued' }, response(JSON.stringify(scene()))];
  const deps = { async fetchImpl(request) { calls.push(request); assert.match(request.url, /^https:\/\/api\.openai\.com\/v1\/responses(?:\/resp_v3)?$/); assert.ok(replies.length, 'No extra provider calls are allowed'); return Response.json(replies.shift()); } };
  return { records, calls, quotaCalls, env, deps, setReplies(values) { replies = values; }, record() { return JSON.parse([...records.values()][0]); } };
}
async function call(route, payload, f, options = {}) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/' + route);
  const method = options.method || 'POST';
  const req = new Request(url, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': options.ip || IP }, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) });
  const res = await handleAi(req, f.env, url, f.deps);
  return { status: res.status, body: await res.json() };
}
async function start(f, extra = {}) {
  const result = await call('import-plan', { extractionContract: V3, images: [PNG], ...extra }, f);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function complete(f, extra = {}) {
  const begun = await start(f);
  return { begun, ...(await call('plan-result', { jobs: begun.jobs, extractionContract: V3, ...extra }, f)) };
}

test('default-off quota response is unchanged; capability is advertised only with usable server prerequisites', async () => {
  const f = fixture(); delete f.env.SCENE_IR_V3_ENABLED;
  const off = await call('quota', null, f, { method: 'GET' });
  assert.deepEqual(off, { status: 200, body: { left: 3, perUser: 2, total: 5, counted: true } });
  f.env.SCENE_IR_V3_ENABLED = 'true';
  const on = await call('quota', null, f, { method: 'GET' });
  assert.deepEqual(on.body.sceneIRV3, { enabled: true, extractionContract: V3, structuredOutput: false, maxImages: 1, acceptsHint: false });
  delete f.env.PLANS;
  assert.equal((await call('quota', null, f, { method: 'GET' })).body.sceneIRV3, undefined);
  assert.equal(f.calls.length, 0);
});

test('flag-off legacy request and signed job response are golden, including exact existing strict provider schema', async () => {
  const f = fixture(); delete f.env.SCENE_IR_V3_ENABLED;
  f.setReplies([{ id: 'resp_v3', status: 'queued' }]);
  const legacy = await call('import-plan', { images: [PNG] }, f);
  const signature = createHmac('sha256', 'plan-job:' + f.env.OPENAI_API_KEY).update('resp_v3').digest('hex').slice(0, 32);
  assert.deepEqual(legacy, { status: 200, body: { jobs: ['resp_v3.' + signature] } });
  const wire = await f.calls[0].json();
  const { toJsonSchema } = await mod('worker/openai.mjs');
  const { PLAN_RESPONSE_SCHEMA } = await mod('worker/plan-response-schema.mjs');
  assert.deepEqual(wire.text, { format: { type: 'json_schema', name: 'plan', strict: true, schema: toJsonSchema(PLAN_RESPONSE_SCHEMA) } });
  assert.equal(f.records.size, 0);
});

test('unmarked v1 import and poll remain equivalent with experimental server flag on/off', async () => {
  async function run(enabled) {
    const f = fixture(); delete f.env.AI;
    f.env.SCENE_IR_V3_ENABLED = enabled;
    const legacy = { walls: [{ x1: 0, y1: 0, x2: 4000, y2: 0, thick: 120, floor: 1 }, { x1: 4000, y1: 0, x2: 4000, y2: 3000, thick: 120, floor: 1 }, { x1: 4000, y1: 3000, x2: 0, y2: 3000, thick: 120, floor: 1 }, { x1: 0, y1: 3000, x2: 0, y2: 0, thick: 120, floor: 1 }], labels: [{ text: '洋室', x: 2000, y: 1500, floor: 1 }], items: [], notes: [] };
    f.setReplies([{ id: 'resp_v3', status: 'queued' }, response(JSON.stringify(legacy))]);
    const begun = await call('import-plan', { images: [PNG] }, f);
    return call('plan-result', { jobs: begun.body.jobs }, f);
  }
  assert.deepEqual(await run('true'), await run('false'));
});

test('unknown or unapproved v3 contract rejects before quota/provider/storage', async () => {
  for (const requested of ['scene-ir-v99', '', null, 3]) {
    const f = fixture();
    const r = await call('import-plan', { extractionContract: requested, images: [PNG] }, f);
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unknown_extraction_contract');
    assert.equal(f.calls.length + f.quotaCalls.length + f.records.size, 0);
  }
  const f = fixture(); delete f.env.SCENE_IR_V3_ENABLED;
  const r = await call('import-plan', { extractionContract: V3, eligible: true, images: [PNG] }, f);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'scene_ir_v3_disabled');
  assert.equal(f.calls.length + f.quotaCalls.length + f.records.size, 0);
});

test('v3 requires working quota, configured supported provider and persistent storage before calls', async () => {
  for (const [modify, error] of [
    [f => { delete f.env.AI_QUOTA; }, 'scene_ir_v3_quota_unavailable'],
    [f => { f.env.AI_QUOTA.get = () => ({ fetch: async () => { throw Error('offline'); } }); }, 'scene_ir_v3_quota_unavailable'],
    [f => { f.env.AI_QUOTA.get = () => ({ fetch: async () => Response.json({ ok: false, scope: 'user' }) }); }, 'ai_quota_exceeded'],
    [f => { delete f.env.PLANS; }, 'scene_ir_v3_storage_unavailable'],
    [f => { delete f.env.OPENAI_API_KEY; }, 'ai_not_configured'],
    [f => { f.env.AI_IMPORT_PROVIDER = 'vertex'; }, 'scene_ir_v3_provider_unsupported'],
    [f => { f.env.PLANS.put = async () => { throw Error('offline'); }; }, 'scene_ir_v3_storage_unavailable'],
  ]) {
    const f = fixture(); modify(f);
    const r = await call('import-plan', { extractionContract: V3, images: [PNG] }, f);
    assert.equal(r.body.error, error); assert.equal(f.calls.length, 0);
  }
});

test('single source packet cannot be widened or remotely overridden, and invalid images spend no quota', async () => {
  for (const extra of [{ images: [PNG, PNG] }, { hint: 'extra instructions' }, { schemaUrl: 'https://example.test/schema' }, { prompt: 'rewrite it' }, { images: ['data:application/pdf;base64,AAAA'] }, { images: ['bad'] }, { images: ['data:image/png;base64,a'] }]) {
    const f = fixture(); const r = await call('import-plan', { extractionContract: V3, images: [PNG], ...extra }, f);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(f.calls.length + f.quotaCalls.length + f.records.size, 0);
  }
});

test('OpenAI wire uses unchanged frozen nested schema as text, explicit JSON mode, no v1 schema/knowledge/prompt', async () => {
  const f = fixture(); const begun = await start(f);
  const wire = await f.calls[0].json();
  const dir = path.join(ROOT, 'docs/scene-ir');
  assert.equal(wire.instructions, fs.readFileSync(path.join(dir, 'extraction-prompt-v3.txt'), 'utf8'));
  assert.deepEqual(wire.text, { format: { type: 'json_object' } });
  assert.equal(wire.background, true); assert.equal(wire.store, true);
  const content = wire.input[0].content;
  assert.equal(content.length, 4);
  assert.equal(content[0].image_url, PNG);
  assert.equal(content[1].text, fs.readFileSync(path.join(dir, 'schema-v3.json'), 'utf8'));
  assert.equal(content[2].text, fs.readFileSync(path.join(dir, 'capabilities-v3.json'), 'utf8'));
  assert.equal(content[3].text, '');
  assert.match(content[1].text, /"oneOf"/); assert.match(content[1].text, /"additionalProperties": false/);
  assert.equal(begun.structuredOutput, false); assert.equal(begun.extractionContract, V3);
  assert.equal(begun.contract.freezeSha256, sha(fs.readFileSync(path.join(dir, 'freeze-v3.json'))));
  assert.equal(begun.provenance.imageSha256, sha(Buffer.from(PNG.split(',')[1], 'base64')));
  assert.match(begun.jobs[0], /^sir3_/); assert.notEqual(begun.jobs[0], 'resp_v3');
  const record = f.record();
  assert.equal(record.extractionContract, V3); assert.deepEqual(record.contract, begun.contract);
  assert.equal(record.subjectHash, sha('scene-ir-v3-ip:' + IP));
  assert.equal(record.model, 'test-model'); assert.equal(record.structuredOutput, false);
});

test('pending poll and omitted request contract dispatch by persisted v3 job; complete source is valid but never applicable', async () => {
  const f = fixture(); const raw = ' \n' + JSON.stringify(scene(), null, 2) + '\n ';
  f.setReplies([{ id: 'resp_v3', status: 'queued' }, { id: 'resp_v3', status: 'in_progress' }, response(raw)]);
  const begun = await start(f);
  let r = await call('plan-result', { jobs: begun.jobs }, f);
  assert.equal(r.status, 200); assert.equal(r.body.pending, true); assert.deepEqual(r.body.contract, begun.contract);
  r = await call('plan-result', { jobs: begun.jobs }, f);
  assert.equal(r.status, 200); assert.equal(r.body.valid, true); assert.equal(r.body.canApply, false);
  assert.deepEqual(r.body.sceneIR, scene()); assert.equal(r.body.rawResponse, raw);
  assert.equal(r.body.provenance.rawSha256, sha(raw));
  assert.equal(r.body.sourcePreview.polygons[0].outer.length, 6);
  assert.equal(r.body.plan, undefined); assert.equal(r.body.pages, undefined); assert.equal(r.body.revise, undefined);
  assert.ok(r.body.diagnostics.some(d => d.code === 'retained_preview_only'));
  assert.equal(f.record().rawResponse, raw);
  assert.deepEqual(f.record().providerResponse, response(raw));
  assert.equal(f.calls.length, 3); assert.equal(f.quotaCalls.length, 1);
  const cached = await call('plan-result', { jobs: begun.jobs, extractionContract: V3 }, f);
  assert.deepEqual(cached, r); assert.equal(f.calls.length, 3);
});

test('immediate provider completion persists exact raw before polling; repeated polling never re-runs extraction', async () => {
  const f = fixture(); const raw = JSON.stringify(scene()); f.setReplies([response(raw)]);
  const begun = await start(f);
  assert.equal(f.record().rawResponse, raw);
  assert.equal(f.record().state, 'completed');
  const r = await call('plan-result', { jobs: begun.jobs }, f);
  assert.equal(r.body.valid, true); assert.equal(f.calls.length, 1);
});

test('malformed JSON, invalid schema, v1 masquerade and invalid source retain raw with no fallback or extra call', async () => {
  const disconnected = scene(); disconnected.rooms[0].shape.value.rectangles[1].x = 9000;
  for (const raw of ['{ "broken":', '```json\n' + JSON.stringify(scene()) + '\n```', JSON.stringify({ floors: [] }), JSON.stringify({ ...scene(), injectedField: true }), JSON.stringify(disconnected)]) {
    const f = fixture(); f.setReplies([{ id: 'resp_v3', status: 'queued' }, response(raw)]);
    const r = await complete(f);
    assert.equal(r.status, 422); assert.equal(r.body.valid, false); assert.equal(r.body.canApply, false);
    assert.equal(r.body.rawResponse, raw); assert.equal(r.body.provenance.rawSha256, sha(raw));
    assert.equal(r.body.error, 'scene_ir_v3_invalid'); assert.ok(r.body.diagnostics.length);
    assert.equal(f.record().rawResponse, raw); assert.equal(f.calls.length, 2); assert.equal(f.quotaCalls.length, 1);
    assert.equal(r.body.plan, undefined); assert.equal(r.body.next, undefined);
  }
});

test('provider incomplete and refusal outputs are diagnosable, never scene success', async () => {
  for (const status of ['incomplete', 'cancelled', 'failed']) {
    const f = fixture(); f.setReplies([{ id: 'resp_v3', status: 'queued' }, response('{"partial":', status)]);
    const r = await complete(f);
    assert.equal(r.status, 502); assert.equal(r.body.rawResponse, '{"partial":');
    assert.equal(r.body.valid, false); assert.equal(f.calls.length, 2);
  }
  const f = fixture(); const refusal = { id: 'resp_v3', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot read this' }] }] };
  f.setReplies([{ id: 'resp_v3', status: 'queued' }, refusal]);
  const r = await complete(f); assert.equal(r.status, 422); assert.deepEqual(f.record().providerResponse, refusal);
});

test('IP identity, missing records, mixed/v1 IDs and changed frozen contract cannot poll a different source', async () => {
  const f = fixture(); const begun = await start(f);
  assert.equal((await call('plan-result', { jobs: begun.jobs }, f, { ip: '192.0.2.5' })).status, 404);
  for (const jobs of [['resp_legacy.signature'], [...begun.jobs, 'resp_legacy.signature'], ['sir3_00000000-0000-0000-0000-000000000000']]) {
    const r = await call('plan-result', { extractionContract: V3, jobs }, f);
    assert.ok([400, 404].includes(r.status));
  }
  const key = [...f.records.keys()][0]; const original = f.record();
  for (const change of [r => { r.extractionContract = 'v1'; }, r => { r.contract.freezeSha256 = 'changed'; }, r => { r.contract.files['schema-v3.json'].sha256 = 'changed'; }, r => { r.adapter = 'legacy'; }]) {
    const record = structuredClone(original); change(record); f.records.set(key, JSON.stringify(record));
    assert.equal((await call('plan-result', { jobs: begun.jobs }, f)).status, 409);
  }
  assert.equal(f.calls.length, 1);
});

test('legacy revise and finish are blocked for explicit or retained v3 sources before any model call', async () => {
  for (const route of ['revise-plan', 'finish-plan']) {
    for (const body of [{ extractionContract: V3 }, { pages: [scene()] }, { sceneIR: scene() }, { jobs: ['sir3_job'] }]) {
      const f = fixture(); const r = await call(route, body, f);
      assert.equal(r.status, 409); assert.equal(r.body.error, 'scene_ir_v3_revise_unsupported');
      assert.equal(f.calls.length + f.quotaCalls.length, 0);
    }
  }
});

test('provider and post-call storage errors cannot trigger automatic re-extraction', async () => {
  const f = fixture(); f.deps.fetchImpl = async () => { f.calls.push('call'); return Response.json({ error: { message: 'provider down' } }, { status: 503 }); };
  let r = await call('import-plan', { extractionContract: V3, image: PNG }, f);
  assert.equal(r.status, 502); assert.equal(f.calls.length, 1); assert.equal(f.record().state, 'failed');
  const g = fixture(); let writes = 0; const put = g.env.PLANS.put;
  g.env.PLANS.put = async (...args) => { if (++writes > 1) throw Error('disk unavailable'); return put(...args); };
  r = await call('import-plan', { extractionContract: V3, image: PNG }, g);
  assert.equal(r.status, 503); assert.equal(g.calls.length, 1); assert.equal(g.record().state, 'starting');
  assert.match(r.body.message, /Do not automatically retry/);
});

test('provider job ID mismatch is retained and rejected rather than attached to the requested scene', async () => {
  const f = fixture(); f.setReplies([{ id: 'resp_v3', status: 'queued' }, response(JSON.stringify(scene()), 'completed', 'resp_other')]);
  const r = await complete(f);
  assert.equal(r.status, 502); assert.equal(r.body.sceneIR, null);
  assert.equal(r.body.diagnostics[0].code, 'provider_job_mismatch');
  assert.equal(f.record().providerResponse.id, 'resp_other'); assert.equal(f.calls.length, 2);
});

test('post-call persistence failure still returns diagnosable raw output to caller without an automatic retry', async () => {
  const f = fixture(); const raw = '{"diagnosable":'; f.setReplies([{ id: 'resp_v3', status: 'queued' }, response(raw)]);
  const begun = await start(f);
  f.env.PLANS.put = async () => { throw Error('offline'); };
  const r = await call('plan-result', { jobs: begun.jobs }, f);
  assert.equal(r.status, 503); assert.equal(r.body.rawResponse, raw); assert.equal(r.body.rawRetained, false);
  assert.equal(r.body.provenance.rawSha256, sha(raw)); assert.equal(f.calls.length, 2);
});

test('v3 uses actual IP quota admission: one page is charged once and exhausted quota blocks another import', async () => {
  const f = fixture(), values = new Map();
  const { AiQuota } = await mod('worker/ai-quota.mjs');
  const quota = new AiQuota({ storage: {
    async get(keys) { return new Map(keys.filter(k => values.has(k)).map(k => [k, values.get(k)])); },
    async put(entries) { Object.entries(entries).forEach(([k, v]) => values.set(k, v)); },
    async list() { return values; }, async delete(keys) { keys.forEach(k => values.delete(k)); },
  } }, {});
  f.env.AI_DAILY_IMPORTS_PER_USER = '0.16'; // Rounded existing points budget is 10.
  f.env.AI_QUOTA = { idFromName: () => 'quota', get: () => ({ fetch: url => quota.fetch(new Request(url)) }) };
  const begun = await start(f);
  assert.equal([...values.values()].reduce((a, b) => a + b, 0), 20); // total + source IP
  const rejected = await call('import-plan', { extractionContract: V3, image: PNG }, f);
  assert.equal(rejected.status, 429); assert.equal(f.calls.length, 1);
  const result = await call('plan-result', { jobs: begun.jobs }, f);
  assert.equal(result.status, 200); assert.equal(f.calls.length, 2);
  assert.equal([...values.values()].reduce((a, b) => a + b, 0), 20);
});
