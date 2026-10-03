// Real Worker dispatch and provider wire helpers; no live API, credentials or quota.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '../..');
const mod = file => import(pathToFileURL(path.join(ROOT, file)).href);
const Identity = require(path.join(ROOT, 'assets/js/plan-source-identity.js'));
const IP = '192.0.2.70';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
function sourceFixture() {
  const images = [PNG, PNG.replace('Ug==', 'UA==')];
  const sourceLocal = { floors: images.map((image, i) => {
    const page = Identity.createPage(image, i + 1, Identity.hash('synthetic-document'), { pageKind: 'floor-plan', labels: [`${i + 1}F`] });
    return { floor: i + 1, width: 4000, depth: 3000, rooms: [{ name: '洋室', parts: [{ x0: 0, y0: 0, x1: 4000, y1: 3000 }] }], dims: null,
      sourcePageId: page.sourcePageId, sourceIdentity: { ...structuredClone(page), status: 'confirmed', modelFloor: i + 1 } };
  }), items: [], marks: [] };
  return { images, sourceLocal, sourceSnapshot: JSON.stringify(sourceLocal) };
}
function proposal(sourceLocal) {
  return { buildingRegistration: { version: 1, floors: sourceLocal.floors.map(floor => ({ floor: floor.floor, sourcePageId: floor.sourcePageId,
    anchors: [0, 4000].map(x => ({ local: { x, y: 0 }, building: { x, y: 0 }, evidence: `[${floor.sourcePageId}] Synthetic dimensioned wall endpoint`, precisionMm: 10 })), directions: [] })) } };
}
const output = (value, status = 'completed', id = 'resp_joint') => ({ id, status, output: [{ type: 'message', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } });
function fixture() {
  const input = sourceFixture(), calls = [], quotaCalls = [];
  let replies = [{ id: 'resp_joint', status: 'queued' }, output(proposal(input.sourceLocal))];
  const env = { OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'test-model',
    AI_QUOTA: { idFromName: () => 'quota', get: () => ({ async fetch(url) { quotaCalls.push(url); return Response.json({ ok: true, scope: 'user', remaining: 40 }); } }) },
    AI: { async run() { throw Error('No finish/revise/repair call is allowed'); } } };
  const deps = { async fetchImpl(request) { calls.push(request); assert.match(request.url, /^https:\/\/api\.openai\.com\/v1\/responses(?:\/resp_joint)?$/); assert.ok(replies.length, 'Unexpected extra provider call'); return Response.json(replies.shift()); } };
  return { input, env, deps, calls, quotaCalls, setReplies(value) { replies = value; } };
}
async function call(route, payload, fixture, { method = 'POST', ip = IP, signal } = {}) {
  const { handleAi } = await mod('worker/routes-ai.mjs');
  const url = new URL('https://example.test/api/ai/' + route);
  const request = new Request(url, { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, signal, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) });
  const result = await handleAi(request, fixture.env, url, fixture.deps);
  return { status: result.status, body: await result.json() };
}
function pollPayload(input, jobs) { return { jobs, sourceLocal: input.sourceLocal, sourceSnapshot: input.sourceSnapshot }; }

test('explicit joint start sends all pages in one paid job; poll preserves source and returns proposal only', async () => {
  const f = fixture(), before = JSON.stringify(f.input);
  const start = await call('register-plan', f.input, f);
  assert.equal(start.status, 202, JSON.stringify(start.body));
  assert.equal(start.body.jobs.length, 1); assert.match(start.body.jobs[0], /^preg1_/);
  assert.equal(start.body.sourceSnapshot, f.input.sourceSnapshot);
  assert.equal(start.body.canApply, false);
  assert.equal(f.calls.length, 1); assert.equal(f.quotaCalls.length, 1); assert.match(f.quotaCalls[0], /cost=20&/);
  const wire = await f.calls[0].json();
  assert.equal(wire.input[0].content.filter(part => part.type === 'input_image').length, 2);
  assert.equal(wire.model, 'test-model'); assert.equal(wire.background, true); assert.equal(wire.text.format.strict, true);
  assert.match(wire.input[0].content.at(-1).text, /quarter|270/);
  assert.ok(wire.input[0].content.at(-1).text.includes(f.input.sourceLocal.floors[0].sourcePageId));
  const result = await call('register-plan-result', pollPayload(f.input, start.body.jobs), f);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.valid, true); assert.equal(result.body.canApply, false);
  assert.equal(result.body.sourceSnapshot, f.input.sourceSnapshot);
  assert.deepEqual(result.body.buildingRegistration, proposal(f.input.sourceLocal).buildingRegistration);
  assert.equal(result.body.reviewed, undefined); assert.equal(result.body.floorplan, undefined);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].method, 'GET'); assert.equal(f.quotaCalls.length, 1);
  assert.equal(JSON.stringify(f.input), before);
});

