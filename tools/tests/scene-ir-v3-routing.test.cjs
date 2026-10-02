const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function sourceFixture() {
  const fact = value => ({ value, status: 'observed', source: 'synthetic-routing-fixture:plan' });
  return {
    sceneVersion: 3, units: 'mm', coordinateSystem: 'x-east-y-south-clockwise',
    annotations: [], walls: [], openings: [], siteRegions: [], buildingFootprints: [], bindings: [], connections: [],
    rooms: [{
      id: 'logical-room', floor: fact(1), name: fact('L-shaped source room'),
      shape: fact({ kind: 'rectUnion', rectangles: [
        { x: 0, y: 0, w: 3000, d: 1000 }, { x: 0, y: 1000, w: 1000, d: 2000 },
      ] }), boundaryBasis: fact('wall-centerline'),
      appearance: { diagramColor: fact('#d8cbb0'), pattern: fact('square-grid'), moduleMm: fact(303) },
    }],
    objects: [{
      id: 'source-cabinet', objectType: fact('cabinet-like'), semanticExtent: fact('asset'),
      placement: fact({ domain: 'room', roomId: 'logical-room' }),
      sourceFootprint: fact({ center: { x: 500, y: 1800 }, sizeMm: { w: 600, d: 1000 }, axisX: { x: 1, y: 0 } }),
      frontDirection: fact({ x: 1, y: 0 }),
      heightMm: { value: null, status: 'unknown', unknownReason: 'not-shown' },
    }],
  };
}

function reviewNodes(c) {
  const nodes = {};
  for (const id of ['plan-import-apply', 'plan-import-run', 'plan-import-status', 'plan-import-notes',
    'plan-import-summary', 'plan-import-rooms', 'plan-import-cost', 'plan-import-step3', 'plan-import-modal']) {
    nodes[id] = { textContent: '', disabled: false, style: {}, classList: { add() {}, remove() {} } };
  }
  c.document = { getElementById: id => nodes[id] || null };
  return nodes;
}

test('CommonJS and browser SceneIR dispatch only numeric v3 to the source compiler', () => {
  for (const commonJS of [true, false]) {
    const calls = [], imports = [];
    const sentinel = { version: 3, canApply: false };
    const v3 = { compile(scene, options) { calls.push({ scene, options }); return sentinel; } };
    const c = vm.createContext(commonJS ? {
      module: { exports: {} },
      require(name) {
        imports.push(name);
        if (name === './scene-ir-v3.js') return v3;
        return require(path.join(root, 'assets/js', name));
      },
    } : { SceneIRV3: v3 });
    c.self = c;
    vm.runInContext(read('assets/js/scene-ir.js'), c);
    const compiler = commonJS ? c.module.exports : c.SceneIR;
    const scene = { sceneVersion: 3, sourceOnly: true };
    const options = { sourceOnly: true };
    assert.equal(compiler.compile(scene, options), sentinel);
    assert.equal(calls[0].scene, scene, 'Source scene goes to v3 without v2 filtering');
    assert.equal(calls[0].options, options, 'Caller options are passed through unchanged');
    compiler.compile({ sceneVersion: 3 });
    assert.equal(calls[1].options, undefined);
    for (const version of [1, 2, '3', 4, undefined]) {
      const result = compiler.compile({ sceneVersion: version });
      assert.equal(result.version, 2, 'Other versions keep the existing v2 validation path');
      assert.equal(result.canApply, false);
    }
    assert.equal(calls.length, 2);
    if (commonJS) assert.deepEqual(imports, ['./scene-catalogue.js', './scene-opening-geometry.js', './scene-ir-v3.js']);
  }
});

test('page loads the v3 browser module before SceneIR and PlanImport', () => {
  const scripts = [...read('index.html').matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  const source = scripts.indexOf('assets/js/scene-ir-v3.js');
  const router = scripts.indexOf('assets/js/scene-ir.js');
  const importer = scripts.indexOf('assets/js/plan-import.js');
  assert.ok(source >= 0 && source < router && router < importer);
  assert.equal(scripts.filter(src => src === 'assets/js/scene-ir-v3.js').length, 1);
});

test('actual browser v3 modules retain a source-only shape without a renderer approximation', () => {
  const c = vm.createContext({});
  c.self = c;
  for (const file of ['scene-catalogue', 'scene-opening-geometry', 'scene-ir-v3', 'scene-ir']) {
    vm.runInContext(read('assets/js/' + file + '.js'), c);
  }
  const source = sourceFixture(), before = JSON.stringify(source);
  const result = c.SceneIR.compile(source);
  assert.equal(result.version, 3);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.canApply, false);
  assert.equal(result.reconstructionStatus, 'retained-preview-only');
  assert.deepEqual(plain(result.sourceScene), source);
  assert.notEqual(result.sourceScene, source);
  assert.deepEqual(plain(result.plan), { walls: [], rooms: [], items: [] });
  assert.equal(result.sourcePreview.polygons[0].outer.length, 6, 'Keep the L-shaped contour rather than its bounding rectangle');
  assert.deepEqual(plain(result.sourcePreview.objects[0]), source.objects[0]);
  assert.equal(JSON.stringify(source), before);
});

