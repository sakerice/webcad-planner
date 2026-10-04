'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const { appSource, ROOT } = require('./app-source.cjs');
const { appearanceContext, settingsFixture, plain } = require('./legacy-appearance-support.cjs');
const { memoryIDB } = require('./plan-library-test-support.cjs');
const Repository = require('../../assets/js/plan-repository-lab.js');
const SOURCE = appSource();

// Extract every tested getter, write owner and light renderer from the actual
// workcopy. Three.js below is the vendored implementation, not renderer stubs.
function realFunction(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(SOURCE);
  assert.ok(match, 'Missing actual function: ' + name);
  const end = SOURCE.indexOf('\n}', match.index);
  assert.ok(end > match.index);
  return SOURCE.slice(match.index, end + 2);
}
function load(c, names) {
  vm.runInContext(names.map(realFunction).join('\n'), c, { filename: 'render-read.actual-source.js' });
}
function loadConstants(c, names) {
  vm.runInContext(names.map(name => {
    const match = new RegExp('^var ' + name + '\\s*=[\\s\\S]+?;', 'm').exec(SOURCE);
    assert.ok(match, 'Missing actual constant: ' + name);
    return match[0];
  }).join('\n'), c);
}
function ambientEdits(c) {
  let saved = 0;
  loadConstants(c, ['LIGHT_ITEM_TYPES']);
  load(c, ['isLightItemType']);
  Object.assign(c, {
    ren: null, saveState() { saved++; }, updateProps() {}, draw2d() {},
    renderExteriorWallPanel() {}, scheduleAppearancePreviewUpdate() {}, markAppearanceColorDirty() {},
    isAppearanceColorInputActive: () => false, isObjectLocked: () => false,
    isWindowLikeType: () => false
  });
  load(c, ['ensureExteriorWallSetting', 'updateExteriorSetting', 'updateSelectedProp']);
  return () => saved;
}
function conflictingWallFixture() {
  const plan = settingsFixture();
  plan.walls[0].exteriorColor = '#abcdef';
  plan.walls[0].exteriorTexture = 'data:anonymous-wall-fallback';
  plan.walls[0].exteriorTextureFlipX = true;
  plan.walls[0].exteriorTextureFlipY = true;
  plan.exteriorWallSettings.walls[7] = {
    color: null, texture: null, textureFlipX: false, textureFlipY: false,
    opaque: { retain: ['anonymous', null, false] }
  };
  delete plan.exteriorWallSettings.faces['7_-1_0_2400'];
  return plan;
}
function lightFixture(overrides = {}) {
  return { id: 91, type: 'light-ceiling', floor: 1, x: 100, y: 200, w: 500, d: 500, rot: 0,
    elev: 2300, color: '#112233', lightKind: 'ceiling', lightShape: 'point', lightColor: '#aabbcc',
    lightIntensity: 0.56, lightRange: 5600, lightAngle: 64, lightCastShadow: true,
    opaque: { retain: [false, null, 'anonymous'] }, ...overrides };
}
function lightContext(item) {
  const c = appearanceContext({ walls: [], rooms: [], items: [item] });
  loadConstants(c, ['LIGHT_ITEM_TYPES', 'LIGHT_KIND_TO_TYPE', 'LINE_LIGHT_WIDTH_M', 'LINE_LIGHT_LUMINANCE']);
  load(c, ['isLightItemType', 'lightKindFromType', 'lightTypeForKind', 'ensureLightDefaults',
    'getEffectiveLightItem', 'defaultLightElevationMm', 'drawLight2d', 'maxInteriorShadowLights',
    'claimInteriorShadowLightSlot', 'configureInteriorLightShadow', 'markShadowableLight',
    'addLightBeamHint', 'makeLightFixtureMaterial', 'addConfiguredLight', 'build3DLightItem',
    'lineLightAim', 'addLineLight', 'mkItem', 'updateSelectedLightKind', 'isPlanAnnotationType', 'canSetItemElevation']);
  Object.assign(c, {
    isInt: true, _activeInteriorShadowLightCount: 0, isWalkView: () => false,
    // This suite isolates unrelated ceiling/catalogue geometry and IO. The
    // default computation, rendered meshes/materials/lights and setters are real.
    ceilingAttachElevationMm: () => null, ceilingFinishElevationMm: () => 2400,
    bestFmpType: type => type, getItemDefaultSize: () => ({ w: 500, d: 500 }),
    ICOLORS: { 'light-ceiling': '#fff6dd', 'light-down': '#fff6dd', 'light-spot': '#fff6dd' },
    isContextExteriorItemType: () => false, isWindowLikeType: () => false,
    isDoorLikeOpeningType: () => false, isFmpItemType: () => false,
    isOpeningItemType: () => false, isObjectLocked: () => false,
    ren: null, saveState() {}, draw2d() {}, updateProps() {}
  });
  return c;
}
let threePromise;
function actualThree() {
  if (!threePromise) {
    const bytes = fs.readFileSync(path.join(ROOT, 'assets/vendor/three/build/three.module.js'));
    threePromise = import('data:text/javascript;base64,' + bytes.toString('base64'));
  }
  return threePromise;
}
function meshesAndLights(group) {
  const meshes = [], lights = [];
  group.traverse(object => { if (object.isMesh) meshes.push(object); if (object.isLight) lights.push(object); });
  return { meshes, lights };
}