test('immediately completed job and honest unresolved evidence are retained without repair', async () => {
  const f = fixture(), answer = proposal(f.input.sourceLocal);
  answer.buildingRegistration.floors[1].anchors = [];
  f.setReplies([output(answer)]);
  const result = await call('register-plan', f.input, f);
  assert.equal(result.status, 200); assert.equal(result.body.valid, true); assert.equal(result.body.canApply, false);
  assert.equal(result.body.jobs, undefined); assert.equal(result.body.buildingRegistration.floors[1].anchors.length, 0);
  assert.equal(f.calls.length, 1);
});

test('pending polls are free and never resubmit; provider cancellation is not successful output', async () => {
  const f = fixture(); f.setReplies([{ id: 'resp_joint', status: 'queued' }, { id: 'resp_joint', status: 'in_progress' }, output(proposal(f.input.sourceLocal), 'cancelled')]);
  const start = await call('register-plan', f.input, f);
  const payload = pollPayload(f.input, start.body.jobs);
  assert.equal((await call('register-plan-result', payload, f)).body.pending, true);
  const cancelled = await call('register-plan-result', payload, f);
  assert.equal(cancelled.status, 502); assert.equal(cancelled.body.valid, false); assert.equal(cancelled.body.canApply, false);
  assert.equal(f.calls.filter(request => request.method === 'POST').length, 1); assert.equal(f.quotaCalls.length, 1);
});

test('request overrides and excessive page counts reject before quota or provider calls', async () => {
  for (const key of ['prompt', 'schema', 'schemaUrl', 'model', 'provider', 'reviewed', 'buildingRegistration', 'extractionContract']) {
    const f = fixture(); const result = await call('register-plan', { ...f.input, [key]: true }, f);
    assert.equal(result.status, 400, key); assert.equal(f.calls.length + f.quotaCalls.length, 0);
  }
  const f = fixture(); f.input.sourceLocal.floors.push(...f.input.sourceLocal.floors); f.input.images.push(...f.input.images); f.input.sourceSnapshot = JSON.stringify(f.input.sourceLocal);
  assert.equal((await call('register-plan', f.input, f)).status, 400); assert.equal(f.calls.length + f.quotaCalls.length, 0);
});

test('missing, duplicate, conflicted and ambiguous identities fail closed before charging', async () => {
  const mutations = [
    input => { delete input.sourceLocal.floors[0].sourceIdentity; },
    input => { input.sourceLocal.floors[1].floor = 1; },
    input => { input.sourceLocal.floors[1].sourcePageId = input.sourceLocal.floors[0].sourcePageId; },
    input => { input.sourceLocal.floors[0].sourceIdentity.status = 'unknown'; },
    input => { input.sourceLocal.floors[0].sourceIdentity.sourceHeader.labels = ['2F']; },
    input => { input.sourceLocal.floors[0].sourceIdentity.sourceHeader.labels = ['1F', '2F']; },
    input => { input.sourceLocal.floors[0].sourceIdentity.sourceHeader.pageKind = 'roof-plan'; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.input); f.input.sourceSnapshot = JSON.stringify(f.input.sourceLocal);
    const result = await call('register-plan', f.input, f);
    assert.equal(result.status, 422, JSON.stringify(result.body)); assert.equal(result.body.error, 'registration_ambiguous_identity');
    assert.equal(f.calls.length + f.quotaCalls.length, 0);
  }
});

test('changed crop image, stale snapshot and invalid local geometry never trigger the paid job', async () => {
  for (const mutate of [input => { input.images.reverse(); }, input => { input.sourceLocal.floors[0].width = 5000; }]) {
    const f = fixture(); mutate(f.input);
    assert.equal((await call('register-plan', f.input, f)).status, 409); assert.equal(f.calls.length + f.quotaCalls.length, 0);
  }
  const f = fixture(); f.input.sourceLocal.floors[0].rooms[0].parts[0].x0 = -100; f.input.sourceSnapshot = JSON.stringify(f.input.sourceLocal);
  assert.equal((await call('register-plan', f.input, f)).status, 422); assert.equal(f.calls.length + f.quotaCalls.length, 0);
});

