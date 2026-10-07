'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, PlanSchema, dryRun, realFunction, appearanceContext, plain, wall, shell, settingsFixture } = require('./legacy-appearance-support.cjs');
const { memoryIDB } = require('./plan-library-test-support.cjs');
const PlanRepositoryLab = require('../../assets/js/plan-repository-lab.js');

function assertMapsContainOriginals(candidate, original) {
  for (const [settings, maps] of [['exteriorWallSettings', ['walls', 'faces']], ['interiorWallSettings', ['faces']]]) {
    for (const map of maps) for (const [key, value] of Object.entries(original[settings][map])) {
      assert.ok(Object.hasOwn(candidate[settings][map], key), settings + '.' + map + '.' + key);
      assert.deepEqual(plain(candidate[settings][map][key]), value, 'Exact original entry: ' + key);
    }
  }
}
function currentAppearances(c, floor) {
  const w = c.DATA.walls.find(w => w.floor === floor && w.y1 === 0 && w.y2 === 0);
  const exterior = c.getWallExteriorSpans(w), interior = c.getWallInteriorFaces(w);
  assert.equal(exterior.length, 1); assert.equal(interior.length, 1);
  assert.equal(exterior[0].sign, -1); assert.equal(interior[0].sign, 1);
  assert.equal(exterior[0].a, 0); assert.equal(exterior[0].b, 2.4);
  assert.equal(interior[0].a, 0); assert.equal(interior[0].b, 2.4);
  return plain({ wall: c.resolveExteriorWallAppearance(w),
    exterior: c.resolveExteriorFaceAppearance(w, exterior[0]),
    interior: c.resolveInteriorFaceAppearance(w, interior[0]),
    interiorWall: c.resolveInteriorWallAppearance(w) });
}

test('actual strict validator is byte-identical and still rejects cross-floor duplicate and exact-zero walls', () => {
  for (const [file, digest] of [['plan-schema.js', '74c266cbd9f02dbcc61874843f8c243f417ec8bd78bc1723a19e7a0a7250655f'],
    ['room-geometry.js', '54aff951d4dab57e8fcbd92dfac8c77034efcbae4a63d0ecf27a14d444165273']]) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets/js', file))).digest('hex'), digest);
  }
  assert.equal(PlanSchema.validatePlan(settingsFixture()).ok, false);
  assert.equal(PlanSchema.validatePlan({ walls: [wall(1, 1, 0, 0, 0, 0)], items: [], rooms: [] }).ok, false);
});

test('real sync retains dormant and unknown exterior maps without rewriting entries or inspecting geometry', () => {
  const original = settingsFixture(), c = appearanceContext(original);
  const walls = c.DATA.exteriorWallSettings.walls, faces = c.DATA.exteriorWallSettings.faces;
  const entryReferences = Object.entries(faces);
  c.syncExteriorWallSettings();
  assert.equal(c.DATA.exteriorWallSettings.walls, walls);
  assert.equal(c.DATA.exteriorWallSettings.faces, faces);
  for (const [key, value] of entryReferences) assert.equal(faces[key], value);
  assertMapsContainOriginals(c.DATA, original);
  c.DATA.walls = [];
  c.syncExteriorWallSettings();
  assertMapsContainOriginals(c.DATA, original);
});

