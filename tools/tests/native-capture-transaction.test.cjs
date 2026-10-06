'use strict';
// These tests execute repository functions and repository Three/OrbitControls/TPS.
// Only GPU/canvas, codecs, UI, top-image loading and ZIP boundaries are faked.
// No network, browser, account, upload, deployment or paid API is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(process.env.NATIVE_CAPTURE_TEST_ROOT || path.join(__dirname, '../..'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const source = html + '\n' + ['app-constants.js', 'app-state.js', 'plan-data.js', 'draw-2d.js'].map(file => fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8')).join('\n');
const THREE_URL = 'data:text/javascript;base64,' + fs.readFileSync(path.join(ROOT, 'assets/vendor/three/build/three.module.js')).toString('base64');
const modules = (async () => {
  const THREE = await import(THREE_URL);
  const orbitSource = fs.readFileSync(path.join(ROOT, 'assets/vendor/three/examples/jsm/controls/OrbitControls.js'), 'utf8').replace("from 'three'", 'from ' + JSON.stringify(THREE_URL));
  const { OrbitControls } = await import('data:text/javascript;base64,' + Buffer.from(orbitSource).toString('base64'));
  return { THREE, OrbitControls };
})();
function functionCode(name) {
  const match = new RegExp('(?:^|\\n)(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, 'actual repository function exists: ' + name);
  const start = match.index + (match[0][0] === '\n' ? 1 : 0);
  let code = '';
  for (const line of source.slice(start).split('\n')) {
    code += line + '\n';
    try { new vm.Script(code); } catch { continue; }
    return code;
  }
  throw new Error('Unclosed function: ' + name);
}
function load(c, names) { for (const name of names) vm.runInContext(functionCode(name), c, { filename: 'actual:' + name }); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function cameraState(cam) {
  return { position: cam.position.toArray(), quaternion: cam.quaternion.toArray(), scale: cam.scale.toArray(), up: cam.up.toArray(), fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far, zoom: cam.zoom, rotationOrder: cam.rotation.order, matrix: cam.matrix.toArray(), matrixWorld: cam.matrixWorld.toArray(), matrixWorldInverse: cam.matrixWorldInverse.toArray(), projection: cam.projectionMatrix.toArray(), projectionInverse: cam.projectionMatrixInverse.toArray() };
}
function orbitState(o) {
  return { enabled: o.enabled, enableDamping: o.enableDamping, autoRotate: o.autoRotate, target: o.target.toArray(), spherical: [o._spherical.radius, o._spherical.phi, o._spherical.theta], delta: [o._sphericalDelta.radius, o._sphericalDelta.phi, o._sphericalDelta.theta], pan: o._panOffset.toArray(), scale: o._scale, lastPosition: o._lastPosition.toArray(), lastQuaternion: o._lastQuaternion.toArray(), lastTargetPosition: o._lastTargetPosition.toArray() };
}
function sceneState(scene) {
  const objects = [];
  scene.traverse(o => objects.push({ object: o, visible: o.visible, material: o.material, instanceColor: o.instanceColor, instanceMatrix: o.instanceMatrix && Array.from(o.instanceMatrix.array), position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray(), matrix: o.matrix.toArray(), matrixWorld: o.matrixWorld.toArray(), intensity: o.intensity, castShadow: o.castShadow }));
  return { scene, background: scene.background, fog: scene.fog, overrideMaterial: scene.overrideMaterial, objects };
}
function assertSceneRestored(before) {
  assert.equal(before.scene.background, before.background, 'background identity');
  assert.equal(before.scene.fog, before.fog, 'fog identity');
  assert.equal(before.scene.overrideMaterial, before.overrideMaterial, 'override material identity');
  for (const s of before.objects) {
    const o = s.object;
    for (const key of ['visible', 'material', 'instanceColor', 'intensity', 'castShadow']) assert.equal(o[key], s[key], o.name + ': ' + key);
    for (const key of ['position', 'quaternion', 'scale', 'matrix', 'matrixWorld']) assert.deepEqual(o[key].toArray(), s[key], o.name + ': ' + key);
    if (s.instanceMatrix) assert.deepEqual(Array.from(o.instanceMatrix.array), s.instanceMatrix, 'culled instance matrices');
  }
}
async function runtime(mode = 'orbit') {
  const { THREE: T, OrbitControls } = await modules;
  const noop = () => {};
  const cam = new T.PerspectiveCamera(68, 4 / 3, 0.1, 100);
  cam.position.set(5, 2, 9);
  cam.lookAt(5, 1.6, 5);
  cam.updateMatrixWorld(true);
  const orbit = new OrbitControls(cam);
  orbit.target.set(5, 1.6, 5);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.autoRotate = true;
  orbit._sphericalDelta.theta = 0.8;
  orbit._sphericalDelta.phi = 0.03;
  orbit._panOffset.set(0.1, 0.04, -0.2);
  orbit._scale = 0.98;
  let ratio = 1, width = 800, height = 600, now = 100;
  let render = null;
  const shots = [], events = [], statuses = [], disposals = [];
  const generatedGuideMaterials = new Map();
  const c = {
    console, TextEncoder, THREE: T, AI_CAPTURE_TRANSACTION: null, AI_RENDER_CAPTURE_SPEC: null,
    AI_RENDER_PACKAGE: null, VIDEO_RENDER_PACKAGE: null,
    NATIVE_OUTPUT_REQUESTS: { epoch: 0, image: 0, video: 0, jis: 0 }, __editorPlanId: 'anonymous-plan', _editorPaneDisposed: false,
    DATA: { walls: [], rooms: [{ id: 'room', floor: 1, x: 0, y: 0, w: 10000, d: 10000 }], items: [] },
    ST: { view: mode === 'fps' || mode === 'tps' ? '3d-walk' : '3d-ext', floor: 1, selected: null, panX: 71, panY: 29, zoom: 1.4 },
    WALK: { active: mode === 'fps' || mode === 'tps', floor: 1, x: 5, z: 5, yaw: 0, pitch: 0.02, groundOff: 0, keys: { fwd: true, left: true }, moving: true, _mapT: 100 },
    iMov: { w: true, arrowleft: true, shift: false }, WALKTHROUGH: null,
    _lastWalkTick: 100, _doorAnims: [], _doorWantByItem: new WeakMap(), _walkCollFloor: null,
    _walkCullApplied: false, _walkCullAt: 100, WALK_MAX_STEP_UP_M: 0.4, WALK_PLAYER_RADIUS_MM: 280, WALK_EYE_HEIGHT_MM: 1600,
    U: 0.001, camExt: cam, camInt: new T.PerspectiveCamera(), orbit, sc3: new T.Scene(), composer: null,
    _gndMesh: null, _n8aoPass: null, _cutawayViewKey: '', isInt: false, nextId: 10,
    LIGHT_SETTINGS: { timeOfDay: 'day', hour: 12, season: 'summer' },
    SITE_SURFACE_OPTIONS: {}, AI_INSTANCE_COLOR_VARIANTS: [[0.78, 0.5], [0.78, 0.32], [0.78, 0.68]],
    performance: { now: () => now },
    document: { getElementById: id => id === 'c3d-wrap' ? { clientWidth: 800, clientHeight: 600 } : null },
    getComputedStyle: () => ({ display: 'block' }),
    addEventListener: noop, removeEventListener: noop,
    init3D: () => { throw new Error('unexpected renderer creation'); }, setView: view => { c.ST.view = view; },
    isOpeningItemType: type => type === 'door', isWindowLikeType: () => false, isDoorLikeOpeningType: type => type === 'door', isContextExteriorItemType: () => false, isStairPartType: () => false,
    siteSurfaceSegmentColor: () => 0x70b85f,
    floorBaseY: () => 0, floorTopY: () => 0, roomFloorTopY: () => 0, roomFloorAt: () => 0, roomCeilingHeightM: () => 3, roomIsVoidCeiling: () => false, roomCeilingProfile: () => null,
    roomAtPointOnFloor: () => c.DATA.rooms[0], getItemDisplayPose: it => ({ x: it.x, y: it.y, rot: it.rot || 0 }),
    walkEyeY: () => 1.6, walkStairSampleAt: () => null, walkLevelStairGroundAt: () => null, walkFlatGroundAt: () => 0, walkBlockedAt: () => false,
    walkUpdateGround: noop, drawWalkMinimap: noop, walkSpawnObstructed: () => false, walkSpawnClearNear: () => null,
    invalidate3D: noop, updateWalkEyePresetButton: noop, hasPendingGltfModels: () => false, _tablet3DRebuildQueued: false,
    remove3DSelectionHelpers: noop, add3DSelectionMarker: noop, add3DMoveGizmo: noop, updateProps: noop, updateElevSnapFabVisibility: noop,
    item3DBaseY: () => 0,
    updateInteriorCutawayWalls: () => { events.push({ kind: 'prepare', active: !!c.AI_CAPTURE_TRANSACTION }); },
    applyInteriorLightBudget: () => { events.push({ kind: 'light', active: !!c.AI_CAPTURE_TRANSACTION }); },
    normalizeLegacyFurnitureItems: noop, ensureObjectIds: noop, ensureExteriorWallSettings: noop, ensureInteriorWallSettings: noop, ensureRoofAppearance: noop, syncExteriorWallSettings: noop,
    buildUnityRenderPlan: () => plain(c.DATA),
    collectAiMaterialSummary: () => ({ floors: [1], floorClassifications: [], sites: [], itemTypes: [] }),
    aiRenderSelectedPreset: () => ({ style: 'fixture', painterly: false }), aiRenderNote: () => '', AI_IMAGE_PRESETS: [{ style: 'fixture' }],
    openUnityRenderModal: noop, setUnityRenderBusy: value => events.push({ kind: 'busy', value }), setUnityRenderStatus: value => statuses.push(value),
    clearAiRenderOutput: () => { c.AI_RENDER_PACKAGE = null; c.AI_RENDER_CAPTURE_SPEC = null; },
    setAiPackagePreview: noop, setAiInstructionsPreview: noop, syncAiRenderDownloadLinks: noop, setUnityRenderImage: noop,
    VideoPrompt: { MAX_DURATION_SEC: 15, DEFAULT_DURATION_SEC: 8 }, resolveVideoPreset: () => ({ id: 'fixture', label: 'Fixture' }),
    videoDaylightDescriptor: () => ({ timeOfDay: 'day' }), videoHeightModelRecord: () => ({}), videoShadowLiftRecord: () => ({}),
    LockTiers: { tableFor: () => ({}), tierOf: () => 1 },
    ShadowLift: { measure: () => [], curveFor: () => null, apply: image => image },
    planContextBoundsMm: () => ({ minX: 0, minY: 0, maxX: 10000, maxY: 10000 }), planSubjectBoundsMm: () => ({ minX: 0, minY: 0, maxX: 10000, maxY: 10000 }),
    planCapturePlaceholderRoster: () => [], planSubjectFrameRatio: () => 0.8, PLAN_CAPTURE_VIEW: { panX: 0, panY: 0, zoom: 1 },
    composeVideoPromptOrThrow: args => { c.promptCamera = plain(args.camera); return 'fixture prompt'; },
    makeZipBlob: files => { events.push({ kind: 'zip', active: !!c.AI_CAPTURE_TRANSACTION }); return { files }; },
    downloadBlobFile: () => { throw new Error('test must never download'); },
    capturePlan2dDataUrl: () => { events.push({ kind: 'plan', active: !!c.AI_CAPTURE_TRANSACTION }); return 'plan'; },
    onBoundary: null, onShot: null,
  };
  c.window = c;
  c.ren = {
    getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; },
    getSize: target => target.set(width, height), setSize: (w, h) => { width = w; height = h; },
    shadowMap: { needsUpdate: false, autoUpdate: false }, toneMapping: T.ACESFilmicToneMapping, toneMappingExposure: 0.85,
    render: (scene, camera) => {
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); render = { scene, camera };
      if (c.AI_CAPTURE_TRANSACTION && (scene.overrideMaterial || scene.background !== initialBg)) {
        const register = material => {
          if (!material || generatedGuideMaterials.has(material)) return;
          generatedGuideMaterials.set(material, false);
          material.addEventListener('dispose', () => { generatedGuideMaterials.set(material, true); disposals.push(material); });
        };
        if (scene.overrideMaterial) register(scene.overrideMaterial);
        else scene.traverse(o => { if (o.isMesh && o.material && o.material.isMeshBasicMaterial) register(o.material); });
      }
    },
    domElement: { toDataURL() {
      assert.ok(render, 'actual capture rendered before encoding');
      const s = render.scene, meshes = [];
      s.traverse(o => { if (o.isMesh || o.isLine || o.isSprite) meshes.push({ name: o.name, position: o.position.toArray(), quaternion: o.quaternion.toArray(), matrixWorld: o.matrixWorld.toArray(), instances: o.instanceMatrix && Array.from(o.instanceMatrix.array) }); });
      let kind = 'base';
      if (s.overrideMaterial) kind = s.overrideMaterial.isMeshNormalMaterial ? 'normal' : 'depth';
      else if (s.background !== initialBg) kind = s.children.some(o => o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.color && o.material.color.getHex() === 0xff4b4b) ? 'segmentation' : 'instance';
      const shot = { kind, camera: cameraState(render.camera), meshes, ratio, width, height, transaction: c.AI_CAPTURE_TRANSACTION, eventsBefore: events.length };
      shots.push(shot);
      events.push({ kind: 'shot', shot: kind, active: !!c.AI_CAPTURE_TRANSACTION });
      if (c.onShot) c.onShot(shot);
      return 'data:image/png;base64,' + Buffer.from(JSON.stringify({ shot: shots.length, kind })).toString('base64') + 'A'.repeat(1400);
    } },
  };
  const initialBg = new T.Color(0x332211);
  c.sc3.background = initialBg;
  c.sc3.fog = new T.Fog(0x778899, 10, 50);
  function mesh(name, ref, kind, position) {
    const o = new T.Mesh(new T.BoxGeometry(0.4, 0.8, 0.4), new T.MeshStandardMaterial({ color: 0x998877, roughness: 0.71 }));
    o.name = name; o.position.fromArray(position || [8, 0.4, 8]); o.userData = { b: true, selectRef: ref, selectKind: kind }; c.sc3.add(o); return o;
  }
  const wall = { id: 'wall', floor: 1, x1: 1000, y1: 9000, x2: 9000, y2: 9000 };
  c.DATA.walls.push(wall);
  mesh('wall', wall, 'wall');
  const door = { id: 'door', type: 'door', floor: 1, x: 4900, y: 4800, w: 800, d: 80 };
  const upstairs = { id: 'upstairs', type: 'chair', floor: 2, x: 8000, y: 8000, w: 500, d: 500 };
  c.DATA.items.push(door, upstairs);
  const pivot = new T.Group(); pivot.name = 'animated-door-pivot'; pivot.position.set(5, 0, 4.4); c.sc3.add(pivot);
  const doorMesh = mesh('door', door, 'item', [0, 0.8, 0]); c.sc3.remove(doorMesh); pivot.add(doorMesh);
  c._doorAnims.push({ grp: pivot, pivot, it: door, openY: Math.PI / 2, _want: 0 }); c._doorWantByItem.set(door, 0);
  const instanced = new T.InstancedMesh(new T.BoxGeometry(0.5, 0.5, 0.5), new T.MeshStandardMaterial(), 1);
  instanced.name = 'culled-upstairs';
  const sourceMatrix = new T.Matrix4().makeTranslation(8, 4, 8);
  instanced.setMatrixAt(0, sourceMatrix); instanced.setColorAt(0, new T.Color(0x334477));
  instanced.userData = { b: true, selectKind: 'item', instanceRefs: [upstairs], instanceBaseMatrices: [sourceMatrix] }; c.sc3.add(instanced);
  const hidden = mesh('hidden-mesh', null); hidden.visible = false;
  const helper = mesh('selection-helper', null); helper.userData.selectionHelper = true;
  const neighbor = mesh('neighbor', { type: 'neighbor-house', floor: 1 }, 'item'); neighbor.material.transparent = true; neighbor.material.opacity = 0.02;
  const light = new T.PointLight(0xffffff, 3.2); light.position.set(5, 2.8, 4); light.castShadow = false; c.sc3.add(light);
  c.sc3.updateMatrixWorld(true);
  vm.createContext(c);
  const names = [
    'nativeOutputSnapshot', 'captureNativeOutputSource', 'beginNativeOutputRequest', 'ownsNativeOutputRequest', 'isNativeOutputSourceCurrent', 'isNativeOutputRequestCurrent', 'assertNativeOutputRequest', 'tagNativeOutputPackage', 'isNativeOutputPackageCurrent', 'cancelNativeOutputRequest',
    'isUnityRenderableView', 'isAiCaptureView', 'isWalkView', 'aiCaptureTarget', 'aiCaptureViewMode', 'getActive3DCamera',
    'ensureAiRenderable3D', 'aiCaptureBoostedRatio', 'captureCurrent3DDataUrl', 'beginAiGuideCaptureResolution', 'endAiGuideCaptureResolution',
    'aiSegHex', 'aiSegmentationLegend', 'aiSegmentColorForObject', 'aiGuideObjectShouldHide', 'aiGuideObjectIsNeighborContext', 'captureSegmentation3DDataUrl', 'captureAiOverrideGuideDataUrl',
    'aiInstanceColorHex', 'aiInstanceFallbackColorHex', 'aiRefSource', 'aiInstanceKindFor', 'aiInstanceSummary', 'captureInstance3DData',
    'render3DNow', 'currentUnityCameraSettings', 'buildUnityRenderRequest', 'buildAiRenderMetadata', 'buildAiRenderPrompt', 'ensureAiRenderableView', 'generateAiRenderPackage',
    'videoCameraDescriptor', 'videoPackageJson', 'planEmptyFloorRefusal', 'generateVideoRenderPackage',
    'walkApplyCamera', 'walkApplyFpsCamera', 'updateWalkMode', 'updateWalkDoors', 'walkCullSkipType', 'applyWalkCulling', 'clearWalkCulling',
    'copyWalkRoutePoint', 'getWalkRouteLocalPoints', 'getWalkRouteWorldPoints', 'walkRoutePathLengthMmFromPoints', 'sampleWalkRoutePath', 'getWalkRouteEndpoints', 'getWalkRouteById', 'beginWalkthrough', 'updateWalkthroughCamera', 'stopWalkthrough',
  ];
  load(c, names);
  for (const name of ['captureOrbitState', 'restoreOrbitState', 'withAiCaptureTransaction']) {
    if (new RegExp('(?:^|\\n)function ' + name + '\\(').test(source)) load(c, [name]);
  }
  if (mode === 'fps' || mode === 'tps') { c.walkApplyFpsCamera(); c.applyWalkCulling(); }
  if (mode === 'tps') {
    c.WalkTpsFoundation = require('../../assets/js/walk-tps-foundation.js');
    c.WalkTpsBoundary = require('../../assets/js/walk-tps-boundary.js');
    c.WalkTpsMeshVolumes = require('../../assets/js/walk-tps-mesh-volumes.js');
    c.RoomGeometry = require('../../assets/js/room-geometry.js');
    for (const file of ['walk-tps-avatar.js', 'walk-tps.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', file), 'utf8'), c, { filename: file });
    assert.equal(c.WalkTps.setMode('tps'), true);
    assert.equal(c.WalkTps.debug().output.camera.verified, true, 'real TPS fixture must have a verified camera');
    c.WALK.keys = { fwd: true, left: true }; c.iMov.w = true; c.iMov.arrowleft = true;
  }
  if (mode === 'route') {
    const route = { id: 'route', type: 'walk-route', floor: 1, x: 0, y: 0, w: 10000, d: 10000, pathPoints: [{ x: 5000, y: 5000 }, { x: 5000, y: 1000 }], speed: 0.5 };
    // The repository path uses local points (route x/y are zero here).
    c.DATA.items.push(route); c.walkRouteSpeedMps = () => 0.5;
    assert.equal(c.beginWalkthrough(route), true);
  }
  function advance(ms) {
    now += ms;
    if (mode === 'fps' || mode === 'tps') c.updateWalkMode(now);
    else if (mode === 'route') c.updateWalkthroughCamera(now);
    else c.orbit.update(ms / 1000);
    c.sc3.updateMatrixWorld(true); c.camExt.updateMatrixWorld(true);
  }
  async function boundary(kind, ms, value) {
    events.push({ kind, active: !!c.AI_CAPTURE_TRANSACTION });
    assert.equal(c.AI_CAPTURE_TRANSACTION, null, kind + ' may run only after the synchronous capture transaction closes');
    advance(ms);
    if (c.onBoundary) await c.onBoundary(kind);
    return value;
  }
  c.waitFrame = ms => boundary('wait', ms);
  c.decodePngDataUrlToImageData = () => boundary('decode', 50, { width: 1600, height: 1200, data: new Uint8ClampedArray(16) });
  c.imageDataToPngDataUrl = () => 'reference';
  c.makeEdgeDataUrlFromSegmentation = () => boundary('edge', 300, 'edge');
  c.waitForPlanFloorTopImages = () => boundary('top-images', 200, { images: 0, pending: 0, waitedMs: 200 });
  c.drawPlanCameraOverlay = (plan, camera) => { c.overlayCamera = plain(camera); return boundary('overlay', 100, 'plan-context'); };
  c.dataUrlToBytes = () => boundary('bytes', 40, new Uint8Array([1, 2, 3]));
  c.sc3.updateMatrixWorld(true); c.camExt.updateMatrixWorld(true);
  return { c, T, shots, events, statuses, disposals, generatedGuideMaterials, pivot, instanced, light, advance, resolution: () => ({ ratio, width, height }) };
}
function requireTransaction(c) { assert.equal(typeof c.withAiCaptureTransaction, 'function', 'shared actual capture transaction must exist'); }
function assertAligned(h, count) {
  assert.equal(h.shots.length, count);
  const first = h.shots[0];
  for (const shot of h.shots) {
    assert.deepEqual(shot.camera, first.camera, shot.kind + ': exact camera pose/projection/world matrices');
    assert.deepEqual(shot.meshes, first.meshes, shot.kind + ': exact door/avatar/culling/transforms');
    assert.equal(shot.transaction, first.transaction, 'one transaction for the package');
    assert.equal(shot.ratio, first.ratio, shot.kind + ': same capture resolution');
    assert.equal(shot.width, first.width); assert.equal(shot.height, first.height);
  }
  assert.ok(first.transaction, 'all raw images are captured inside the transaction');
  assert.ok(h.generatedGuideMaterials.size > 0, 'real guide passes allocate temporary materials');
  for (const disposed of h.generatedGuideMaterials.values()) assert.equal(disposed, true, 'temporary guide material disposed');
  assert.equal(h.events.filter(e => e.kind === 'prepare').length, 1, 'scene preparation/cutaway runs once');
  const shotEvents = h.events.map((e, i) => e.kind === 'shot' ? i : -1).filter(i => i >= 0);
  const middle = h.events.slice(shotEvents[0], shotEvents.at(-1) + 1);
  assert.equal(middle.some(e => ['wait', 'decode', 'edge', 'top-images', 'overlay', 'bytes', 'zip', 'plan'].includes(e.kind)), false, 'no asynchronous or plan/ZIP work between raw 3D captures');
}
function capturedSettings(shot) { return { camX: shot.camera.position[0], camY: shot.camera.position[1], camZ: shot.camera.position[2], fieldOfView: shot.camera.fov }; }
function assertMetadataCamera(settings, shot) { for (const [key, value] of Object.entries(capturedSettings(shot))) assert.equal(settings[key], value, 'metadata matches captured ' + key); }