test('actual wall read preserves null/false entries under whole/floor/wall resolution and keeps fallback appearance', () => {
  const original = conflictingWallFixture(), c = appearanceContext(original), w = c.DATA.walls[0];
  const entry = c.DATA.exteriorWallSettings.walls[7], before = plain(entry);
  for (const source of ['whole', 'floor', 'wall']) {
    c.DATA.exteriorWallSettings.whole.linked = source === 'whole';
    c.DATA.exteriorWallSettings.floors[1].linked = source === 'floor';
    const effective = c.getExteriorWallSetting(w);
    assert.notEqual(effective, entry);
    assert.equal(effective.color, '#abcdef');
    assert.equal(effective.texture, 'data:anonymous-wall-fallback');
    assert.equal(effective.textureFlipX, true); assert.equal(effective.textureFlipY, true);
    const ap = c.resolveExteriorFaceAppearance(w, c.getWallExteriorSpans(w)[0]);
    assert.equal(ap.source, source);
    if (source === 'wall') assert.deepEqual(plain(ap), {
      color: '#abcdef', texture: 'data:anonymous-wall-fallback', source: 'wall', textureFlipX: true, textureFlipY: true
    });
    assert.equal(c.DATA.exteriorWallSettings.walls[7], entry);
    assert.deepEqual(plain(entry), before);
  }
});

test('wall read does not materialize absent entries or missing orientation fields', () => {
  const c = appearanceContext(conflictingWallFixture()), w = c.DATA.walls[0];
  c.DATA.exteriorWallSettings.walls[7] = { color: null, opaque: false };
  const before = plain(c.DATA.exteriorWallSettings.walls);
  c.getExteriorWallSetting(w); c.resolveExteriorWallAppearance(w);
  assert.deepEqual(plain(c.DATA.exteriorWallSettings.walls), before);
  delete c.DATA.exteriorWallSettings.walls[7];
  c.getExteriorWallSetting(w); c.resolveExteriorWallAppearance(w);
  assert.equal(Object.hasOwn(c.DATA.exteriorWallSettings.walls, 7), false);
});

test('both actual exterior setters still write persisted maps and change only the requested properties', () => {
  const c = appearanceContext(conflictingWallFixture()), savedCount = ambientEdits(c), w = c.DATA.walls[0];
  const entry = c.DATA.exteriorWallSettings.walls[7], opaque = plain(entry.opaque);
  c.updateExteriorSetting('wall', 'textureFlipX', false, 1, 7);
  assert.equal(entry.color, null); assert.equal(entry.texture, null);
  assert.equal(entry.textureFlipX, false); assert.equal(w.exteriorTextureFlipX, false);
  c.updateExteriorSetting('wall', 'color', '#556677', 1, 7);
  assert.equal(entry.color, '#556677'); assert.equal(w.exteriorColor, '#556677');
  c.updateExteriorSetting('wall', 'texture', 'data:anonymous-edited', 1, 7);
  assert.equal(entry.texture, 'data:anonymous-edited'); assert.equal(w.exteriorTexture, entry.texture);
  c.updateExteriorSetting('wall', 'textureFlipY', true, 1, 7);
  c.updateExteriorSetting('wall', 'texture', null, 1, 7);
  assert.equal(entry.texture, null); assert.equal(w.exteriorTexture, null);
  assert.equal(entry.textureFlipX, false); assert.equal(entry.textureFlipY, false);
  assert.equal(w.exteriorTextureFlipX, false); assert.equal(w.exteriorTextureFlipY, false);
  c.ST.selected = w;
  c.updateSelectedProp('exteriorColor', '#778899');
  c.updateSelectedProp('exteriorTexture', 'data:anonymous-selected-edit');
  assert.equal(entry.color, '#778899'); assert.equal(w.exteriorColor, entry.color);
  assert.equal(entry.texture, 'data:anonymous-selected-edit'); assert.equal(w.exteriorTexture, entry.texture);
  assert.equal(c.DATA.exteriorWallSettings.walls[7], entry);
  assert.deepEqual(plain(entry.opaque), opaque);
  assert.equal(savedCount(), 7);
});