test('real geometry and exact recognized appearance lookups match after helper remapping and copied-key round trip', () => {
  const original = settingsFixture(), before = structuredClone(original), source = appearanceContext(original);
  const baseline = currentAppearances(source, 1);
  assert.deepEqual(baseline.wall, { color: '#112233', texture: 'data:anonymous-exterior-wall', textureFlipX: true, textureFlipY: false, source: 'wall' });
  assert.deepEqual(baseline.exterior, { color: '#223344', texture: 'data:anonymous-exterior-face', source: 'face', textureFlipX: false, textureFlipY: true });
  assert.deepEqual(baseline.interior, { color: '#334455', texture: 'data:anonymous-interior-face', source: 'face', textureFlipX: true, textureFlipY: true });
  const prepared = dryRun(original);
  assert.equal(prepared.prepared, true); assert.equal(prepared.candidateValidation.ok, true);
  const mapping = prepared.mapping.find(m => m.collection === 'walls' && m.floor === 2);
  assert.ok(mapping); assert.notEqual(mapping.newId, mapping.oldId);
  const copied = appearanceContext(prepared.candidate);
  copied.ensureExteriorWallSettings(); copied.ensureInteriorWallSettings(); copied.syncExteriorWallSettings();
  assertMapsContainOriginals(copied.DATA, original);
  assert.deepEqual(plain(copied.DATA.exteriorWallSettings.walls[mapping.newId]), original.exteriorWallSettings.walls[7]);
  assert.deepEqual(plain(copied.DATA.exteriorWallSettings.faces[mapping.newId + '_dormant_suffix']), original.exteriorWallSettings.faces['7_dormant_suffix']);
  assert.deepEqual(plain(copied.DATA.interiorWallSettings.faces[mapping.newId + '_dormant_suffix']), original.interiorWallSettings.faces['7_dormant_suffix']);
  assert.deepEqual(currentAppearances(copied, 1), baseline);
  assert.deepEqual(currentAppearances(copied, 2), baseline);
  const saved = copied.serializeDataSnapshot();
  const reloaded = appearanceContext(JSON.parse(saved));
  reloaded.syncExteriorWallSettings();
  assertMapsContainOriginals(reloaded.DATA, original);
  assert.deepEqual(currentAppearances(reloaded, 2), baseline);
  assert.deepEqual(original, before, 'The helper and extracted source did not mutate the source fixture');
});

test('real strict JSON staging, snapshot save and repeat staging preserve original and copied maps', () => {
  const original = settingsFixture(), prepared = dryRun(original), c = appearanceContext({ walls: [], rooms: [], items: [] });
  const live = c.DATA, state = c.ST, allocator = c.nextId, height = c.WALL_H;
  const staged = c.stageJsonImport(JSON.stringify(prepared.candidate));
  assert.equal(c.DATA, live); assert.equal(c.ST, state); assert.equal(c.nextId, allocator); assert.equal(c.WALL_H, height);
  assertMapsContainOriginals(staged.data, original);
  c.DATA = staged.data;
  const appearance = currentAppearances(c, 2), saved = c.serializeDataSnapshot();
  const reload = c.stageJsonImport(saved);
  assertMapsContainOriginals(reload.data, original);
  for (const [settings, map] of [['exteriorWallSettings', 'walls'], ['exteriorWallSettings', 'faces'], ['interiorWallSettings', 'faces']]) {
    assert.deepEqual(plain(reload.data[settings][map]), plain(staged.data[settings][map]));
  }
  c.DATA = reload.data;
  assert.deepEqual(currentAppearances(c, 2), appearance);
  assert.deepEqual(plain(c.DATA.customPlanField), original.customPlanField);
});

test('exact-zero legacy wall and face settings survive real sync and serialization while strict import stays rejected', () => {
  const original = settingsFixture(); original.walls = [wall(90, 1, 400, 500, 400, 500, { locked: false, wallHeight: 2100 })];
  original.exteriorWallSettings.walls[90] = { color: '#cc8844', texture: 'data:anonymous-zero-wall', textureFlipX: true, textureFlipY: false, custom: { keep: true } };
  original.exteriorWallSettings.faces['90_-1_0_0'] = { mode: 'custom', texture: 'data:anonymous-zero-face', textureFlipX: false, textureFlipY: true, dormant: true };
  const c = appearanceContext(original);
  assert.deepEqual(plain(c.getWallExteriorSpans(c.DATA.walls[0])), []);
  assert.deepEqual(plain(c.getWallInteriorFaces(c.DATA.walls[0])), []);
  c.syncExteriorWallSettings();
  assertMapsContainOriginals(c.DATA, original);
  const saved = c.serializeDataSnapshot(), reloaded = appearanceContext(JSON.parse(saved));
  reloaded.syncExteriorWallSettings();
  assertMapsContainOriginals(reloaded.DATA, original);
  assert.deepEqual(plain(reloaded.DATA.walls), original.walls);
  assert.equal(PlanSchema.validatePlan(reloaded.DATA).ok, false);
  assert.throws(() => reloaded.stageJsonImport(saved));
});