for (const autoRotate of [false, true]) test('real OrbitControls damping transaction keeps all raw captures and camera metadata identical (autoRotate=' + autoRotate + ')', async () => {
  const h = await runtime(); const { c } = h; requireTransaction(c); c.orbit.autoRotate = autoRotate;
  const beforeCam = cameraState(c.camExt), beforeOrbit = orbitState(c.orbit), beforeScene = sceneState(c.sc3), beforeResolution = h.resolution();
  const beforeWalk = plain(c.WALK), beforeInput = plain(c.iMov);
  const context = c.beginNativeOutputRequest('image');
  let metadata;
  const returned = c.withAiCaptureTransaction(context, () => {
    assert.ok(c.AI_CAPTURE_TRANSACTION);
    c.captureCurrent3DDataUrl(); c.captureSegmentation3DDataUrl(); c.captureInstance3DData(); c.captureAiOverrideGuideDataUrl('depth'); c.captureAiOverrideGuideDataUrl('normal');
    metadata = c.buildAiRenderMetadata([], context.snapshot);
    return 'sync-result';
  });
  assert.equal(returned, 'sync-result'); assert.equal(c.AI_CAPTURE_TRANSACTION, null);
  assertAligned(h, 5); assertMetadataCamera(metadata.camera, h.shots[0]);
  assert.deepEqual(cameraState(c.camExt), beforeCam, 'capture cannot move the visible camera');
  assert.deepEqual(orbitState(c.orbit), beforeOrbit, 'capture cannot consume pending orbit damping/pan/zoom or auto rotation');
  assertSceneRestored(beforeScene); assert.deepEqual(h.resolution(), beforeResolution);
  assert.deepEqual(plain(c.WALK), beforeWalk); assert.deepEqual(plain(c.iMov), beforeInput);
  c.orbit.update(1 / 60); assert.notDeepEqual(cameraState(c.camExt).position, beforeCam.position, 'residual orbit input still advances after capture');
});

