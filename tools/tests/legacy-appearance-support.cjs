'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const FILES = ['index.html', 'assets/js/app-constants.js', 'assets/js/app-state.js', 'assets/js/plan-data.js'];
const SOURCE = FILES.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
const PlanSchema = require(path.join(ROOT, 'assets/js/plan-schema.js'));
const RoomGeometry = require(path.join(ROOT, 'assets/js/room-geometry.js'));
const dryRun = require(path.join(ROOT, 'assets/js/legacy-plan-copy-dryrun.js')).createDryRunHelper(PlanSchema);

// These inspected functions end with an unindented closing brace. Extract the
// implementation from the workcopy on every test-process run, never a mirror.
function realFunction(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(SOURCE);
  assert.ok(match, 'Missing real app function: ' + name);
  const end = SOURCE.indexOf('\n}', match.index);
  assert.ok(end > match.index, 'Missing function end: ' + name);
  const code = SOURCE.slice(match.index, end + 2);
  new vm.Script(code, { filename: name + '.actual-source.js' });
  return code;
}
function realConstant(name) {
  const match = new RegExp('^var ' + name + '\\s*=[^\\n]+;', 'm').exec(SOURCE);
  assert.ok(match, 'Missing real app constant: ' + name);
  return match[0];
}

const CONSTANTS = ['U', 'WALL_COLORS', 'INTERIOR_WALL_DEFAULT', 'WALL_H', 'DEFAULT_WALL_H_MM',
  'WALL_H_MIN', 'DEFAULT_FLOOR_RAISE_MM', 'INTERIOR_FINISH_MM'];
const FUNCTIONS = [
  'normalizeTextureOrientationTarget', 'setTextureSettingValue', 'appearanceWithTextureOrientation',
  'defaultInteriorFloorSetting', 'ensureInteriorWallSettings', 'interiorFaceKey',
  'getInteriorFaceSetting', 'findExistingWallFaceAppearance', 'resolveInteriorFaceAppearance',
  'resolveInteriorWallAppearance', 'defaultExteriorFloorSetting', 'ensureExteriorWallSettings',
  'wallSettingKey', 'getExteriorWallSetting', 'exteriorFaceKey', 'getExteriorFaceSetting',
  'resolveExteriorFaceAppearance', 'resolveExteriorWallAppearance', 'syncExteriorWallSettings',
  'getFloorWallBounds', 'isExteriorRoom', 'getExteriorZones', 'isPointInsideExteriorZone',
  'isPointInsideExteriorRoom', 'wallNetworkSignature', 'segOrient', 'isOnSeg', 'segmentsIntersect',
  'getWallOutsideGrid', 'isPointOutsideWallNetworkRaw', 'classifyExteriorSampleSide',
  'chooseExteriorSide', 'addExteriorRoomBreakpoints', 'getWallExteriorSpans',
  'addWallIntersectionBreakpointsBySide', 'wallJoinsAtCorner', 'wallCornerExtensionMm',
  'getWallInteriorFaces', 'ensureObjectIds', 'serializeDataSnapshot', 'ensureRoofAppearance', 'resolveRoofAppearance',
  'resetHeightGlobalsForPlanLoad', 'clampWallHeightMm', 'ensureHeightDefaults',
  'ensureFloorMetadata', 'legacyAdmissionRepository', 'validateEditorPlan', 'retainsExistingLegacyValues', 'stageJsonImport'
];

function appearanceContext(plan) {
  const context = vm.createContext({
    PlanSchema, RoomGeometry, console, DATA: structuredClone(plan), ST: { selected: null }, nextId: 1,
    // Empty anonymous item fixtures avoid unrelated furniture/catalogue migration.
    // Every appearance, orientation, geometry, ID and staging function above is real.
    normalizeLegacyFurnitureItems() { assert.equal(context.DATA.items.length, 0); }
  });
  context.window = context;
  context.parent = context;
  vm.runInContext(CONSTANTS.map(realConstant).join('\n') + '\nvar _wallOutsideGridCache={};\n' +
    FUNCTIONS.map(realFunction).join('\n'), context, { filename: 'legacy-appearance.actual-source.js' });
  return context;
}

const plain = value => JSON.parse(JSON.stringify(value));
const wall = (id, floor, x1, y1, x2, y2, extra = {}) => ({ id, floor, x1, y1, x2, y2, thick: 120, ...extra });
function shell(floor, topId, offset = 0) {
  return [wall(topId, floor, offset, 0, offset + 2400, 0),
    wall('right-' + floor, floor, offset + 2400, 0, offset + 2400, 2400),
    wall('bottom-' + floor, floor, offset + 2400, 2400, offset, 2400),
    wall('left-' + floor, floor, offset, 2400, offset, 0)];
}
function settingsFixture() {
  const entry = (color, texture, flipX, flipY) => ({ color, texture, textureFlipX: flipX,
    textureFlipY: flipY, customExtension: { retained: ['anonymous', null, false], opaque: { number: 7 } } });
  return {
    walls: [...shell(1, 7), ...shell(2, 7, 4000)], items: [], rooms: [],
    exteriorWallSettings: {
      whole: { linked: false, color: '#102030', texture: null, textureFlipX: false, textureFlipY: false },
      floors: { 1: { linked: false, color: '#405060', texture: null, textureFlipX: false, textureFlipY: false },
        2: { linked: false, color: '#405060', texture: null, textureFlipX: false, textureFlipY: false } },
      walls: { 7: entry('#112233', 'data:anonymous-exterior-wall', true, false),
        'dormant-wall': entry('#998877', 'data:anonymous-dormant-wall', false, true) },
      faces: { '7_-1_0_2400': { mode: 'custom', ...entry('#223344', 'data:anonymous-exterior-face', false, true) },
        '7_dormant_suffix': { mode: 'custom', ...entry('#445566', 'data:anonymous-dormant-suffix', true, true) },
        'unknown_face_format': { marker: ['keep', false, null], texture: 'data:anonymous-unknown' } },
      customRootField: { keep: true }
    },
    interiorWallSettings: {
      whole: { linked: false, color: '#607080', texture: null, textureFlipX: false, textureFlipY: false },
      floors: { 1: { linked: false, color: '#8090a0', texture: null, textureFlipX: false, textureFlipY: false },
        2: { linked: false, color: '#8090a0', texture: null, textureFlipX: false, textureFlipY: false } },
      faces: { '7_1_0_2400': { mode: 'custom', ...entry('#334455', 'data:anonymous-interior-face', true, true) },
        '7_dormant_suffix': { mode: 'unrecognized', ...entry('#556677', 'data:anonymous-dormant-interior', false, true) },
        'unknown_interior_format': { skirting: false, unknown: { retain: 1 } } },
      customRootField: { keep: 'interior' }
    }, customPlanField: { retain: ['anonymous-extension'] }
  };
}

module.exports = { ROOT, SOURCE, PlanSchema, dryRun, realFunction, appearanceContext, plain, wall, shell, settingsFixture };