test('PlanImport preview, staging and forced Apply retain v3 source without touching live DATA', () => {
  const { runtime } = require('./scene-fixtures.cjs');
  const c = runtime(), nodes = reviewNodes(c), source = sourceFixture();
  c.DATA.rooms.push({ id: 'existing-room', floor: 1, x: -3000, y: 0, w: 2000, d: 2000, n: 'Keep my work' });
  const before = JSON.stringify(c.DATA), next = c.nextId, sourceBefore = JSON.stringify(source);
  const options = {
    acceptedReviews: ['scene'], acceptedReviewGroups: ['rooms:logical-room', 'objects:source-cabinet'],
    unresolvedDecisions: [{ entityId: 'source-cabinet', decision: 'leave-unplaced', classification: 'noncritical-decoration' }],
  };
  const preview = c.PlanImport.previewSceneIR(source, options);
  assert.equal(preview.valid, true, JSON.stringify(preview.diagnostics));
  assert.equal(preview.canApply, false, 'Review acceptance cannot enable v3 materialization');
  assert.equal(JSON.stringify(c.DATA), before);
  assert.equal(c.nextId, next);
  assert.equal(c.HISTORY.length, 0);
  const staged = c.PlanImport.stageSceneIR(source, options);
  assert.equal(staged.canApply, false);
  assert.equal(staged.valid, true);
  assert.deepEqual(plain(staged.sourceScene), source);
  assert.deepEqual(plain(c.PlanImport.state.result.sceneIR), source);
  assert.equal(JSON.stringify(source), sourceBefore);
  assert.equal(nodes['plan-import-apply'].disabled, true);
  assert.ok(staged.diagnostics.some(diagnostic => diagnostic.code === 'retained_preview_only'));
  assert.ok(staged.evidence.some(evidence => evidence.path.endsWith('.frontDirection') && evidence.status === 'observed'));
  assert.deepEqual(plain(staged.plan), { walls: [], rooms: [], items: [] });
  assert.equal(JSON.stringify(c.DATA), before);
  assert.equal(c.nextId, next);
  assert.equal(c.HISTORY.length, 0);

  source.rooms[0].name.value = 'Caller changed its draft';
  assert.equal(c.PlanImport.state.result.sceneIR.rooms[0].name.value, 'L-shaped source room', 'Staging owns a deep copy');
  c.PlanImport.state.image = { naturalWidth: 1200, naturalHeight: 800 };
  c.planImportSelectAll();
  assert.equal(nodes['plan-import-apply'].disabled, true, 'Crop synchronization cannot re-enable source-only Apply');

  for (const name of ['mkItem', 'mkWall', 'saveState', 'confirm']) c[name] = () => assert.fail(name + ' must not run for v3');
  nodes['plan-import-apply'].disabled = false;
  c.PlanImport.state.result.sceneCompilation.canApply = true;
  c.PlanImport.state.result.plan.rooms.push({ id: 'injected-runtime-room', floor: 1, x: 0, y: 0, w: 3000, d: 3000 });
  c.applyPlanImport();
  c.applyPlanImport();
  assert.equal(c.PlanImport.state.result.sceneCompilation.canApply, false, 'Apply revalidates, ignoring stale or changed preview flags');
  assert.deepEqual(plain(c.PlanImport.state.result.sceneCompilation.plan), { walls: [], rooms: [], items: [] });
  assert.equal(JSON.stringify(c.DATA), before);
  assert.equal(c.nextId, next);
  assert.equal(c.HISTORY.length, 0);
  assert.equal(c.PlanImport.state.result.sceneApplied, undefined);
});

test('existing v2 preview and legacy v1 constructor conversion remain unchanged', () => {
  const { fixture, runtime } = require('./scene-fixtures.cjs');
  const c = runtime(), nodes = reviewNodes(c), before = JSON.stringify(c.DATA), next = c.nextId;
  const result = c.PlanImport.previewSceneIR(fixture());
  assert.equal(result.version, 2);
  assert.equal(result.canApply, true, JSON.stringify(result.diagnostics));
  assert.equal(result.plan.rooms[0].floorRaiseMm, -160);
  assert.ok(result.plan.items.some(item => item.type === 'original-desk-work'));
  assert.equal(JSON.stringify(c.DATA), before);
  assert.equal(c.nextId, next);
  c.PlanImport.stageSceneIR(fixture());
  c.PlanImport.state.image = { naturalWidth: 1200, naturalHeight: 800 };
  c.planImportSelectAll();
  assert.equal(nodes['plan-import-apply'].disabled, false, 'The source-only guard still allows valid v2 imports');
  const legacy = c.PlanImport.toAppObjects({ walls: [], rooms: [], items: [
    { type: 'desk', floor: 1, x: 500, y: 800, w: 1200, d: 600 },
  ] });
  assert.equal(legacy.items[0].type, 'fmp-Table01');
  assert.equal(legacy.items[0].x, -100);
  assert.equal(legacy.items[0].y, 500);
  assert.equal(JSON.stringify(c.DATA), before);
});

test('normal image import keeps the existing request without opting into Scene IR v3', async () => {
  const { runtime } = require('./scene-fixtures.cjs');
  const c = runtime(), calls = [];
  const images = ['data:image/png;base64,c3ludGhldGlj'];
  c.PlanImport.state.pages = images;
  c.document = { getElementById: id => id === 'plan-import-hint' ? { value: 'synthetic test' } : null };
  c.fetch = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, text: async () => JSON.stringify({
      plan: { walls: [], rooms: [], items: [] }, revise: { skipAll: true },
    }) };
  };
  c.runPlanImport();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/ai/import-plan');
  assert.deepEqual(JSON.parse(calls[0].options.body), { images, hint: 'synthetic test' });
  assert.equal(c.PlanImport.state.busy, false);
  assert.equal(c.PlanImport.state.result.sceneIR, undefined);
  assert.deepEqual(plain(c.DATA), { walls: [], rooms: [], items: [], heightDefaults: { modelVersion: 2, floorThickness: 180 } });
});