test('real repository-proven zero copy survives admitted stage/save/reload with exact records and opaque roof fields', async () => {
  const original = settingsFixture();
  const inert = wall(90, 2, 4200, 1800, 4200, 1800, {
    locked: false, wallHeight: 2175, wallStyle: 'solid', exteriorColor: '#bb5500',
    exteriorTexture: 'data:anonymous-inert-record', exteriorTextureFlipX: true,
    exteriorTextureFlipY: false, extraWallField: { exact: ['keep', false, null, 19] }
  });
  original.walls.push(inert);
  original.exteriorWallSettings.walls[90] = { color: '#cc8844', texture: 'data:anonymous-zero-map', textureFlipX: true, textureFlipY: false, custom: { keep: true } };
  original.exteriorWallSettings.faces['90_-1_0_0'] = { mode: 'custom', texture: 'data:anonymous-zero-face', textureFlipX: false, textureFlipY: true, dormant: true };
  original.interiorWallSettings.faces['90_1_0_0'] = { mode: 'custom', texture: 'data:anonymous-zero-interior', textureFlipX: true, textureFlipY: true, custom: ['opaque'] };
  original.roofAppearance = { linked: false, color: '#123abc', texture: 'data:anonymous-legacy-roof', textureFlipX: true, textureFlipY: false,
    optionalUnknownRoofProperty: { retained: ['opaque-roof', false, null] } };
  const raw = '  ' + JSON.stringify(original) + '\n';
  const mem = memoryIDB(), repo = PlanRepositoryLab.create({ indexedDB: mem.idb, crypto: crypto.webcrypto, name: 'webcad-plan-library-lab-appearance-test' });
  const imported = await repo.importSource({ sourceId: 'anonymous-appearance-source', kind: 'plan', raw });
  assert.equal(imported.plans.length, 1);
  const originalId = imported.plans[0].planId, originalHead = await repo.read(originalId);
  const review = await repo.prepareLegacyCopy(originalId);
  assert.equal(review.report.prepared, true); assert.equal(review.report.candidateValidation.ok, false);
  const copyId = 'anonymous-admitted-appearance-copy';
  const created = await repo.createLegacyCopy(review, copyId, 'Anonymous copy', 'appearance-copy');
  assert.equal(created.status, 'saved');
  const loaded = await repo.read(copyId), token = await repo.admission(copyId, loaded.payload);
  assert.equal(repo.isAdmission(token), true); assert.equal(PlanSchema.validatePlan(loaded.payload).ok, false);
  const c = appearanceContext({ walls: [], items: [], rooms: [] }); c.PlanLibrary = { repo };
  assert.throws(() => c.stageJsonImport(JSON.stringify(loaded.payload)), 'Ordinary JSON must remain strict');
  const staged = c.stageJsonImport(JSON.stringify(loaded.payload), token);
  assert.equal(staged.legacyAdmission, token);
  assertMapsContainOriginals(staged.data, original);
  assert.deepEqual(plain(staged.data.walls.find(w => w.id === 90)), inert);
  assert.ok(Object.hasOwn(staged.data.roofAppearance, 'optionalUnknownRoofProperty'), 'Admitted roof migration must retain unknown root fields');
  assert.deepEqual(plain(staged.data.roofAppearance.optionalUnknownRoofProperty), original.roofAppearance.optionalUnknownRoofProperty);
  c.DATA = staged.data;
  const baseline = currentAppearances(c, 2), snapshot = c.serializeDataSnapshot();
  const saved = await repo.save({ planId: copyId, operationId: 'appearance-save', baseRevisionId: loaded.revision.id,
    baseGeneration: loaded.head.headGeneration, payload: JSON.parse(snapshot) });
  assert.equal(saved.status, 'saved');
  const reload = await repo.read(copyId), newToken = await repo.admission(copyId, reload.payload);
  const restaged = c.stageJsonImport(JSON.stringify(reload.payload), newToken);
  assertMapsContainOriginals(restaged.data, original);
  assert.deepEqual(plain(restaged.data.walls.find(w => w.id === 90)), inert);
  assert.ok(Object.hasOwn(restaged.data.roofAppearance, 'optionalUnknownRoofProperty'), 'Reloaded admitted roof must retain unknown root fields');
  assert.deepEqual(plain(restaged.data.roofAppearance.optionalUnknownRoofProperty), original.roofAppearance.optionalUnknownRoofProperty);
  c.DATA = restaged.data;
  assert.deepEqual(currentAppearances(c, 2), baseline);
  assert.equal(PlanSchema.validatePlan(c.DATA).ok, false);
  const alteredInert = plain(c.DATA); alteredInert.walls.find(w => w.id === 90).extraWallField.exact[0] = 'changed';
  assert.equal(repo.validateAdmission(alteredInert, newToken).ok, false, 'A token cannot authorize a changed inert record');
  assert.throws(() => c.stageJsonImport(JSON.stringify(alteredInert), newToken));
  assert.equal((await repo.get('rawSources', imported.snapshotId)).raw, raw);
  const retainedOriginal = await repo.read(originalId);
  assert.equal(retainedOriginal.revision.id, originalHead.revision.id);
  assert.deepEqual(retainedOriginal.payload, original);
  await repo.close();
});

