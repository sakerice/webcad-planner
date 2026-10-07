'use strict';
// Anonymous direct-repository regressions. The existing IndexedDB contract
// simulator proves staging/rollback boundaries, not browser disk durability.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
const Repository = require('../../assets/js/plan-repository-lab.js');
const {memoryIDB} = require('./plan-library-test-support.cjs');

let serial = 0;
const protectedStores = ['plans', 'revisions', 'migrations', 'rawSources'];
function fixture() {
 return {
  walls: [
   {id: 10, floor: 1, x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120},
   {id: 10, floor: 2, x1: 0, y1: 0, x2: 1000, y2: 0, thick: 120},
   {id: 30, floor: 2, x1: 20, y1: 30, x2: 20, y2: 30, thick: 120,
    anonymousMarker: 'retained-zero'}
  ],
  rooms: [{id: 40, floor: 1, x: 0, y: 0, w: 1000, d: 1000}],
  items: [],
  extension: {marker: 'anonymous-source-cas-fixture'}
 };
}
function deferred() {
 let resolve;
 const promise = new Promise(r => { resolve = r; });
 return {promise, resolve};
}
function digestBarrier() {
 let target = null;
 const entered = deferred(), released = deferred();
 const customCrypto = {
  randomUUID: () => crypto.randomUUID(),
  subtle: {
   async digest(algorithm, bytes) {
    if (target !== null && new TextDecoder().decode(bytes) === target) {
     target = null;
     entered.resolve();
     await released.promise;
    }
    return crypto.subtle.digest(algorithm, bytes);
   }
  }
 };
 return {
  customCrypto,
  arm(value) { target = value; },
  entered: entered.promise,
  release() { released.resolve(); }
 };
}
async function setup(customCrypto = crypto) {
 const mem = memoryIDB();
 global.IDBKeyRange = mem.keyRange;
 const name = 'webcad-plan-library-lab-source-cas-' + (++serial);
 const repo = Repository.create({indexedDB: mem.idb, crypto: customCrypto, name});
 const original = fixture(), raw = JSON.stringify(original);
 const imported = await repo.importSource({sourceId: 'anonymous-source-' + serial, kind: 'plan', raw});
 const originalId = imported.plans[0].planId;
 const review = await repo.prepareLegacyCopy(originalId);
 await repo.createLegacyCopy(review, 'converted', 'Anonymous converted', 'create');
 const saved = await repo.read('converted');
 return {repo, mem, name, original, raw, imported, originalId, saved};
}
function store(h, name) {
 return h.mem.dbs.get(h.name).stores.get(name);
}
function protectedSnapshot(h) {
 return Object.fromEntries(protectedStores.map(name => [
  name,
  structuredClone([...store(h, name)].sort(([a], [b]) => String(a).localeCompare(String(b))))
 ]));
}
function state(h, overrides = {}) {
 return {
  plan: h.saved.payload,
  payload: h.saved.payload,
  dirty: true,
  generation: 3,
  baseRevisionId: h.saved.revision.id,
  baseGeneration: h.saved.head.headGeneration,
  ...overrides
 };
}
async function draft(h, overrides = {}) {
 return h.repo.saveDraft('anonymous-session', 'converted', state(h, overrides));
}
function request(h, payload = h.saved.payload, planId = 'child') {
 return {planId, operationId: 'derive', payload, kind: 'derived-plan', baseRevisionId: null, baseGeneration: 0};
}
async function absentChild(h, planId = 'child') {
 assert.equal(await h.repo.read(planId), null);
 assert.equal(await h.repo.get('revisions', planId + ':derive'), undefined);
 assert.equal(await h.repo.get('migrations', 'legacy-copy-contract:' + planId), undefined);
}

