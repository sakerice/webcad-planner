'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const schema = require('./support/plan-schema.js');
const api = require('../../assets/js/legacy-plan-copy-dryrun.js');
const dryRun = api.createDryRunHelper(schema);
const clone = value => structuredClone(value);
const wall = (id, floor = 1, extra = {}) => ({ id, floor, x1: 0, y1: 0, x2: 1200, y2: 0, thick: 120, ...extra });
const item = (id, floor = 1, extra = {}) => ({ id, floor, type: 'anonymous-chair', x: 12, y: 34, w: 500, d: 400, rot: 90, ...extra });
const room = (id, floor = 1) => ({ id, floor, x: 0, y: 0, w: 2000, d: 2000 });
const plan = extra => ({ walls: [], items: [], rooms: [], ...extra });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const assertPrepared = result => { assert.equal(result.prepared, true); assert.equal(result.reviewOnly, true); for (const [name, valid] of Object.entries(result.invariants)) assert.equal(valid, true, name); };
const blockingCode = (result, code) => { assert.equal(result.prepared, false); assert.equal(result.candidate, null); assert.equal(result.mapping.length, 0); assert.ok(result.diagnostics.some(d => d.code === code), code); };

test('strict validator reference snapshots match the inspected, unchanged source', () => {
  const hashes = { 'plan-schema.js': '74c266cbd9f02dbcc61874843f8c243f417ec8bd78bc1723a19e7a0a7250655f', 'room-geometry.js': '54aff951d4dab57e8fcbd92dfac8c77034efcbae4a63d0ecf27a14d444165273' };
  for (const [file, digest] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'support', file))).digest('hex'), digest);
});

test('deterministic cross-floor numeric remap reserves every collection and room suffix', () => {
  const input = plan({ walls: [wall(7), wall(7, 2), wall(7, 3)], items: [item(8), item(8, 2)], rooms: [room('rm_99')] });
  const original = clone(input); freeze(input);
  const result = dryRun(input); assertPrepared(result);
  assert.deepEqual(result.mapping.map(m => [m.collection, m.index, m.oldId, m.newId, m.floor]), [['walls', 1, 7, 100, 2], ['walls', 2, 7, 101, 3], ['items', 1, 8, 102, 2]]);
  assert.deepEqual(result, dryRun(input));
  assert.deepEqual(input, original);
  assert.equal(result.candidate.walls[0].id, 7); assert.equal(result.candidate.items[0].id, 8);
  assert.equal(result.candidateValidation.ok, true);
});

test('cross-floor items preserve different types, geometry, exact fields and order', () => {
  const input = plan({ items: [item(9, 3, { type: 'anonymous-roof', parts: [{ cx: 9, cz: 2, w: 5, d: 8 }], texture: 'data:opaque', fmpId: 'asset-9' }), item(9, 2, { type: 'anonymous-stair', offset: 9, flipX: false, custom: { number: 9 } })] });
  const result = dryRun(input); assertPrepared(result);
  assert.deepEqual(result.candidate.items[0], input.items[0]);
  const expected = clone(input.items[1]); expected.id = 10;
  assert.deepEqual(result.candidate.items[1], expected);
  assert.equal(result.candidate.items[1].custom.number, 9);
  assert.equal(result.candidate.items[0].parts[0].cx, 9);
});