test('signed job is bound to source, IP, route and model', async () => {
  const f = fixture(), start = await call('register-plan', f.input, f), payload = pollPayload(f.input, start.body.jobs);
  assert.equal((await call('register-plan-result', payload, f, { ip: '192.0.2.71' })).status, 400);
  assert.equal((await call('register-plan-result', { ...payload, jobs: [start.body.jobs[0] + 'x'] }, f)).status, 400);
  assert.equal((await call('register-plan-result', { ...payload, jobs: ['resp_joint.' + '0'.repeat(32)] }, f)).status, 400);
  const changed = structuredClone(payload); changed.sourceLocal.floors[0].rooms[0].name = 'Changed'; changed.sourceSnapshot = JSON.stringify(changed.sourceLocal);
  assert.equal((await call('register-plan-result', changed, f)).status, 409);
  f.env.OPENAI_MODEL = 'other-model'; assert.equal((await call('register-plan-result', payload, f)).status, 409);
  assert.equal(f.calls.length, 1); assert.equal(f.quotaCalls.length, 1);
});

test('wrong provider response job ID is rejected without another call', async () => {
  const f = fixture(); f.setReplies([{ id: 'resp_joint', status: 'queued' }, output(proposal(f.input.sourceLocal), 'completed', 'resp_wrong')]);
  const start = await call('register-plan', f.input, f);
  const result = await call('register-plan-result', pollPayload(f.input, start.body.jobs), f);
  assert.equal(result.status, 502); assert.equal(result.body.error, 'registration_job_mismatch'); assert.equal(f.calls.length, 2);
});

test('not configured, missing quota, failed quota, exhausted quota and aborted request never call provider', async () => {
  const cases = [
    [env => { delete env.OPENAI_API_KEY; }, 503],
    [env => { delete env.AI_QUOTA; }, 503],
    [env => { env.AI_QUOTA.get = () => ({ fetch: async () => { throw Error('offline'); } }); }, 503],
    [env => { env.AI_QUOTA.get = () => ({ fetch: async () => Response.json({ ok: false, scope: 'user' }) }); }, 429],
  ];
  for (const [mutate, expected] of cases) { const f = fixture(); mutate(f.env); assert.equal((await call('register-plan', f.input, f)).status, expected); assert.equal(f.calls.length, 0); }
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.equal((await call('register-plan', f.input, f, { signal: controller.signal })).status, 499); assert.equal(f.calls.length + f.quotaCalls.length, 0);
});

test('unknown output keys, forged approvals, changed page IDs, unbounded precision and invalid JSON are retained but rejected', async () => {
  for (const mutate of [
    answer => { answer.reviewed = true; },
    answer => { answer.buildingRegistration.reviewed = true; },
    answer => { answer.buildingRegistration.floors[0].scale = 2; },
    answer => { answer.buildingRegistration.floors[0].sourcePageId = 'wrong'; },
    answer => { answer.buildingRegistration.floors[0].anchors[0].precisionMm = 900; },
    answer => { answer.buildingRegistration.floors[0].anchors[0].evidence = 'No page reference'; },
    answer => { answer.buildingRegistration.floors[0].anchors[0].local.x = -1; },
  ]) {
    const f = fixture(), answer = proposal(f.input.sourceLocal); mutate(answer); f.setReplies([output(answer)]);
    const result = await call('register-plan', f.input, f);
    assert.equal(result.status, 422, JSON.stringify(answer)); assert.equal(result.body.canApply, false); assert.equal(result.body.rawResponse, JSON.stringify(answer));
    assert.equal(result.body.buildingRegistration, undefined); assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.setReplies([output('```json\n{}\n```')]);
  const result = await call('register-plan', f.input, f);
  assert.equal(result.status, 422); assert.equal(f.calls.length, 1);
});

test('frozen native packet hashes verify and contains generic source-local contract without sample answers', async () => {
  const dir = path.join(ROOT, 'docs/plan-registration/packet'), manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'), manifest = JSON.parse(manifestText);
  const sha = value => createHash('sha256').update(value).digest('hex');
  assert.equal(fs.readFileSync(path.join(dir, 'manifest.sha256'), 'utf8').split(' ')[0], sha(manifestText));
  assert.equal(manifest.includesReferenceAnswers, false);
  for (const [name, record] of Object.entries(manifest.files)) { const file = fs.readFileSync(path.join(dir, name)); assert.equal(sha(file), record.sha256, name); assert.equal(file.byteLength, record.bytes); }
  const registration = await mod('worker/plan-registration.mjs');
  assert.equal(fs.readFileSync(path.join(dir, 'registration-procedure.txt'), 'utf8'), registration.REGISTRATION_PROCEDURE + '\n');
  assert.match(fs.readFileSync(path.join(dir, 'extraction-spec.txt'), 'utf8'), /各階は独立したローカル座標系/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'registration-procedure.txt'), 'utf8'), /5915|7280|4095|3640/);
});