test('real ordinary roof migration retains every legacy root field and existing floor setting', () => {
  const fixture = settingsFixture(); fixture.walls = shell(1, 7);
  fixture.roofAppearance = { linked: true, color: '#123abc', texture: 'data:anonymous-ordinary-roof', textureFlipX: true, textureFlipY: false,
    optionalUnknownRoofProperty: { retain: ['root-extension', false] },
    floors: { 2: { linked: true, color: '#567def', texture: 'data:anonymous-roof-floor', textureFlipX: false, textureFlipY: true,
      customFloorExtension: { retain: 'floor-extension' } } } };
  const before = structuredClone(fixture.roofAppearance), c = appearanceContext({ walls: [], items: [], rooms: [] });
  const staged = c.stageJsonImport(JSON.stringify(fixture));
  for (const [key, value] of Object.entries(before)) {
    if (key !== 'floors') assert.deepEqual(plain(staged.data.roofAppearance[key]), value, 'Legacy roof root: ' + key);
  }
  assert.deepEqual(plain(staged.data.roofAppearance.floors[2]), before.floors[2]);
  c.DATA = staged.data;
  assert.deepEqual(plain(c.resolveRoofAppearance({ floor: 2 })), { color: '#123abc', texture: 'data:anonymous-ordinary-roof', source: 'whole', textureFlipX: true, textureFlipY: false });
  c.DATA.roofAppearance.whole.linked = false;
  assert.deepEqual(plain(c.resolveRoofAppearance({ floor: 2 })), { color: '#567def', texture: 'data:anonymous-roof-floor', source: 'floor', textureFlipX: false, textureFlipY: true });
  for (const roofAppearance of ['anonymous-legacy-string', []]) {
    c.DATA.roofAppearance = roofAppearance;
    assert.equal(c.ensureRoofAppearance().whole.color, '#2a2a30', 'Keep prior malformed-shape fallback');
  }
});

test('unknown suffixes remain inert: real resolver uses recognized keys only and retains dormant values', () => {
  const original = settingsFixture(); original.walls = shell(1, 7);
  delete original.exteriorWallSettings.walls[7];
  delete original.exteriorWallSettings.faces['7_-1_0_2400'];
  delete original.interiorWallSettings.faces['7_1_0_2400'];
  const c = appearanceContext(original), appearances = currentAppearances(c, 1);
  assert.equal(appearances.wall.color, '#405060'); assert.equal(appearances.wall.texture, null);
  assert.equal(appearances.exterior.color, '#405060'); assert.equal(appearances.exterior.texture, null);
  assert.equal(appearances.interior.color, c.INTERIOR_WALL_DEFAULT); assert.equal(appearances.interior.texture, null);
  assert.equal(appearances.interior.source, 'default');
  assert.equal(c.getExteriorFaceSetting(c.DATA.walls[0], c.getWallExteriorSpans(c.DATA.walls[0])[0]).mode, 'inherit');
  assert.equal(c.getInteriorFaceSetting(c.DATA.walls[0], c.getWallInteriorFaces(c.DATA.walls[0])[0]).mode, 'inherit');
  assertMapsContainOriginals(c.DATA, original);
  assert.deepEqual(plain(c.DATA.exteriorWallSettings.faces['7_dormant_suffix']), original.exteriorWallSettings.faces['7_dormant_suffix']);
  c.syncExteriorWallSettings();
  assertMapsContainOriginals(c.DATA, original);
});