test('known map copies retain exact suffixes, values, originals and unknown fields', () => {
  const legacy = { mode: 'custom', color: '#123456', texture: 'data:opaque', textureFlipX: false, textureFlipY: true, skirting: false, privateExtension: { value: 7 } };
  const input = plan({ walls: [wall(7), wall(7, 2)],
    exteriorWallSettings: { whole: { linked: false }, floors: { 2: { linked: true } }, walls: { 7: clone(legacy), 99: { dormant: true } }, faces: { '7_-1_0_1200': clone(legacy), '7_unknown_suffix': { retained: true }, '70_1_0_1200': { unrelated: true } }, mystery: { wallIdLike: 7 } },
    interiorWallSettings: { whole: { unknown: true }, faces: { '7_1_0_1200': clone(legacy), '600_-1_0_20': { dormant: true } }, walls: { 7: { unsupportedLocation: true } } },
    custom: { walls: { 7: { opaque: true } }, number: 7 }
  });
  const result = dryRun(input); assertPrepared(result);
  assert.equal(result.mapping[0].newId, 8);
  assert.equal(result.settingsCopies.length, 4);
  assert.deepEqual(result.candidate.exteriorWallSettings.walls[8], legacy);
  assert.deepEqual(result.candidate.exteriorWallSettings.faces['8_-1_0_1200'], legacy);
  assert.deepEqual(result.candidate.exteriorWallSettings.faces['8_unknown_suffix'], { retained: true });
  assert.deepEqual(result.candidate.interiorWallSettings.faces['8_1_0_1200'], legacy);
  assert.equal(Object.hasOwn(result.candidate.exteriorWallSettings.faces, '80_1_0_1200'), false);
  assert.deepEqual(result.candidate.interiorWallSettings.walls, input.interiorWallSettings.walls);
  assert.deepEqual(result.candidate.custom, input.custom);
  result.candidate.exteriorWallSettings.walls[8].privateExtension.value = 'new-edit';
  assert.equal(result.candidate.exteriorWallSettings.walls[7].privateExtension.value, 7);
  assert.equal(input.exteriorWallSettings.walls[7].privateExtension.value, 7);
  result.candidate.interiorWallSettings.faces['8_1_0_1200'].texture = 'changed';
  assert.equal(result.candidate.interiorWallSettings.faces['7_1_0_1200'].texture, 'data:opaque');
});

test('allocator skips dormant map keys rather than overwriting unrelated appearance', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)], exteriorWallSettings: { walls: { 7: { legacy: true }, 8: { dormant: true } }, faces: { '9_1_0_20': { dormantFace: true } } }, interiorWallSettings: { faces: { '10_-1_0_20': { dormantFace: true } } } });
  const result = dryRun(input); assertPrepared(result);
  assert.equal(result.mapping[0].newId, 11);
  assert.deepEqual(result.candidate.exteriorWallSettings.walls[8], { dormant: true });
  assert.deepEqual(result.candidate.exteriorWallSettings.faces['9_1_0_20'], { dormantFace: true });
});

test('exact zero wall records and settings remain, and strict validation stays rejected', () => {
  const zeros = [1, 2, 3, 4].map(id => wall(100 + id, 1, { x2: 0, texture: 'opaque-' + id, locked: false, wallHeight: 2000 + id }));
  const input = plan({ walls: [wall(7), wall(7, 2), ...zeros], exteriorWallSettings: { walls: Object.fromEntries(zeros.map(w => [w.id, { texture: w.texture, custom: true }])) } });
  const result = dryRun(input); assertPrepared(result);
  assert.equal(result.zeroLengthWalls.length, 4); assert.equal(result.originalValidation.ok, false); assert.equal(result.originalValidation.errors.length, 5);
  assert.equal(result.candidateValidation.ok, false); assert.equal(result.candidateValidation.errors.length, 4);
  assert.deepEqual(result.candidate.walls.slice(2), zeros);
  assert.deepEqual(result.candidate.exteriorWallSettings.walls, input.exteriorWallSettings.walls);
  assert.deepEqual(result.candidateValidation, schema.validatePlan(result.candidate));
  assert.equal(Object.hasOwn(result.candidate, 'legacyAllowance'), false);
  assert.equal(Object.hasOwn(result.candidate, 'trusted'), false);
});

test('new zero wall is never admitted: dry-run may report it but normal strict import remains false', () => {
  const result = dryRun(plan({ walls: [wall(1, 1, { x2: 0 })] })); assertPrepared(result);
  assert.equal(result.status, 'no-op'); assert.equal(result.candidateValidation.ok, false);
  assert.equal(schema.validatePlan(result.candidate).ok, false);
});