for (const mode of ['orbit', 'fps', 'tps', 'route']) test('actual image package captures one ' + mode + ' pose before codecs and freezes camera prompt', async () => {
  const h = await runtime(mode); const { c } = h;
  const input = plain(c.iMov), keys = plain(c.WALK.keys);
  const pkg = await c.generateAiRenderPackage();
  assert.ok(pkg, h.statuses.join('\n'));
  assertAligned(h, 5); assertMetadataCamera(pkg.metadata.camera, h.shots[0]);
  assert.equal(c.isNativeOutputPackageCurrent(pkg), true);
  assert.deepEqual(plain(c.iMov), input, 'held keyboard state survives'); assert.deepEqual(plain(c.WALK.keys), keys, 'held walk buttons survive');
  assert.notDeepEqual(cameraState(c.camExt).position, h.shots[0].camera.position, 'real movement/orbit/route continued during async codecs');
  const s = pkg.metadata.camera, az = Math.round(Math.atan2(s.targetX - s.camX, s.targetZ - s.camZ) * 180 / Math.PI);
  assert.ok(pkg.prompt.includes('Camera: fov ' + Math.round(s.fieldOfView) + ' deg, eye height about ' + s.camY.toFixed(1) + ' m above ground, looking azimuth ' + az + ' deg'), 'prompt must describe the captured camera after edge await');
  if (mode === 'fps' || mode === 'tps') assert.ok(h.pivot.rotation.y > 0, 'real door animation advanced across codec waits');
  if (mode === 'tps') assert.equal(c.WalkTps.preference().mode, 'tps', 'capture cannot change TPS preference');
});