test('effective light defaults retain stored values and existing initialization never overwrites a saved color', () => {
  const original = lightFixture(), c = lightContext(original), item = c.DATA.items[0];
  assert.equal(c.ensureLightDefaults(item), item);
  assert.deepEqual(plain(item), original);
  const effective = c.getEffectiveLightItem(item);
  assert.notEqual(effective, item); assert.equal(effective.lightColor, '#aabbcc'); assert.equal(effective.color, '#aabbcc');
  assert.deepEqual(plain(item), original);
  const sparse = lightFixture({ type: 'light-spot', lightKind: 'unknown', lightShape: null,
    lightColor: null, lightIntensity: 'invalid', lightRange: 'invalid', lightAngle: 'invalid', lightCastShadow: undefined });
  const before = plain(sparse), view = c.getEffectiveLightItem(sparse);
  assert.equal(view.lightKind, 'spot'); assert.equal(view.lightShape, 'point'); assert.equal(view.lightColor, '#112233');
  assert.equal(view.lightIntensity, 0.9); assert.equal(view.lightRange, 5200); assert.equal(view.lightAngle, 32);
  assert.equal(view.lightCastShadow, true); assert.deepEqual(plain(sparse), before);
});

test('actual Three.js fixture and point/spot/line light builders render effective values without changing the item', async () => {
  const THREE = await actualThree();
  for (const variant of [
    {}, { type: 'light-down', lightKind: 'down', lightIntensity: 0.72, lightRange: 4400 },
    { type: 'light-spot', lightKind: 'spot', lightIntensity: 0.9, lightRange: 5200, lightAngle: 32 },
    { lightShape: 'line', lightAim: 'up' },
    { lightKind: null, lightColor: null, lightIntensity: 'invalid', lightRange: 'invalid', lightAngle: 'invalid' }
  ]) {
    const original = lightFixture(variant), c = lightContext(original), item = c.DATA.items[0]; c.THREE = THREE;
    const group = new THREE.Group(), view = c.getEffectiveLightItem(item);
    c.build3DLightItem(group, item, item.w * c.U, item.d * c.U);
    const { meshes, lights } = meshesAndLights(group), hex = new THREE.Color(view.lightColor).getHexString();
    assert.ok(meshes.some(mesh => mesh.material.emissive?.getHexString() === hex), 'Actual fixture emissive color');
    assert.ok(lights.length > 0); assert.ok(lights.every(light => light.color.getHexString() === hex));
    if (view.lightShape === 'line') assert.ok(lights.every(light => light.isPointLight));
    else {
      assert.equal(lights.length, 1);
      assert.equal(lights[0].intensity, Number(view.lightIntensity) * Math.PI);
      assert.equal(lights[0].distance, Number(view.lightRange) * c.U);
      assert.equal(!!lights[0].isPointLight, view.lightKind === 'ceiling');
    }
    assert.deepEqual(plain(item), original, 'Rendering must not persist defaults or merge distinct colors');
  }
});

test('actual 2D light drawing interprets lightColor while preserving the full source item', () => {
  const original = lightFixture({ lightColor: null }), c = lightContext(original), fills = [];
  c.ctx = { save() {}, restore() {}, fillRect() { fills.push(this.fillStyle); }, strokeRect() {},
    beginPath() {}, arc() {}, fill() { fills.push(this.fillStyle); }, stroke() {}, moveTo() {}, lineTo() {} };
  c.drawLight2d(c.DATA.items[0], 0.1);
  assert.ok(fills.includes('#112233'));
  assert.deepEqual(plain(c.DATA.items[0]), original);
});

test('actual property panel uses effective light fields and leaves selection and sparse item unchanged', () => {
  const original = lightFixture({ lightColor: null, lightKind: null, lightIntensity: 'invalid' });
  const c = lightContext(original), item = c.DATA.items[0]; c.ST.selected = item;
  const elements = new Map();
  c.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} } });
    return elements.get(id);
  } };
  Object.assign(c, {
    ILABELS: {}, getFmpItem: () => null, explicit2DSelection: () => [item], isMobileLayout: () => false,
    selectedLockControlHtml: () => '', objectIdLabel: it => String(it.id), stackOrderControlsHtml: () => '',
    isCustomBlockType: () => false, isStairPartType: () => false, isColumnType: () => false,
    baseFloorKindOf: () => null, selectedModelFinishesHtml: () => '', selectedDeleteButtonHtml: () => ''
  });
  loadConstants(c, ['LIGHT_KELVIN_PRESETS']);
  load(c, ['setPropsBodyHtml', 'updateProps']);
  c.updateProps(); c.updateProps();
  const html = elements.get('props-body').innerHTML;
  assert.ok(html.includes('value="#112233"')); assert.ok(html.includes('value="0.56"'));
  assert.equal(c.ST.selected, item); assert.deepEqual(plain(item), original);
});