test('three known floors may arrive in arbitrary page order but share exactly one generation job', async () => {
  const f = fixture();
  const image = PNG.replace('Ug==', 'UQ==');
  const page = Identity.createPage(image, 3, Identity.hash('synthetic-document'), { pageKind: 'floor-plan', labels: ['3F'] });
  f.input.sourceLocal.floors.push({ ...structuredClone(f.input.sourceLocal.floors[0]), floor: 3, sourcePageId: page.sourcePageId, sourceIdentity: { ...structuredClone(page), status: 'confirmed', modelFloor: 3 } });
  f.input.images.push(image);
  f.input.images.reverse(); f.input.sourceLocal.floors.reverse(); f.input.sourceSnapshot = JSON.stringify(f.input.sourceLocal);
  f.setReplies([output(proposal(f.input.sourceLocal))]);
  const result = await call('register-plan', f.input, f);
  assert.equal(result.status, 200); assert.equal(result.body.buildingRegistration.floors[0].floor, 3);
  assert.equal(f.calls.length, 1); assert.match(f.quotaCalls[0], /cost=30&/);
  assert.equal((await f.calls[0].json()).input[0].content.filter(part => part.type === 'input_image').length, 3);
});

test('expired signed job rejects before GET; abort during submission never retries', async () => {
  const f = fixture(), realNow = Date.now;
  let start;
  try { Date.now = () => realNow() - 60 * 60 * 1000; start = await call('register-plan', f.input, f); }
  finally { Date.now = realNow; }
  assert.equal(start.status, 202);
  assert.equal((await call('register-plan-result', pollPayload(f.input, start.body.jobs), f)).status, 410);
  assert.equal(f.calls.length, 1);
  const g = fixture(), controller = new AbortController();
  const prior = g.deps.fetchImpl;
  g.deps.fetchImpl = async request => { assert.equal(request.signal.aborted, false); controller.abort(); return prior(request); };
  const result = await call('register-plan', g.input, g, { signal: controller.signal });
  assert.equal(result.status, 499); assert.equal(result.body.jobs, undefined); assert.equal(g.calls.length, 1);
});

test('Vertex uses existing Japan-only provider configuration and one synchronous generation', async () => {
  const f = fixture();
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const key = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  f.env.AI_IMPORT_PROVIDER = 'vertex';
  f.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'registration-test@example.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`, project_id: 'test-registration' });
  let generation = 0;
  f.deps.fetchImpl = async request => {
    if (request.url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-only-token', expires_in: 3600 });
    generation++; assert.match(request.url, /^https:\/\/asia-northeast1-aiplatform.googleapis.com\//);
    const wire = await request.json(); assert.equal(wire.contents[0].parts.filter(part => part.inline_data).length, 2);
    assert.equal(wire.generationConfig.responseSchema.properties.buildingRegistration.properties.version.enum[0], 1);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(proposal(f.input.sourceLocal)) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10 } });
  };
  const result = await call('register-plan', f.input, f);
  assert.equal(result.status, 200); assert.equal(result.body.provider, 'vertex'); assert.equal(result.body.jobs, undefined); assert.equal(generation, 1); assert.equal(f.quotaCalls.length, 1);
  f.env.VERTEX_LOCATION = 'global';
  assert.equal((await call('register-plan', f.input, f)).status, 500); assert.equal(generation, 1); assert.equal(f.quotaCalls.length, 1);
});