for (const mode of ['fps', 'tps', 'route']) for (const includeGuides of [false, true]) test('actual video package pairs ' + mode + ' camera/doors with guides=' + includeGuides + ' across all waits', async () => {
  const h = await runtime(mode); const { c } = h; const keys = plain(c.WALK.keys), input = plain(c.iMov);
  const pkg = await c.generateVideoRenderPackage({ source: '3d', includeGuides, download: false });
  assert.ok(pkg); assertAligned(h, includeGuides ? 5 : 2);
  assert.deepEqual(plain(pkg.packageJson.camera.posM), h.shots[0].camera.position, 'camera metadata comes from the same raw frame');
  assert.deepEqual(c.overlayCamera, plain(pkg.packageJson.camera), 'plan overlay uses captured camera');
  assert.deepEqual(c.promptCamera, plain(pkg.packageJson.camera), 'video prompt uses captured camera');
  assert.equal(pkg.packageJson.capture.includeGuides, includeGuides);
  const names = Array.from(pkg.files, f => f.name);
  for (const name of ['edge_guide.png', 'depth_guide.png', 'normal_guide.png', 'segmentation_guide.png', 'instance_guide.png']) assert.equal(names.includes(name), includeGuides, name + ': guides opt-in');
  assert.equal(c.isNativeOutputPackageCurrent(pkg), true);
  assert.deepEqual(plain(c.WALK.keys), keys); assert.deepEqual(plain(c.iMov), input);
  assert.notDeepEqual(cameraState(c.camExt).position, h.shots[0].camera.position, 'live motion continues after capture');
  if (mode === 'fps' || mode === 'tps') assert.ok(h.pivot.rotation.y > 0, 'door continued without being rewound by old finally');
});