test('real face/whole/floor and existing interior appearance precedence preserve texture orientation', () => {
  const fixture = settingsFixture(); fixture.walls = shell(1, 7);
  const c = appearanceContext(fixture), w = c.DATA.walls[0];
  const outside = c.getWallExteriorSpans(w)[0], inside = c.getWallInteriorFaces(w)[0];
  const ext = c.ensureExteriorWallSettings(), int = c.ensureInteriorWallSettings();
  for (const s of [ext, int]) {
    Object.assign(s.whole, { linked: true, color: '#aabbcc', texture: 'data:anonymous-whole', textureFlipX: true, textureFlipY: false });
    Object.assign(s.floors[1], { linked: true, color: '#ddeeff', texture: 'data:anonymous-floor', textureFlipX: false, textureFlipY: true });
  }
  const ef = c.getExteriorFaceSetting(w, outside), inf = c.getInteriorFaceSetting(w, inside);
  assert.equal(c.resolveExteriorFaceAppearance(w, outside).source, 'face');
  assert.equal(c.resolveInteriorFaceAppearance(w, inside).source, 'face');
  for (const mode of ['floor', 'whole']) {
    ef.mode = inf.mode = mode;
    const exterior = plain(c.resolveExteriorFaceAppearance(w, outside)), interior = plain(c.resolveInteriorFaceAppearance(w, inside));
    assert.deepEqual(exterior, interior);
    assert.equal(exterior.source, mode);
    assert.equal(exterior.textureFlipX, mode === 'whole'); assert.equal(exterior.textureFlipY, mode === 'floor');
  }
  ef.mode = inf.mode = 'inherit';
  assert.equal(c.resolveExteriorWallAppearance(w).source, 'whole');
  assert.equal(c.resolveInteriorWallAppearance(w).source, 'whole');
  ext.whole.linked = int.whole.linked = false;
  assert.equal(c.resolveExteriorFaceAppearance(w, outside).source, 'floor');
  assert.equal(c.resolveInteriorFaceAppearance(w, inside).source, 'floor');
  ext.floors[1].linked = int.floors[1].linked = false;
  w.interiorColor = '#bb6611'; w.interiorTexture = 'data:anonymous-wall-interior';
  w.interiorTextureFlipX = true; w.interiorTextureFlipY = false;
  assert.deepEqual(plain(c.resolveInteriorWallAppearance(w)), { color: '#bb6611', texture: 'data:anonymous-wall-interior', source: 'wall-interior', textureFlipX: true, textureFlipY: false });
  w.interiorFaces = [{ ...plain(inside), color: '#1188aa', texture: 'data:anonymous-existing-face', textureFlipX: false, textureFlipY: true }];
  assert.deepEqual(plain(c.resolveInteriorFaceAppearance(w, inside)), { color: '#1188aa', texture: 'data:anonymous-existing-face', source: 'existing-face', textureFlipX: false, textureFlipY: true });
  const value = { color: '#abcdef', texture: 'data:anonymous-flip', custom: { keep: true } };
  assert.equal(c.normalizeTextureOrientationTarget(value), value);
  assert.equal(value.textureFlipX, false); assert.equal(value.textureFlipY, false);
  c.setTextureSettingValue(value, 'textureFlipX', true);
  assert.equal(c.appearanceWithTextureOrientation(value.color, value.texture, 'test', value).textureFlipX, true);
  c.setTextureSettingValue(value, 'texture', null);
  assert.equal(value.textureFlipX, false); assert.equal(value.textureFlipY, false);
  assert.deepEqual(value.custom, { keep: true });
});

