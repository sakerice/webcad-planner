/* Review-only legacy identity conversion. No persistence, normalization or live editor access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LegacyPlanCopyDryRun = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLLECTIONS = ['walls', 'items', 'rooms'];
  // These are the only maps whose app-identity key format has been inspected.
  var MAPS = [
    { settings: 'exteriorWallSettings', map: 'walls', kind: 'wall' },
    { settings: 'exteriorWallSettings', map: 'faces', kind: 'face' },
    { settings: 'interiorWallSettings', map: 'faces', kind: 'face' }
  ];
  // Conservative read-only audit, never a recursive number/ID rewrite. A named
  // reference to an affected legacy identity blocks even if its owner has a floor.
  var REFERENCE_FIELDS = [
    'baseRoom', 'wallId', 'wallID', 'roomId', 'roomID', 'itemId', 'itemID',
    'objectId', 'objectID', 'entityId', 'entityID', 'parentId', 'parentID',
    'supportId', 'supportID', 'hostId', 'hostID', 'hostWallId', 'hostWallID',
    'openingHostWallId', 'relativeToId', 'routeId', 'selectedId', 'stairTo',
    'wallKey', 'faceKey', 'targetId', 'targetID', 'linkedId', 'linkedID', 'wallIds', 'roomIds',
    'itemIds', 'objectIds', 'entityIds', 'parentIds', 'supportIds', 'hostIds',
    'targetIds', 'linkedIds'
  ];
  var REFERENCE_CONTAINERS = ['sourceIdMap', 'attachment', 'references'];
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function put(o, key, value) {
    Object.defineProperty(o, key, { value: value, writable: true, enumerable: true, configurable: true });
  }
  function jsonClone(v, path, stack) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object') throw Error(path + ': only JSON values are supported');
    var proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw Error(path + ': non-JSON object');
    if (stack.indexOf(v) >= 0) throw Error(path + ': cyclic value');
    if (Object.getOwnPropertySymbols(v).some(function (k) { return Object.getOwnPropertyDescriptor(v, k).enumerable; }))
      throw Error(path + ': symbol key');
    if (Object.getOwnPropertyNames(v).some(function (k) {
      return !(Array.isArray(v) && k === 'length') && !Object.getOwnPropertyDescriptor(v, k).enumerable;
    })) throw Error(path + ': non-enumerable own field');
    var next = stack.concat([v]), out = Array.isArray(v) ? [] : {};
    if (Array.isArray(v) && (Object.keys(v).length !== v.length ||
        Object.keys(v).some(function (key, index) { return key !== String(index); })))
      throw Error(path + ': sparse array or extra array fields');
    Object.keys(v).forEach(function (k) {
      var descriptor = Object.getOwnPropertyDescriptor(v, k);
      if (!own(descriptor, 'value')) throw Error(path + '.' + k + ': accessor');
      put(out, k, jsonClone(descriptor.value, path + '.' + k, next));
    });
    return out;
  }
  function clone(v) { return jsonClone(v, '$', []); }
  function presentId(v) { return v !== undefined && v !== null && v !== ''; }
  function floorOf(o) {
    var value = o.floor;
    if (value === undefined || value === null) return 1;
    if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== '')) return NaN;
    var numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function mapAt(plan, spec) {
    var settings = plan[spec.settings];
    return settings && own(settings, spec.map) ? settings[spec.map] : null;
  }
  function faceSuffix(key, id) {
    var prefix = String(id) + '_';
    // Matching the exact entire prefix preserves every existing suffix byte,
    // including dormant/unrecognized suffixes; 8 must never match 80_*.
    return key.indexOf(prefix) === 0 ? key.slice(String(id).length) : null;
  }
  function identityReferences(plan) {
    var hits = [];
    function findValues(value, path, field, container) {
      if (value === null || value === undefined) return;
      if (typeof value === 'number' || typeof value === 'string') {
        hits.push({ path: path, field: field, value: value });
      } else if (typeof value === 'object') {
        Object.keys(value).forEach(function (key) {
          // Named opaque reference containers might be identity-keyed. Until a
          // specific format is proven, audit/reserve object keys too. Array
          // indexes are positions, never identity references.
          if (container && !Array.isArray(value)) hits.push({ path: path + '.' + key, field: field, value: key, objectKey: true });
          // Preserve nested recognized semantics, e.g. attachment.faceKey, rather
          // than treating its composite face value as a bare attachment ID.
          var nestedField = REFERENCE_FIELDS.indexOf(key) >= 0 || REFERENCE_CONTAINERS.indexOf(key) >= 0 ? key : field;
          findValues(value[key], path + '.' + key, nestedField, container || REFERENCE_CONTAINERS.indexOf(key) >= 0);
        });
      }
    }
    function visit(value, path) {
      if (!value || typeof value !== 'object') return;
      Object.keys(value).forEach(function (key) {
        if (REFERENCE_FIELDS.indexOf(key) >= 0 || REFERENCE_CONTAINERS.indexOf(key) >= 0)
          findValues(value[key], path + '.' + key, key, REFERENCE_CONTAINERS.indexOf(key) >= 0);
        else visit(value[key], path + '.' + key);
      });
    }
    visit(plan, '$');
    return hits;
  }
  function strictCheck(schema, plan) {
    var checked = schema.validatePlan(plan);
    if (!checked || typeof checked.ok !== 'boolean' || !Array.isArray(checked.errors) || !Array.isArray(checked.warnings))
      throw Error('The strict validator returned an unsupported result');
    return clone(checked);
  }
  function failureMessage(error) {
    if (typeof error === 'string') return error;
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      var descriptor = Object.getOwnPropertyDescriptor(error, 'message');
      if (descriptor && own(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value;
    }
    return 'Validator or planning failure';
  }

  function createDryRunHelper(schema) {
    if (!schema || typeof schema.validatePlan !== 'function') throw Error('An unchanged strict PlanSchema validator is required');
    if (!schema.LIMITS || !Number.isFinite(schema.LIMITS.COORD_MM)) throw Error('The strict validator coordinate limit is required');
    return function dryRun(plan) {
      var source, validation;
      var diagnostics = [], mapping = [], zeroLengthWalls = [], copies = [];
      function sourceUnchanged() {
        // Never stringify caller objects: even a hidden toJSON could mutate them.
        try { return source ? same(source, clone(plan)) : null; } catch (_) { return false; }
      }
      function blocked(code, detail) {
        diagnostics.push({ code: code, severity: 'error', detail: detail });
        return { prepared: false, status: 'blocked', reviewOnly: true, candidate: null,
          mapping: [], plannedMapping: mapping, originalValidation: validation || null,
          candidateValidation: null, zeroLengthWalls: zeroLengthWalls, settingsCopies: [],
          diagnostics: diagnostics, invariants: { sourceUnchanged: sourceUnchanged() } };
      }
      try { source = clone(plan); validation = strictCheck(schema, clone(source)); }
      catch (error) { return blocked('invalid_json_or_validator', failureMessage(error)); }
      if (!source || typeof source !== 'object' || Array.isArray(source) ||
          COLLECTIONS.some(function (name) { return !Array.isArray(source[name]); }))
        return blocked('unsupported_plan_shape', 'walls, items and rooms must all be arrays');

      try {

      // Validate first. Independently count the known cross-floor duplicates and
      // exact in-range zero walls, which this strict validator always reports.
      // Additional strict failures block planning. Diagnostic text is opaque:
      // no Japanese-error filtering and no language-dependent validation bypass.
      // The strict original/candidate result is always returned verbatim, never
      // promoted to valid, and normalizePlan is never called.
      var reserved = new Set(), maxId = 0, allocatorError = null;
      COLLECTIONS.forEach(function (name) {
        var seen = new Map(), floorSeen = new Map();
        source[name].forEach(function (o, index) {
          if (!o || typeof o !== 'object' || Array.isArray(o)) return;
          if (!presentId(o.id)) return;
          if (typeof o.id !== 'string' && typeof o.id !== 'number') {
            diagnostics.push({ code: 'unsupported_identity', severity: 'error', path: name + '[' + index + '].id' });
            return;
          }
          var key = String(o.id), floor = floorOf(o), floorKey = JSON.stringify([floor, key]);
          reserved.add(key);
          // Same trailing-number convention as ensureObjectIds, now pure and
          // reserving all three collections before allocating anything.
          var match = key.match(/(\d+)$/);
          if (match) {
            var numeric = Number(match[1]);
            if (!Number.isSafeInteger(numeric)) allocatorError = 'Existing numeric ID suffix exceeds safe integer range';
            else maxId = Math.max(maxId, numeric);
          }
          if (floorSeen.has(floorKey)) {
            diagnostics.push({ code: 'duplicate_within_floor', severity: 'error', collection: name,
              index: index, firstIndex: floorSeen.get(floorKey), floor: floor, id: o.id });
          }
          floorSeen.set(floorKey, index);
          if (seen.has(key)) {
            var first = seen.get(key);
            if (first.floor !== floor) {
              mapping.push({ collection: name, index: index, floor: floor, oldId: o.id, newId: null,
                retainedIndex: first.index, retainedFloor: first.floor });
            }
          } else seen.set(key, { index: index, floor: floor });
        });
      });
      source.walls.forEach(function (w, index) {
        if (!w || typeof w !== 'object') return;
        var coords = ['x1', 'y1', 'x2', 'y2'].map(function (k) {
          var v = w[k]; return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
        });
        if (coords.every(function (v) { return Number.isFinite(v) && Math.abs(v) <= schema.LIMITS.COORD_MM; }) &&
            coords[0] === coords[2] && coords[1] === coords[3]) {
          zeroLengthWalls.push({ index: index, id: w.id, floor: floorOf(w), record: clone(w) });
        }
      });
      if (diagnostics.some(function (d) { return d.severity === 'error'; }))
        return blocked('unsupported_identity_layout', 'Same-floor collisions or unsupported IDs cannot be converted safely');
      if (validation.errors.length !== mapping.length + zeroLengthWalls.length)
        return blocked('unhandled_validation_errors', { expectedKnownErrorCount: mapping.length + zeroLengthWalls.length,
          actualErrorCount: validation.errors.length, errors: clone(validation.errors) });

      // No remapping means no setting or reference changes. Preserve even large
      // numeric IDs on the no-op path; an allocator is only needed for remaps.
      if (mapping.length) {
        if (allocatorError) return blocked('allocator_range', allocatorError);
        var wallIds = source.walls.filter(function (w) { return presentId(w.id); }).map(function (w) { return String(w.id); });
        var ambiguousWallPrefixes = mapping.filter(function (m) {
          if (m.collection !== 'walls') return false;
          var id = String(m.oldId);
          return wallIds.some(function (other) {
            return other !== id && (other.indexOf(id + '_') === 0 || id.indexOf(other + '_') === 0);
          });
        });
        if (ambiguousWallPrefixes.length) return blocked('ambiguous_wall_face_prefix', ambiguousWallPrefixes);
        var affected = new Set(mapping.map(function (m) { return String(m.oldId); }));
        var references = identityReferences(source);
        var affectedReferences = references.filter(function (ref) {
          return affected.has(String(ref.value)) || Array.from(affected).some(function (id) {
            return faceSuffix(String(ref.value), id) !== null;
          });
        });
        if (affectedReferences.length) return blocked('unhandled_identity_references', affectedReferences);
        // A fresh ID must not bind an originally dangling explicit reference to
        // the copied entity. Reserve unaffected reference targets as well.
        references.forEach(function (ref) {
          reserved.add(String(ref.value));
          reserved.add(String(ref.value).split('_')[0]);
        });
        var mapShapeError = null;
        MAPS.forEach(function (spec) {
          var settings = source[spec.settings];
          if (settings !== undefined && settings !== null &&
              (typeof settings !== 'object' || Array.isArray(settings))) mapShapeError = spec.settings;
          var map = mapAt(source, spec);
          if (map !== null && (typeof map !== 'object' || Array.isArray(map))) mapShapeError = spec.settings + '.' + spec.map;
          if (map && typeof map === 'object' && !Array.isArray(map)) Object.keys(map).forEach(function (key) {
            // Reserve dormant settings identities too, so additions never replace
            // an unrelated existing wall/face setting at a fresh numeric ID.
            reserved.add(spec.kind === 'wall' ? key : key.split('_')[0]);
          });
        });
        if (mapShapeError) return blocked('unsupported_settings_map', mapShapeError);
        var next = Math.max(1, maxId + 1);
        for (var i = 0; i < mapping.length; i++) {
          while (Number.isSafeInteger(next) && reserved.has(String(next))) next++;
          if (!Number.isSafeInteger(next)) return blocked('allocator_exhausted', 'No fresh safe numeric ID remains');
          mapping[i].newId = next; reserved.add(String(next)); next++;
        }
      }

      var candidate = clone(source);
      mapping.forEach(function (m) { candidate[m.collection][m.index].id = m.newId; });
      mapping.filter(function (m) { return m.collection === 'walls'; }).forEach(function (m) {
        MAPS.forEach(function (spec) {
          var originalMap = mapAt(source, spec), targetMap = mapAt(candidate, spec);
          if (!originalMap) return;
          Object.keys(originalMap).forEach(function (key) {
            var suffix = spec.kind === 'wall' ? (key === String(m.oldId) ? '' : null) : faceSuffix(key, m.oldId);
            if (suffix === null) return;
            var targetKey = String(m.newId) + suffix;
            // Reservation makes this impossible; keep it fail-closed if the
            // policy/allocator changes later rather than overwrite dormant data.
            if (own(targetMap, targetKey)) throw Error('Reserved settings-key collision: ' + targetKey);
            put(targetMap, targetKey, clone(originalMap[key]));
            copies.push({ map: spec.settings + '.' + spec.map, sourceKey: key, targetKey: targetKey });
          });
        });
      });
      var candidateValidation = strictCheck(schema, clone(candidate));
      if (candidateValidation.errors.length !== zeroLengthWalls.length)
        return blocked('unexpected_candidate_validation_errors', clone(candidateValidation.errors));
      if (zeroLengthWalls.length) diagnostics.push({ code: 'zero_length_walls_retained', severity: 'review',
        count: zeroLengthWalls.length, detail: 'Every exact zero-length wall record and its settings remain; strict validation may still reject the copy' });
      if (!candidateValidation.ok) diagnostics.push({ code: 'candidate_strict_validation_failed', severity: 'review',
        detail: clone(candidateValidation.errors) });
      diagnostics.push({ code: 'review_only', severity: 'review',
        detail: 'Not a loadable payload contract. Archive original, create a new copy identity, obtain user-visible conversion choice, and verify real renderer appearance before any future integration' });
      var expected = clone(source);
      mapping.forEach(function (m) { expected[m.collection][m.index].id = m.newId; });
      copies.forEach(function (copy) {
        var parts = copy.map.split('.');
        put(expected[parts[0]][parts[1]], copy.targetKey, clone(source[parts[0]][parts[1]][copy.sourceKey]));
      });
      var mapsRetained = MAPS.every(function (spec) {
        var originalMap = mapAt(source, spec), candidateMap = mapAt(candidate, spec);
        return !originalMap || Object.keys(originalMap).every(function (key) { return own(candidateMap, key) && same(originalMap[key], candidateMap[key]); });
      });
      var invariants = {
        sourceUnchanged: sourceUnchanged(),
        countsAndArrayOrderPreserved: COLLECTIONS.every(function (name) { return source[name].length === candidate[name].length; }) && same(expected, candidate),
        onlyPlannedIdsAndKnownMapCopiesChanged: same(expected, candidate),
        allExistingSettingsEntriesRetained: mapsRetained,
        effectiveKnownMapValuesPreserved: copies.every(function (copy) {
          var parts = copy.map.split('.');
          return same(source[parts[0]][parts[1]][copy.sourceKey], candidate[parts[0]][parts[1]][copy.targetKey]);
        }),
        zeroLengthWallRecordsPreservedExceptPlannedId: zeroLengthWalls.every(function (z) {
          var expectedWall = clone(z.record), change = mapping.find(function (m) { return m.collection === 'walls' && m.index === z.index; });
          if (change) expectedWall.id = change.newId;
          return same(expectedWall, candidate.walls[z.index]);
        }),
        uniqueIdsWithinEachCollection: COLLECTIONS.every(function (name) {
          var ids = candidate[name].filter(function (o) { return presentId(o.id); }).map(function (o) { return String(o.id); });
          return new Set(ids).size === ids.length;
        }),
        freshIdsAvoidEveryOriginalEntityId: mapping.every(function (m) {
          return COLLECTIONS.every(function (name) { return source[name].every(function (o) { return String(o.id) !== String(m.newId); }); });
        })
      };
      return { prepared: true, status: mapping.length ? 'review-only' : 'no-op', reviewOnly: true,
        candidate: candidate, mapping: mapping, originalValidation: validation,
        candidateValidation: candidateValidation, zeroLengthWalls: zeroLengthWalls,
        settingsCopies: copies, diagnostics: diagnostics, invariants: invariants };
      } catch (error) {
        return blocked('planning_or_candidate_validation_failed', failureMessage(error));
      }
    };
  }
  return { createDryRunHelper: createDryRunHelper,
    knownMaps: clone(MAPS), referenceFields: REFERENCE_FIELDS.slice(), referenceContainers: REFERENCE_CONTAINERS.slice() };
}));