test('transaction finally restores camera/orbit/materials/instancing/light/resolution on a thrown guide render', async () => {
  const h = await runtime('tps'); const { c } = h; requireTransaction(c);
  const beforeCam = cameraState(c.camExt), beforeOrbit = orbitState(c.orbit), beforeScene = sceneState(c.sc3), beforeWalk = plain(c.WALK), beforeInput = plain(c.iMov), beforeResolution = h.resolution();
  const actualRender = c.ren.render;
  c.ren.render = (scene, camera) => { if (scene.overrideMaterial) throw new Error('injected guide renderer failure'); actualRender(scene, camera); };
  assert.throws(() => c.withAiCaptureTransaction(c.beginNativeOutputRequest('image'), () => { c.captureCurrent3DDataUrl(); c.captureInstance3DData(); c.captureAiOverrideGuideDataUrl('normal'); }), /injected guide renderer failure/);
  assert.equal(c.AI_CAPTURE_TRANSACTION, null); assert.deepEqual(cameraState(c.camExt), beforeCam); assert.deepEqual(orbitState(c.orbit), beforeOrbit); assertSceneRestored(beforeScene); assert.deepEqual(h.resolution(), beforeResolution); assert.deepEqual(plain(c.WALK), beforeWalk); assert.deepEqual(plain(c.iMov), beforeInput);
  c.ren.render = actualRender;
  c.withAiCaptureTransaction(c.beginNativeOutputRequest('image'), () => c.captureInstance3DData());
  assert.equal(c.AI_CAPTURE_TRANSACTION, null, 'next capture is not poisoned by a previous throw');
});