test('new lights retain initialization defaults and intentional light-color/kind setters remain persisted', () => {
  const c = lightContext(lightFixture()); ambientEdits(c);
  for (const [kind, intensity, range, angle] of [['ceiling', 0.56, 5600, 64], ['down', 0.72, 4400, 64], ['spot', 0.9, 5200, 32]]) {
    const fresh = c.mkItem('light-' + kind, 100, 200, 0, 1);
    assert.equal(fresh.lightKind, kind); assert.equal(fresh.lightShape, 'point'); assert.equal(fresh.lightColor, '#fff6dd');
    assert.equal(fresh.color, '#fff6dd'); assert.equal(fresh.lightIntensity, intensity); assert.equal(fresh.lightRange, range);
    assert.equal(fresh.lightAngle, angle); assert.equal(fresh.lightCastShadow, true);
    assert.equal(fresh.elev, 0, 'Retain the existing mkItem placement-height initialization');
  }
  const item = c.DATA.items[0]; c.ST.selected = item;
  c.updateSelectedProp('lightColor', '#445566');
  assert.equal(item.lightColor, '#445566'); assert.equal(item.color, '#445566'); assert.equal(item.colorCustom, true);
  c.updateSelectedLightKind('spot');
  assert.equal(item.type, 'light-spot'); assert.equal(item.lightKind, 'spot'); assert.equal(item.lightIntensity, 0.9);
  assert.equal(item.lightRange, 5200); assert.equal(item.lightAngle, 32); assert.equal(item.color, '#445566');
});

test('admitted render-save-reload retains conflicting wall maps and full light records plus immutable archive', async () => {
  const mem = memoryIDB(); global.IDBKeyRange = mem.keyRange;
  const repo = Repository.create({ indexedDB: mem.idb, crypto, name: 'webcad-plan-library-lab-anonymous-render-read' });
  const original = conflictingWallFixture(); original.exteriorWallSettings.whole.linked = true;
  original.items = [lightFixture()]; const raw = '  ' + JSON.stringify(original) + '\n';
  const imported = await repo.importSource({ sourceId: 'anonymous-render-source', kind: 'plan', raw });
  const review = await repo.prepareLegacyCopy(imported.plans[0].planId);
  await repo.createLegacyCopy(review, 'anonymous-render-copy', 'Anonymous render copy', 'anonymous-render-create');
  const loaded = await repo.read('anonymous-render-copy'), cap = await repo.admission('anonymous-render-copy', loaded.payload);
  const c = lightContext(lightFixture()); c.PlanLibrary = { repo }; c.THREE = await actualThree();
  c.DATA = c.stageJsonImport(JSON.stringify(loaded.payload), cap).data;
  const wallMap = plain(c.DATA.exteriorWallSettings.walls), item = plain(c.DATA.items[0]);
  assert.equal(c.resolveExteriorFaceAppearance(c.DATA.walls[0], c.getWallExteriorSpans(c.DATA.walls[0])[0]).source, 'whole');
  c.getExteriorWallSetting(c.DATA.walls[0]); c.getEffectiveLightItem(c.DATA.items[0]); c.ensureLightDefaults(c.DATA.items[0]);
  const group = new c.THREE.Group();
  c.build3DLightItem(group, c.DATA.items[0], 0.5, 0.5);
  assert.equal(meshesAndLights(group).lights[0].color.getHexString(), 'aabbcc');
  assert.deepEqual(plain(c.DATA.exteriorWallSettings.walls), wallMap); assert.deepEqual(plain(c.DATA.items[0]), item);
  const saved = await repo.save({ planId: 'anonymous-render-copy', operationId: 'anonymous-render-save',
    baseRevisionId: loaded.revision.id, baseGeneration: loaded.head.headGeneration, payload: JSON.parse(c.serializeDataSnapshot()) });
  assert.equal(saved.status, 'saved'); const reread = await repo.read('anonymous-render-copy');
  assert.deepEqual(plain(reread.payload.exteriorWallSettings.walls), wallMap);
  assert.deepEqual(plain(reread.payload.items[0]), original.items[0]);
  assert.equal((await repo.list('rawSources'))[0].raw, raw);
});