test('same-floor duplicates, including implicit floor 1 and string numeric IDs, block', () => {
  for (const records of [[wall(7), wall(7)], [wall(7), { ...wall('7'), floor: null }], [{ ...wall(7), floor: undefined }, wall(7)]]) {
    if (records[0].floor === undefined) delete records[0].floor;
    const input = plan({ walls: records }), original = clone(input);
    blockingCode(dryRun(input), 'duplicate_within_floor'); assert.deepEqual(input, original);
  }
});

test('near-zero nonzero wall, invalid coordinate, invalid thickness and invalid floor block', () => {
  for (const bad of [{ x2: 0.4 }, { x1: NaN }, { x1: 'not-a-number' }, { x1: 1000001, x2: 1000001 }, { x2: 0, thick: 5 }, { floor: 6 }, { x2: 0, floor: 6 }]) {
    const input = plan({ walls: [wall(7), wall(7, 2), wall(99, 1, bad)] }), original = clone(input);
    assert.equal(dryRun(input).prepared, false); assert.deepEqual(input, original);
  }
});

test('invalid room and item data cannot be hidden by duplicate or zero error counts', () => {
  for (const extra of [{ rooms: [{ ...room('rm2'), w: 0 }] }, { items: [item(3, 1, { type: '' })] }, { rooms: [{ ...room('rm2'), x: 1000001 }] }]) {
    blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2), wall(12, 1, { x2: 0 })], ...extra })), 'unhandled_validation_errors');
  }
});

test('every explicit affected scalar or list reference blocks even with owner floor', () => {
  for (const field of api.referenceFields) {
    const value = field === 'faceKey' ? '7_-1_0_1200' : field.endsWith('Ids') ? [7] : 7;
    const input = plan({ walls: [wall(7), wall(7, 2)], items: [item(50, 2, { [field]: value })] });
    const result = dryRun(input); blockingCode(result, 'unhandled_identity_references');
    assert.ok(result.diagnostics.find(d => d.code === 'unhandled_identity_references').detail.some(d => d.field === field));
    assert.equal(result.plannedMapping[0].newId, null);
  }
});

test('nested explicit source maps, attachment and references fail closed without rewriting', () => {
  for (const field of api.referenceContainers) {
    const input = plan({ items: [item(9), item(9, 2)], custom: { deeply: { [field]: { opaque: { target: '9' } } } } });
    const original = clone(input); blockingCode(dryRun(input), 'unhandled_identity_references'); assert.deepEqual(input, original);
  }
});

test('unaffected baseRoom and source references remain exact, while affected room references block', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)], items: [item(50, 2, { baseRoom: 'rm5', wallId: 8 })], rooms: [room('rm5', 2)], sourceImport: { sourceIdMap: { source7: 50 } } });
  const result = dryRun(input); assertPrepared(result); assert.deepEqual(result.candidate.items, input.items); assert.deepEqual(result.candidate.sourceImport, input.sourceImport);
  assert.notEqual(result.mapping[0].newId, 8, 'Unrelated dangling wall reference must stay dangling');
  blockingCode(dryRun(plan({ rooms: [room('rm5'), room('rm5', 2)], items: [item(1, 2, { baseRoom: 'rm5' })] })), 'unhandled_identity_references');
});

test('fresh IDs never capture dangling scalar, face-key or source-map reference targets', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)],
    unknown: { selectedId: 8, faceKey: '9_-1_0_1200', sourceIdMap: { source: 10 }, attachment: { supportId: 11, faceKey: '12_1_0_1200' } } });
  const result = dryRun(input); assertPrepared(result);
  assert.equal(result.mapping[0].newId, 13);
  assert.deepEqual(result.candidate.unknown, input.unknown);
});

test('nested face-key reference inside a recognized container blocks affected prefix', () => {
  for (const container of api.referenceContainers) {
    blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2)], custom: { [container]: { nested: { faceKey: '7_-1_0_1200' } } } })), 'unhandled_identity_references');
  }
});

