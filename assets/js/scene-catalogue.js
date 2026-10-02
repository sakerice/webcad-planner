/* A read-only, runtime-derived catalogue contract for Scene IR. No remote assets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SceneCatalogue = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var UNSAFE = ['__proto__', 'prototype', 'constructor'];
  var EXCLUDED = /^(door-|window|roof$|foundation$|site-rect$|memo$|walk-route$|ruler$|tv$|neighbor-|road$|utility-pole$)/;
  // Narrow asset-specific audit; do not turn absent metadata into a blanket +Z guess.
  var VERIFIED_FRONTS = { 'fmp-WashBasin01': '+Z' };
  // Exact represented-unit audit: manifests + checked-in previews-v2 thumbnails.
  // original-toilet is additionally backed by tools/blender/build_sanitary.py.
  // No claims about neighboring variants, product identity, or unknown axes.
  var VERIFIED_FIXTURES = {
    'fmp-WashBasin01': 'washbasin', 'fmp-ShowerSystem01': 'shower-fixture',
    'fmp-Toilet01': 'toilet', 'original-toilet': 'toilet'
  };
  var CAR_CERTIFICATE = {url:'assets/models/refined/precision_car_v1.glb',sha256:'eef8d9a9ba8130ee74d30daaa84ba50eec194685490bfc72490c09a6abe7e14b',front:'+Z'};
  var COLOR = /^#[0-9a-f]{6}$/i;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cleanId(v) { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(v) && UNSAFE.indexOf(v) < 0; }
  function create(input) {
    input = input || {};
    var entries = Object.create(null), aliases = input.aliases || {};
    var textures = (input.textureIds || []).filter(function (v) { return cleanId(v); });
    Object.keys(input.builtins || {}).forEach(function (id) {
      if (!cleanId(id) || EXCLUDED.test(id) || own(aliases, id)) return;
      var size = input.builtins[id], finishModel=(input.finishModels||{})[id], asset=(input.builtinAssets||{})[id];
      var certifiedCar = id==='car' && asset && asset.url===CAR_CERTIFICATE.url && asset.sha256===CAR_CERTIFICATE.sha256;
      entries[id] = { id: id, source: 'builtin', name: id, w: size.w, d: size.d,
        h: id === 'car' ? 1620 : null, kind: id === 'car' ? 'car' : null,
        front: certifiedCar ? CAR_CERTIFICATE.front : null, frontProvenance: certifiedCar ? 'hash-pinned-active-glb-and-corrected-fallback' : 'unknown', semanticExtent: 'asset', finishChannels: finishModel ? (finishModel.finishChannels||[]).map(function(c){return {key:c.key,default:c.default};}) : [], genericColor: true };
    });
    Object.keys(input.items || {}).forEach(function (id) {
      var item = input.items[id];
      if (!cleanId(id) || !item || !Number.isFinite(item.w) || !Number.isFinite(item.d)) return;
      // Openings must use the opening compiler, never free-standing furniture placement.
      var opening = item.category === '窓' || item.category === 'ドア' || item.group === '建具';
      var extent = own(VERIFIED_FIXTURES, id) || /^(original-bathtub|fmp-BathTub\d+)$/.test(id) ? 'individual-fixture' : 'asset';
      entries[id] = { id: id, source: 'catalogue', name: item.name || id,
        w: item.w, d: item.d, h: Number.isFinite(item.h) ? item.h : null,
        kind: item.kind || null, front: item.front || VERIFIED_FRONTS[id] || null,
        frontProvenance: item.front ? 'manifest' : VERIFIED_FRONTS[id] ? 'verified-top-preview-and-runtime-normalization' : 'unknown', semanticExtent: extent,
        openingOnly: opening, category: item.category || null,
        finishChannels: (item.finishChannels || []).map(function (c) { return { key: c.key, default: c.default }; }),
        genericColor: false, defaultElevation: item.defaultElevation || 0 };
      if (own(VERIFIED_FIXTURES, id)) {
        entries[id].sourceObjectType = VERIFIED_FIXTURES[id];
        entries[id].semanticExtentProvenance = 'exact-id-manifest-and-thumbnail-audit';
      }
    });
    function get(id) { return cleanId(id) && own(entries, id) ? entries[id] : null; }
    function describe(id) {
      var e = get(id); if (!e) return null;
      return JSON.parse(JSON.stringify(Object.assign({}, e, {
        parameters: ['w', 'd', 'rot', 'flipX', 'flipY', 'elev', 'baseRoom', 'baseLevel'].concat(
          e.genericColor ? ['color', 'colorCustom'] : ['finishColors', 'finishTextures', 'finishRoughness']),
        textureIds: textures, roughnessValues: [0.85, 0.48, 0.22]
      })));
    }
    return { get: describe, list: function () { return Object.keys(entries).map(describe); },
      resolveAlias: function (id) { return own(aliases, id) ? aliases[id] : null; },
      textureIds: textures.slice() };
  }
  return { carCertificate: Object.freeze(CAR_CERTIFICATE), create: create, cleanId: cleanId, isColor: function (v) { return typeof v === 'string' && COLOR.test(v); } };
}));