test('a stale/cancelled request cannot enter capture or leave a capture owner behind', async () => {
  const h = await runtime(); const { c } = h; requireTransaction(c);
  const context = c.beginNativeOutputRequest('image'); c.cancelNativeOutputRequest('image');
  assert.throws(() => c.withAiCaptureTransaction(context, () => assert.fail('cancelled callback ran')), error => error.nativeOutputCancelled === true);
  assert.equal(c.AI_CAPTURE_TRANSACTION, null); assert.equal(h.shots.length, 0);
});

for (const kind of ['image', 'video']) test('actual ' + kind + ' package cancels plan edits during codecs without rewinding live motion', async () => {
  const h = await runtime('fps'); const { c } = h; let changed = false;
  c.onBoundary = type => { if (!changed && (type === 'edge' || type === 'decode')) { changed = true; c.DATA.items[0].x += 25; } };
  if (kind === 'image') { assert.equal(await c.generateAiRenderPackage(), null); assert.equal(c.AI_RENDER_PACKAGE, null); }
  else { await assert.rejects(c.generateVideoRenderPackage({ source: '3d', includeGuides: true, download: false }), error => error.nativeOutputCancelled === true); assert.equal(c.VIDEO_RENDER_PACKAGE, null); }
  assert.equal(changed, true); assert.equal(c.AI_CAPTURE_TRANSACTION, null); assertAligned(h, 5);
  assert.notDeepEqual(cameraState(c.camExt).position, h.shots[0].camera.position); assert.ok(h.pivot.rotation.y > 0);
});