test('opaque reference container keys and composite values block affected identities', () => {
  for (const container of api.referenceContainers) {
    for (const value of [{ '7': 'external-source' }, { unrelated: '7_1_0_1200' }, { '7_-1_0_1200': { kind: 'wall' } }]) {
      blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2)], custom: { [container]: value } })), 'unhandled_identity_references');
    }
  }
});

test('dangling identity-keyed references are reserved and array positions are ignored', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)], references: { '8': { kind: 'wall' }, '9_1_0_1200': { kind: 'face' } }, attachment: ['other', 'other'] });
  const result = dryRun(input); assertPrepared(result); assert.equal(result.mapping[0].newId, 10);
  const arrayRefs = plan({ walls: [wall(1), wall(1, 2)], references: ['external', 'external'] });
  assertPrepared(dryRun(arrayRefs));
});

test('overlapping original wall ID prefixes block ambiguous face identity', () => {
  blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2), wall('7_1', 3)], interiorWallSettings: { faces: { '7_1_1_0_1200': { opaque: true } } } })), 'ambiguous_wall_face_prefix');
});

test('unhandled known-map shape blocks rather than dropping or creating settings', () => {
  for (const settings of [{ exteriorWallSettings: 'opaque' }, { exteriorWallSettings: { walls: [] } }, { interiorWallSettings: { faces: 'opaque' } }]) {
    blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2)], ...settings })), 'unsupported_settings_map');
  }
});

test('absent settings and missing IDs are not materialized or silently repaired', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)], items: [{ type: 'anonymous', x: 0, y: 0 }], rooms: [] });
  const result = dryRun(input); assertPrepared(result);
  assert.equal(Object.hasOwn(result.candidate, 'exteriorWallSettings'), false);
  assert.equal(Object.hasOwn(result.candidate.items[0], 'id'), false);
  assert.equal(result.settingsCopies.length, 0);
});

test('safe integer exhaustion blocks remaps, but no-op retains existing large ID', () => {
  const large = Number.MAX_SAFE_INTEGER;
  blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2)], items: [item(large)] })), 'allocator_exhausted');
  blockingCode(dryRun(plan({ walls: [wall(7), wall(7, 2)], rooms: [room('rm_9007199254740992')] })), 'allocator_range');
  const input = plan({ rooms: [room('rm_9007199254740992')] }); const result = dryRun(input); assertPrepared(result); assert.deepEqual(result.candidate, input);
});

test('pure no-op deep-copies all optional fields and preserves key/array order', () => {
  const input = plan({ walls: [wall(7)], items: [item(8, 2, { baseRoom: 'rm4' })], rooms: [room('rm4', 2)], unknown: { z: 1, a: [{ thing: false }], b: null }, exteriorWallSettings: { walls: { 7: { known: true }, 600: { dormant: true } }, faces: { '600_weird_suffix': { dormant: true } } } });
  const result = dryRun(input); assertPrepared(result); assert.equal(result.status, 'no-op'); assert.deepEqual(result.candidate, input); assert.deepEqual(Object.keys(result.candidate), Object.keys(input));
  result.candidate.unknown.a[0].thing = true; assert.equal(input.unknown.a[0].thing, false);
});

test('candidate round-trip and repeated dry-runs have no conversion drift', () => {
  const input = plan({ walls: [wall(7), wall(7, 2)], exteriorWallSettings: { walls: { 7: { unknown: { value: 7 } } }, faces: { '7_-1_0_1200': { texture: 'opaque' } } } });
  const first = dryRun(input); assertPrepared(first);
  const persistedLocallyInMemory = JSON.parse(JSON.stringify(first.candidate));
  const second = dryRun(persistedLocallyInMemory); assertPrepared(second); assert.equal(second.status, 'no-op'); assert.deepEqual(second.candidate, first.candidate);
});