const invalidNumbers = [
 ['missing', Symbol('missing')],
 ['undefined', undefined],
 ['null', null],
 ['string', '3'],
 ['fraction', 3.5],
 ['negative', -1],
 ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
 ['NaN', NaN],
 ['infinite', Infinity]
];
for (const field of ['generation', 'baseGeneration']) {
 for (const [label, value] of invalidNumbers) {
  test('source ticket rejects ' + label + ' draft ' + field + ' before archive or child writes', async () => {
   const h = await setup(), metadata = state(h);
   if (typeof value === 'symbol') delete metadata[field];
   else metadata[field] = value;
   // saveDraft is intentionally the public entry point. If it becomes stricter,
   // an earlier rejection is also fail-closed; malformed stored drafts are still
   // exercised through the same source-ticket API below.
   let d;
   try {
    d = await h.repo.saveDraft('anonymous-session', 'converted', metadata);
   } catch (error) {
    assert.match(error.message, /validation|generation|draft|non_json/);
    d = {...structuredClone(metadata), id: JSON.stringify(['anonymous-session', 'converted']),
     sessionId: 'anonymous-session', planId: 'converted'};
    store(h, 'drafts').set(d.id, d);
   }
   const before = protectedSnapshot(h);
   await assert.rejects(
    h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation),
    /validation|generation|stale_derivation_source/
   );
   assert.deepEqual(protectedSnapshot(h), before);
   assert.equal([...store(h, 'rawSources').values()].some(r => r.sourceOwner), false);
   await absentChild(h);
  });
 }
}

for (const baseGeneration of [0, 1, 7, Number.MAX_SAFE_INTEGER]) {
 test('source ticket supports nonnegative safe base generation ' + baseGeneration, async () => {
  const h = await setup(), d = await draft(h, {generation: 0, baseGeneration});
  const ticket = await h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation);
  const result = await h.repo.derive(request(h), 'converted', h.saved.revision.id, ticket);
  assert.equal(result.status, 'saved');
  const child = await h.repo.read('child');
  assert.deepEqual(child.payload, h.saved.payload);
  assert.equal(child.head.origin.sourceSnapshot.generation, 0);
  assert.equal(child.head.origin.sourceSnapshot.baseGeneration, baseGeneration);
 });
}

for (const mode of ['generation', 'exact payload', 'payload values', 'base revision', 'base generation',
 'identity', 'plan identity']) {
 test('repository source CAS rejects changed draft ' + mode + ' after early proof and before child transaction',
  {timeout: 10000}, async () => {
   const gate = digestBarrier(), h = await setup(gate.customCrypto), d = await draft(h);
   const ticket = await h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation);
   const payload = structuredClone(h.saved.payload);
   payload.extension.marker = 'anonymous-child-hash-barrier-' + mode;
   gate.arm(JSON.stringify(payload));
   // The child digest is reached only after derive's initial source freshness
   // proof. No host callback or isCurrent option is supplied to the repository.
   const pending = h.repo.derive(request(h, payload), 'converted', h.saved.revision.id, ticket);
   const rejected = assert.rejects(pending, /stale_derivation_source/);
   let before;
   try {
    await gate.entered;
    if (mode === 'generation') await draft(h, {generation: 4});
    else if (mode === 'base generation') await draft(h, {baseGeneration: d.baseGeneration + 1});
    else if (mode === 'base revision') store(h, 'drafts').get(d.id).baseRevisionId = 'converted:other-revision';
    else if (mode === 'payload values') store(h, 'drafts').get(d.id).payload.rooms[0].x = 900;
    else if (mode === 'identity') store(h, 'drafts').get(d.id).id = 'anonymous-other-draft';
    else if (mode === 'plan identity') store(h, 'drafts').get(d.id).planId = 'anonymous-other-plan';
    else {
     // Change bytes without changing JSON values. A value-only comparison must
     // not admit a different draft snapshot under an already-issued ticket.
     const current = store(h, 'drafts').get(d.id), changed = structuredClone(current.payload);
     current.payload = Object.fromEntries(Object.entries(changed).reverse());
     assert.deepEqual(current.payload, changed);
     assert.notEqual(JSON.stringify(current.payload), JSON.stringify(changed));
    }
    before = protectedSnapshot(h);
   } finally {
    gate.release();
   }
   await rejected;
   assert.deepEqual(protectedSnapshot(h), before);
   await absentChild(h);
  });
}