for (const replacement of ['plan-install', 'disposed', 'newer-request']) test('transaction cleanup never restores an old pose into ' + replacement + ' state', async () => {
  const h = await runtime(); const { c, T } = h; requireTransaction(c);
  const context = c.beginNativeOutputRequest('image'); let newerCam, newerOrbit, newerScene, savedCam, savedOrbit, savedScene;
  assert.throws(() => c.withAiCaptureTransaction(context, () => {
    if (replacement === 'plan-install') {
      c.DATA = { walls: [], rooms: [], items: [] }; c.__editorPlanId = 'new-plan'; ++c.NATIVE_OUTPUT_REQUESTS.epoch;
      c.camExt = new T.PerspectiveCamera(39, 2, 0.2, 80); c.sc3 = new T.Scene(); c.orbit = new (c.orbit.constructor)(c.camExt);
    } else if (replacement === 'disposed') { c._editorPaneDisposed = true; }
    else c.beginNativeOutputRequest('image');
    c.camExt.position.set(51, 22, 73); c.camExt.lookAt(40, 2, 0); c.camExt.updateMatrixWorld(true);
    c.orbit.target.set(30, 2, 10); c.orbit.enableDamping = false; c.orbit.autoRotate = false;
    c.sc3.background = new T.Color(0x112233);
    newerCam = c.camExt; newerOrbit = c.orbit; newerScene = c.sc3;
    savedCam = cameraState(newerCam); savedOrbit = orbitState(newerOrbit); savedScene = sceneState(newerScene);
    c.assertNativeOutputRequest(context);
  }), error => error.nativeOutputCancelled === true);
  assert.equal(c.AI_CAPTURE_TRANSACTION, null); assert.equal(c.camExt, newerCam); assert.equal(c.orbit, newerOrbit); assert.equal(c.sc3, newerScene);
  assert.deepEqual(cameraState(newerCam), savedCam, 'new/current camera cannot be rewound'); assert.deepEqual(orbitState(newerOrbit), savedOrbit, 'new/current controls cannot be overwritten'); assertSceneRestored(savedScene);
});

test('test scope remains actual-function and offline: captures are not replaced by spies', () => {
  assert.ok(html.includes('function captureCurrent3DDataUrl('));
  for (const name of ['captureCurrent3DDataUrl', 'captureSegmentation3DDataUrl', 'captureInstance3DData', 'captureAiOverrideGuideDataUrl', 'generateAiRenderPackage', 'generateVideoRenderPackage']) assert.ok(functionCode(name).includes(name + '('));
});