test('actual furniture migration and JSON export keep issued-copy entities and exact inert records; plain reimport stays strict',async()=>{
 const vm=require('node:vm'),Repository=require('../../assets/js/plan-repository-lab.js'),crypto=require('node:crypto').webcrypto,{memoryIDB}=require('./plan-library-test-support.cjs');
 const mem=memoryIDB();global.IDBKeyRange=mem.keyRange;const repo=Repository.create({indexedDB:mem.idb,crypto,name:'webcad-plan-library-lab-export-proof'}),original=settingsFixture();
 original.walls.push({id:90,floor:2,x1:1,y1:2,x2:1,y2:2,thick:120,opaqueInert:{retained:true}});
 original.items=[{id:91,type:'tv',floor:1,x:100,y:200,w:500,d:100,opaqueItem:{retained:true}}];
 const imported=await repo.importSource({sourceId:'anonymous-export',kind:'plan',raw:JSON.stringify(original)}),review=await repo.prepareLegacyCopy(imported.plans[0].planId);
 await repo.createLegacyCopy(review,'export-copy','Export copy','conversion');const saved=await repo.read('export-copy'),cap=await repo.admission('export-copy',saved.payload),c=appearanceContext(saved.payload);c.PlanLibrary={repo};c.__legacyPlanAdmission=cap;
 vm.runInContext(realFunction('normalizeLegacyFurnitureItems')+'\n'+realFunction('exportPlan'),c);
 c.captureViewState=()=>{};let text;c.downloadJsonFile=value=>text=value;
 c.normalizeLegacyFurnitureItems();assert.deepEqual(plain(c.DATA.items),saved.payload.items);
 c.exportPlan();const exported=JSON.parse(text);assert.deepEqual(exported.items,saved.payload.items);assert.deepEqual(exported.walls.at(-1),saved.payload.walls.at(-1));assertMapsContainOriginals(exported,saved.payload);assert.equal(PlanSchema.validatePlan(exported).ok,false);assert.throws(()=>c.stageJsonImport(text));assert.equal(repo.validateAdmission(c.stageJsonImport(text,cap).data,cap).ok,true);
 c.__legacyPlanAdmission=JSON.parse(JSON.stringify(cap));c.snapCeilingFixturesToCeiling=()=>{};c.snapOutdoorCeilingFixturesToRoof=()=>{};c.normalizeLegacyFurnitureItems();assert.equal(c.DATA.items.length,0,'Unissued metadata cannot suppress the established ordinary furniture migration');
});

test('admitted staging refuses an inherited optional-data rewrite without mutating current data or original archive',async()=>{
 const Repository=require('../../assets/js/plan-repository-lab.js'),mem=memoryIDB();global.IDBKeyRange=mem.keyRange;const repo=Repository.create({indexedDB:mem.idb,crypto:crypto.webcrypto,name:'webcad-plan-library-lab-optional-preservation'}),original=settingsFixture();original.walls.push({id:90,floor:2,x1:1,y1:2,x2:1,y2:2,thick:120});original.roofAppearance=['opaque-array-value'];const raw=JSON.stringify(original),imported=await repo.importSource({sourceId:'anonymous-optional-shape',kind:'plan',raw}),review=await repo.prepareLegacyCopy(imported.plans[0].planId);await repo.createLegacyCopy(review,'unsupported-shape','Retained unsupported shape','conversion');const saved=await repo.read('unsupported-shape'),cap=await repo.admission('unsupported-shape',saved.payload),c=appearanceContext({walls:[],rooms:[],items:[]}),before=plain(c.DATA);c.PlanLibrary={repo};assert.throws(()=>c.stageJsonImport(JSON.stringify(saved.payload),cap),/移行は中止/);assert.deepEqual(plain(c.DATA),before);assert.deepEqual((await repo.read('unsupported-shape')).payload.roofAppearance,['opaque-array-value']);assert.equal((await repo.list('rawSources'))[0].raw,raw);
});