for (const timing of ['before early proof', 'after early proof']) {
 test('source owner-only mismatch ' + timing + ' rejects child without writes', {timeout: 10000}, async () => {
  const gate = digestBarrier(), h = await setup(gate.customCrypto), d = await draft(h);
  const ticket = await h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation);
  const archive = store(h, 'rawSources').get(ticket.sourceSnapshotId);
  const raw = archive.raw, rawDigest = archive.rawDigest;
  const payload = structuredClone(h.saved.payload);
  payload.extension.marker = 'anonymous-owner-barrier-' + timing;
  let pending, before;
  if (timing === 'before early proof') {
   archive.sourceOwner.parentRevisionId = 'converted:wrong-parent';
   before = protectedSnapshot(h);
   pending = h.repo.derive(request(h, payload), 'converted', h.saved.revision.id, ticket);
  } else {
   gate.arm(JSON.stringify(payload));
   pending = h.repo.derive(request(h, payload), 'converted', h.saved.revision.id, ticket);
   // Install the rejection handler before releasing an asynchronous operation.
   pending.catch(() => {});
   try {
    await gate.entered;
    store(h, 'rawSources').get(ticket.sourceSnapshotId).sourceOwner.parentRevisionId = 'converted:wrong-parent';
    before = protectedSnapshot(h);
   } finally {
    gate.release();
   }
  }
  await assert.rejects(pending, /lineage|raw_source|stale_derivation_source/);
  assert.deepEqual(protectedSnapshot(h), before);
  const unchangedBytes = store(h, 'rawSources').get(ticket.sourceSnapshotId);
  assert.equal(unchangedBytes.raw, raw);
  assert.equal(unchangedBytes.rawDigest, rawDigest);
  await absentChild(h);
 });
}

test('named parent revision bytes and digest changed after early proof reject child without writes',
 {timeout: 10000}, async () => {
  const gate = digestBarrier(), h = await setup(gate.customCrypto), d = await draft(h);
  const ticket = await h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation);
  const payload = structuredClone(h.saved.payload);
  payload.extension.marker = 'anonymous-named-revision-barrier';
  gate.arm(JSON.stringify(payload));
  const pending = h.repo.derive(request(h, payload), 'converted', h.saved.revision.id, ticket);
  const rejected = assert.rejects(pending, /stale_derivation_source/);
  let before;
  try {
   await gate.entered;
   const revision = store(h, 'revisions').get(h.saved.revision.id);
   const changed = JSON.parse(revision.payload);
   changed.rooms[0].x = 901;
   revision.payload = JSON.stringify(changed);
   revision.payloadDigest = await h.repo.digest(revision.payload);
   assert.notEqual(revision.payload, h.saved.revision.payload);
   assert.notEqual(revision.payloadDigest, h.saved.revision.payloadDigest);
   before = protectedSnapshot(h);
  } finally {
   gate.release();
  }
  await rejected;
  assert.deepEqual(protectedSnapshot(h), before);
  await absentChild(h);
 });

