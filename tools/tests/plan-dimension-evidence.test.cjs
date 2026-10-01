const test = require('node:test');
const assert = require('node:assert/strict');
const mod = (name) => import('../../worker/' + name + '.mjs');
const floor = (dims) => ({ floor: 1, width: 1820, depth: 1820, dims,
  rooms: [{ name: '室', parts: [{ x0: 0, y0: 0, x1: 1820, y1: 1820 }] }], items: [] });
const page = (dims) => ({ floors: [floor(dims)], notes: [] });

test('explicit evidence nullability survives both provider schemas without relaxing geometry', async () => {
  const { PLAN_RESPONSE_SCHEMA: schema } = await mod('plan-response-schema');
  const { toJsonSchema } = await mod('openai');
  const original = JSON.stringify(schema);
  const f = schema.properties.floors.items.properties;
  assert.equal(f.dims.nullable, true);
  assert.equal(f.dims.properties.top.properties.total.nullable, true);
  const s = toJsonSchema(schema).properties.floors.items;
  const d = s.properties.dims;
  assert.deepEqual(d.type, ['object', 'null']);
  assert.deepEqual(d.properties.top.type, ['object', 'null']);
  assert.deepEqual(d.properties.top.properties.total.type, ['number', 'null']);
  assert.deepEqual(d.properties.top.properties.parts.type, ['array', 'null']);
  assert.deepEqual(d.properties.top.properties.parts.items.type, ['number', 'null']);
  assert.deepEqual(d.required, ['top', 'bottom', 'left', 'right']);
  assert.equal(d.additionalProperties, false);
  assert.equal(s.properties.width.type, 'number');
  assert.equal(s.properties.depth.type, 'number');
  assert.equal(s.properties.rooms.items.properties.parts.items.properties.x0.type, 'number');
  assert.equal(s.properties.items.items.properties.d.type, 'number', 'unrelated optional fields are unchanged');
  assert.equal(JSON.stringify(schema), original);
  assert.deepEqual(toJsonSchema({type:'STRING', enum:['observed'], nullable:true}).enum, ['observed', null]);
});

test('null, absent, empty and invalid lengths never become observed zero', async () => {
  const { pageFacts } = await mod('plan-gate');
  for (const dims of [undefined, null, {}, {top:null}]) {
    assert.equal(pageFacts(page(dims)).floors[0].dimension_check, null);
  }
  for (const total of [null, undefined, '', ' ', false, true, 0, -1, Infinity, 'bad']) {
    const got = pageFacts(page({top:{total, parts:null}})).floors[0].dimension_check.top;
    assert.deepEqual(got, {total:null, sum_of_parts:null});
  }
});

test('unreadable chain positions cannot be dropped to manufacture a complete sum', async () => {
  const { pageFacts } = await mod('plan-gate');
  for (const gap of [null, undefined, '', false, 'bad', 0, -1]) {
    const got = pageFacts(page({top:{total:1820, parts:[910,gap,910]}})).floors[0].dimension_check.top;
    assert.deepEqual(got, {total:1820, sum_of_parts:null});
  }
  const got = pageFacts(page({left:{total:null, parts:[910,910]}})).floors[0].dimension_check.left;
  assert.deepEqual(got, {total:null, sum_of_parts:1820});
});

test('legacy numeric and numeric-string evidence still produces the same dimension facts', async () => {
  const { pageFacts } = await mod('plan-gate');
  for (const total of [1820,'1820']) {
    assert.deepEqual(pageFacts(page({top:{total,parts:['910',910]}})).floors[0].dimension_check.top,
      {total:1820,sum_of_parts:1820});
  }
});

test('partially labelled and blank evidence survives decoder and applicable positive geometry', async () => {
  const { decodeCompactPlan } = await mod('plan-prompt');
  const { finishImportedPlan } = await mod('routes-ai');
  for (const dims of [undefined, null, {top:{total:1820,parts:[910,null]},bottom:null,left:{total:null,parts:null}}]) {
    const input = page(dims);
    input.notes = ['推定箇所と根拠の記録'];
    const decoded = decodeCompactPlan(input);
    assert.deepEqual(decoded.floors[0].dims, dims || null);
    const response = finishImportedPlan(input, null, {});
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.plan.rooms[0].w,1820);
    assert.deepEqual(body.plan.floors[0].dims,dims || null);
    assert.deepEqual(body.notes,input.notes);
  }
});

test('explicit no-scale refusal is non-applicable even alongside a valid page', async () => {
  const { finishImportedPlan } = await mod('routes-ai');
  const refused = {floors:[],notes:['実寸の根拠がありません']};
  for (const [parsed, extra] of [[refused,{}], [page(null),{pages:[page(null),refused]}]]) {
    const response = finishImportedPlan(parsed,{totalTokens:7},extra);
    assert.equal(response.status,422);
    const body = await response.json();
    assert.equal(body.plan,undefined);
    assert.equal(body.revisionCandidate,false);
    assert.ok(body.notes.includes(refused.notes[0]));
    assert.equal(body.usage.totalTokens,7);
  }
});

test('invalid core footprint never becomes an applicable plan; numeric legacy footprints still work', async () => {
  const { finishImportedPlan } = await mod('routes-ai');
  for (const value of [null,undefined,'',false,0,-10,'not a length']) {
    const input = page(null);
    input.floors[0].width=value;
    assert.equal(finishImportedPlan(input,null,{}).status,422);
  }
  const input = page(null); input.floors[0].width='1820';
  assert.equal(finishImportedPlan(input,null,{}).status,200);
});
