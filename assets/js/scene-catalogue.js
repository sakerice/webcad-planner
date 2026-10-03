/* A read-only, runtime-derived catalogue contract for Scene IR. No remote assets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scene-material-audit.js'),require('./scene-appearance-profiles.js'));
  else root.SceneCatalogue = factory(root.SceneMaterialAudit,root.SceneAppearanceProfiles);
}(typeof self !== 'undefined' ? self : this, function (MaterialAudit, Profiles) {
  'use strict';
  var UNSAFE = ['__proto__', 'prototype', 'constructor'];
  var EXCLUDED = /^(door-|window|roof$|foundation$|site-rect$|memo$|walk-route$|ruler$|tv$|neighbor-|road$|utility-pole$)/;
  // Narrow asset-specific audit; do not turn absent metadata into a blanket +Z guess.
  var VERIFIED_FRONTS = { 'fmp-WashBasin01': '+Z', 'im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown': '+Z' };
  // Exact represented-unit audit: manifests + checked-in previews-v2 thumbnails.
  // original-toilet is additionally backed by tools/blender/build_sanitary.py.
  // No claims about neighboring variants, product identity, or unknown axes.
  var VERIFIED_FIXTURES = {
    'fmp-WashBasin01': 'washbasin', 'fmp-ShowerSystem01': 'shower-fixture',
    'fmp-Toilet01': 'toilet', 'original-toilet': 'toilet'
  };
  // Exact IDs audited against checked-in manifests; no family/name inference.
  var SOURCE_OBJECT_TYPES = {
    'im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown':'cabinet', 'fmp-Sofa01':'sofa', 'original-table':'dining-table',
    'fmp-CabinetA_Sink':'kitchen-sink', 'fmp-Refrigerator01':'refrigerator',
    'original-kitchen-i2400':'kitchen-unit', 'original-bathtub':'bathtub','fmp-Bed01':'bed','fmp-Chair07':'chair','original-washer-drum':'laundry'
  };
  var BUILTIN_KINDS = {'car':'car','bed-d':'bed','bed-s':'bed','semi_double_bed':'bed','desk':'desk','dining-table':'dining-table','low_table':'table'};
  var AXES = ['+Z','-Z','+X','-X'];
  var CAR_CERTIFICATE = {url:'assets/models/refined/precision_car_v1.glb',sha256:'eef8d9a9ba8130ee74d30daaa84ba50eec194685490bfc72490c09a6abe7e14b',front:'+Z'};
  var COLOR = /^#[0-9a-f]{6}$/i;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cleanId(v) { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(v) && UNSAFE.indexOf(v) < 0; }
  // Change between orthogonal rectangle bases only. Preserve source dimensions
  // and world envelope; never shear, invent a mirror, or alter source facts.
  function deriveFootprintFit(fp, rotationDeg) {
    if (!fp || !fp.axisX || !fp.sizeMm || !Number.isFinite(rotationDeg) ||
        !Number.isFinite(fp.sizeMm.w) || !Number.isFinite(fp.sizeMm.d) || fp.sizeMm.w <= 0 || fp.sizeMm.d <= 0) return null;
    var axis=fp.axisX, norm=Math.hypot(axis.x,axis.y);
    if (!Number.isFinite(axis.x) || !Number.isFinite(axis.y) || !Number.isFinite(norm) || norm===0 || Math.abs(norm-1)>Math.SQRT2*.00005) return null;
    var sourceAngle=Math.atan2(axis.y,axis.x), rotation=rotationDeg*Math.PI/180;
    var delta=Math.atan2(Math.sin(rotation-sourceAngle),Math.cos(rotation-sourceAngle));
    var quarter=Math.round(delta/(Math.PI/2));
    if (Math.abs(delta-quarter*Math.PI/2)>.00001) return null;
    var swapped=Math.abs(quarter)%2===1;
    return {w:swapped?fp.sizeMm.d:fp.sizeMm.w,d:swapped?fp.sizeMm.w:fp.sizeMm.d,
      basisExchanged:swapped,relativeQuarterTurns:((quarter%4)+4)%4};
  }
  function create(input) {
    input = input || {};
    var entries = Object.create(null), aliases = input.aliases || {};
    var textures = (input.textureIds || []).filter(function (v) { return cleanId(v); });
    Object.keys(input.builtins || {}).forEach(function (id) {
      if (!cleanId(id) || EXCLUDED.test(id) || own(aliases, id)) return;
      var size = input.builtins[id], finishModel=(input.finishModels||{})[id], asset=(input.builtinAssets||{})[id];
      var certifiedCar = id==='car' && asset && asset.url===CAR_CERTIFICATE.url && asset.sha256===CAR_CERTIFICATE.sha256;
      entries[id] = { id: id, source: 'builtin', name: id, w: size.w, d: size.d,
        h: id === 'car' ? 1620 : null, kind: BUILTIN_KINDS[id] || null,
        kindProvenance: BUILTIN_KINDS[id] ? 'exact-id-app-constants' : 'unknown',
        front: certifiedCar ? CAR_CERTIFICATE.front : null, frontProvenance: certifiedCar ? 'hash-pinned-active-glb-and-corrected-fallback' : 'unknown', semanticExtent: 'asset', finishChannels: finishModel ? (finishModel.finishChannels||[]).map(function(c){return {key:c.key,default:c.default};}) : [], genericColor: true };
    });
    Object.keys(input.items || {}).forEach(function (id) {
      var item = input.items[id];
      if (!cleanId(id) || !item || !Number.isFinite(item.w) || !Number.isFinite(item.d)) return;
      // Openings must use the opening compiler, never free-standing furniture placement.
      var opening = item.category === '窓' || item.category === 'ドア' || item.group === '建具';
      var extent = id==='fmp-CabinetA_Sink' || own(VERIFIED_FIXTURES, id) || /^(original-bathtub|fmp-BathTub\d+)$/.test(id) ? 'individual-fixture' : 'asset';
      entries[id] = { id: id, source: 'catalogue', name: item.name || id,
        w: item.w, d: item.d, h: Number.isFinite(item.h) ? item.h : null,
        kind: item.kind || SOURCE_OBJECT_TYPES[id] || null, head: AXES.indexOf(item.head)>=0 ? item.head : undefined, headProvenance: AXES.indexOf(item.head)>=0 ? 'manifest' : 'unknown', front: item.front || VERIFIED_FRONTS[id] || null,
        frontProvenance: item.front ? 'manifest' : VERIFIED_FRONTS[id] ? 'verified-top-preview-and-runtime-normalization' : 'unknown', semanticExtent: extent,
        openingOnly: opening, category: item.category || null,
        finishChannels: (item.finishChannels || []).map(function (c) { return { key: c.key, label:c.label||c.key, default: c.default }; }),
        genericColor: false, defaultElevation: item.defaultElevation || 0 };
      if (own(SOURCE_OBJECT_TYPES,id)) {
        entries[id].sourceObjectType=SOURCE_OBJECT_TYPES[id];
        entries[id].semanticExtentProvenance='exact-id-manifest-audit';
      }
      if (own(VERIFIED_FIXTURES, id)) {
        entries[id].sourceObjectType = VERIFIED_FIXTURES[id];
        entries[id].semanticExtentProvenance = 'exact-id-manifest-and-thumbnail-audit';
      }
    });
    function get(id) { return cleanId(id) && own(entries, id) ? entries[id] : null; }
    function describe(id) {
      var e = get(id); if (!e) return null;
      var item=(input.items||{})[id];
      var profile=Profiles&&Profiles.describe(Object.assign({id:id},item)),extra={appearanceProfiles:profile?[profile]:[]};
      if(profile&&profile.available){extra.kind='sofa';extra.sourceObjectType='sofa';extra.kindProvenance='exact-hash-native-asset-audit';}
      if(profile&&profile.frontAudit){extra.front=profile.frontAudit.axis;extra.frontProvenance=profile.frontAudit.basis;extra.frontAudit=profile.frontAudit;}
      var materialCapability=item&&MaterialAudit?MaterialAudit.describe(item,input.finishData):{status:'unreviewed',declaredChannels:e.finishChannels,verifiedChannels:[],fixedMaterials:[],sourceRegionSemanticsAudited:false,uniformPixelRGBGuaranteed:false,reason:'No exact asset/part audit is loaded for this renderer path'};
      return JSON.parse(JSON.stringify(Object.assign({}, e, extra, {
        materialCapability: materialCapability,
        defaultHeight: {valueMm:e.h,origin:e.source==='catalogue'?'catalogue-manifest':e.h===null?'unknown':'builtin-default',sourceMeasured:false,rendererRuleAudited:materialCapability.status==='asset-and-code-audited'},
        parameters: ['w', 'd', 'rot', 'flipX', 'flipY', 'elev', 'baseRoom', 'baseLevel'].concat(
          e.genericColor ? ['color', 'colorCustom'] : ['finishColors', 'finishTextures', 'finishRoughness']),
        textureIds: textures, roughnessValues: [0.85, 0.48, 0.22]
      })));
    }
    return { get: describe, list: function () { return Object.keys(entries).map(describe); },
      resolveAlias: function (id) { return own(aliases, id) ? aliases[id] : null; },
      textureIds: textures.slice() };
  }
  return { deriveFootprintFit: deriveFootprintFit, carCertificate: Object.freeze(CAR_CERTIFICATE), create: create, cleanId: cleanId, isColor: function (v) { return typeof v === 'string' && COLOR.test(v); } };
}));