test('a newer latest parent head during child hashing leaves the unchanged named source usable',
 {timeout: 10000}, async () => {
  const gate = digestBarrier(), h = await setup(gate.customCrypto), d = await draft(h);
  const ticket = await h.repo.prepareDerivationSource('converted', h.saved.revision.id, d.id, d.generation);
  const payload = structuredClone(h.saved.payload);
  payload.extension.marker = 'anonymous-historical-source-barrier';
  gate.arm(JSON.stringify(payload));
  const pending = h.repo.derive(request(h, payload), 'converted', h.saved.revision.id, ticket);
  pending.catch(() => {});
  let later;
  try {
   await gate.entered;
   const newer = structuredClone(h.saved.payload);
   newer.rooms[0].x = 902;
   later = await h.repo.save({planId: 'converted', operationId: 'concurrent-parent-head', payload: newer,
    baseRevisionId: h.saved.revision.id, baseGeneration: h.saved.head.headGeneration});
   assert.equal(later.status, 'saved');
  } finally {
   gate.release();
  }
  assert.equal((await pending).status, 'saved');
  const child = await h.repo.read('child');
  assert.deepEqual(child.payload, payload);
  assert.equal(child.head.origin.copiedFromRevisionId, h.saved.revision.id);
  assert.equal((await h.repo.read('converted')).revision.id, later.revisionId);
  assert.equal((await h.repo.get('drafts', d.id)).baseRevisionId, h.saved.revision.id);
 });

test('a differing dirty source commits and remains readable after newer drafts and parent heads', async () => {
 const h = await setup(), withoutZero = structuredClone(h.saved.payload);
 withoutZero.walls = withoutZero.walls.filter(w => w.id !== 30);
 const parent = await h.repo.save({planId: 'converted', operationId: 'remove-zero', payload: withoutZero,
  baseRevisionId: h.saved.revision.id, baseGeneration: h.saved.head.headGeneration});
 const source = structuredClone(h.saved.payload);
 source.rooms[0].x = 500;
 source.extension.marker = 'anonymous-legitimate-dirty-source';
 const d = await draft(h, {plan: source, payload: source,
  baseRevisionId: parent.revisionId, baseGeneration: parent.head.headGeneration});
 const ticket = await h.repo.prepareDerivationSource('converted', parent.revisionId, d.id, d.generation);
 const payload = structuredClone(source);
 payload.rooms[0].x = 650;
 const result = await h.repo.derive(request(h, payload), 'converted', parent.revisionId, ticket);
 assert.equal(result.status, 'saved');
 const registration = await h.repo.get('migrations', 'legacy-copy-contract:child');
 const archived = await h.repo.get('rawSources', registration.sourceSnapshot.id);
 assert.deepEqual(JSON.parse(archived.raw), source);
 assert.equal(await h.repo.digest(archived.raw), registration.sourceSnapshot.digest);
 assert.equal(archived.sourceOwner.parentRevisionId, parent.revisionId);
 assert.equal((await h.repo.read('converted')).payload.walls.some(w => w.id === 30), false);
 const laterParent = structuredClone(withoutZero);
 laterParent.rooms[0].x = 800;
 await h.repo.save({planId: 'converted', operationId: 'later-parent', payload: laterParent,
  baseRevisionId: parent.revisionId, baseGeneration: parent.head.headGeneration});
 await draft(h, {plan: laterParent, payload: laterParent, generation: 4,
  baseRevisionId: 'converted:later-parent', baseGeneration: parent.head.headGeneration + 1});
 await h.repo.close();
 const reopened = Repository.create({indexedDB: h.mem.idb, crypto, name: h.name});
 const child = await reopened.read('child');
 assert.deepEqual(child.payload, payload);
 assert.equal(child.head.origin.copiedFromRevisionId, parent.revisionId);
 assert.equal(child.head.origin.sourceSnapshot.generation, 3);
 assert.deepEqual(await reopened.get('rawSources', registration.sourceSnapshot.id), archived);
 const edited = structuredClone(payload);
 edited.rooms[0].x = 700;
 const saved = await reopened.save({planId: 'child', operationId: 'later-child', payload: edited,
  baseRevisionId: child.revision.id, baseGeneration: child.head.headGeneration});
 assert.equal(saved.status, 'saved');
 assert.deepEqual((await reopened.read('child')).payload, edited);
 assert.deepEqual((await reopened.read('child', child.revision.id)).payload, payload);
});