test('JSON clone rejects cycles, unsupported values, sparse arrays and accessors safely', () => {
  const cycle = {}; cycle.back = cycle;
  const sparse = []; sparse.length = 1;
  const fakeDense = []; fakeDense.length = 1; fakeDense.foo = 1;
  const getter = {}; Object.defineProperty(getter, 'x', { get() { throw Error('must not run'); }, enumerable: true });
  for (const value of [cycle, undefined, Infinity, NaN, () => 1, new Date(), sparse, fakeDense, getter]) blockingCode(dryRun(plan({ custom: value })), 'invalid_json_or_validator');
});

test('literal __proto__ keys remain data and do not modify object prototypes', () => {
  const input = JSON.parse('{"walls":[],"items":[],"rooms":[],"unknown":{"__proto__":{"polluted":true}}}');
  const result = dryRun(input); assertPrepared(result); assert.equal({}.polluted, undefined); assert.deepEqual(result.candidate, input); assert.equal(Object.hasOwn(result.candidate.unknown, '__proto__'), true);
});

test('hidden toJSON and hidden accessors are rejected without executing caller code', () => {
  let called = 0;
  for (const descriptor of [{ value() { called++; this.metadata = 'mutated'; return {}; } }, { get() { called++; throw Error('must not run'); } }]) {
    const input = plan({ walls: [wall(1)] }); Object.defineProperty(input, 'toJSON', { ...descriptor, enumerable: false });
    blockingCode(dryRun(input), 'invalid_json_or_validator'); assert.equal(Object.hasOwn(input, 'metadata'), false);
  }
  assert.equal(called, 0);
});

test('invalid object floor cannot throw even when strict coordinates return early', () => {
  const input = plan({ walls: [wall(7, { toString: null }, { x1: 'invalid' })] });
  blockingCode(dryRun(input), 'unhandled_validation_errors');
});

test('candidate validator exceptions and malformed results return blocked safely', () => {
  for (const failure of [() => { throw Error('candidate validation failed'); }, () => ({ ok: false, errors: null, warnings: [] })]) {
    let calls = 0;
    const validator = { LIMITS: schema.LIMITS, validatePlan(input) { return ++calls === 1 ? schema.validatePlan(input) : failure(); } };
    const input = plan({ walls: [wall(7), wall(7, 2)] }), original = clone(input);
    blockingCode(api.createDryRunHelper(validator)(input), 'planning_or_candidate_validation_failed'); assert.deepEqual(input, original);
  }
});

test('null and undefined thrown validator values also return blocked on either call', () => {
  for (const thrown of [null, undefined]) for (const failingCall of [1, 2]) {
    let calls = 0;
    const validator = { LIMITS: schema.LIMITS, validatePlan(input) { if (++calls === failingCall) throw thrown; return schema.validatePlan(input); } };
    const input = plan({ walls: [wall(7), wall(7, 2)] });
    blockingCode(api.createDryRunHelper(validator)(input), failingCall === 1 ? 'invalid_json_or_validator' : 'planning_or_candidate_validation_failed');
  }
});

test('validator runs before planning, normalizer is never used and diagnostic language is opaque', () => {
  let calls = 0;
  const validator = { LIMITS: schema.LIMITS, normalizePlan() { throw Error('Must not normalize'); }, validatePlan(input) { calls++; const result = schema.validatePlan(input); result.errors = result.errors.map((_, i) => 'Opaque strict failure ' + i); return result; } };
  const run = api.createDryRunHelper(validator);
  const result = run(plan({ walls: [wall(7), wall(7, 2), wall(9, 1, { x2: 0 })] })); assertPrepared(result);
  assert.equal(calls, 2); assert.deepEqual(result.originalValidation.errors, ['Opaque strict failure 0', 'Opaque strict failure 1']); assert.deepEqual(result.candidateValidation.errors, ['Opaque strict failure 0']); assert.equal(result.candidateValidation.ok, false);
});

test('invalid collection shape is blocked without touching any external state', () => {
  const input = { walls: [], items: [], rooms: 'opaque', currentPlanId: 'keep-me' }, original = clone(input);
  blockingCode(dryRun(input), 'unsupported_plan_shape'); assert.deepEqual(input, original);
});
