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
    'fmp-Refrigerator01':'refrigerator',
    'original-kitchen-i2400':'kitchen-unit', 'original-bathtub':'bathtub','fmp-Bed01':'bed','fmp-Chair07':'chair','original-washer-drum':'laundry'
  };
  var BUILTIN_KINDS = {'car':'car','bed-d':'bed','bed-s':'bed','semi_double_bed':'bed','desk':'desk','dining-table':'dining-table','low_table':'table'};
  var AXES = ['+Z','-Z','+X','-X'];
  var CAR_CERTIFICATE = {url:'assets/models/refined/precision_car_v1.glb',sha256:'eef8d9a9ba8130ee74d30daaa84ba50eec194685490bfc72490c09a6abe7e14b',front:'+Z'};
  // One two-compartment refrigerator, audited in the actual normalized native renderer.
  // This is asset compatibility evidence, never source-product identification.
  var REFRIGERATOR_CERTIFICATE = {id:'fmp-Refrigerator01',url:'assets/models/furniture_mega/glb/Refrigerator01.glb',sha256:'4131e315999a663a198be97a2c93881632942a67d91c29398c46e92fe57e43e0',w:706,d:749,h:1514,front:'+Z',sourceYaw:Math.PI};
  var CABINET_CERTIFICATE = {id:'im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown',url:'assets/models/interior_model_0_26_1/glb/Cabinet/MEGA_PACK_CABINET__cabinet-354290_frame_walnut_brown.glb',sha256:'157022a07b741000c0b3da87fbebcd29250c6af1701716a353e482720159baf5',w:2000,d:414,h:600,front:'+Z',sourceYaw:0};
  var SIDEBOARD_CERTIFICATE = {id:'original-sideboard',url:'assets/models/original/original-sideboard.glb',sha256:'be6a4bd2bbc6de3d678bf5a1504fa58721f6b49cd14213dde49f72c356d0f05c',w:1400,d:420,h:760,front:'+Z',sourceYaw:0};
  var SINK_CERTIFICATE = {id:'fmp-Sink03',url:'assets/models/furniture_mega/glb/Sink03.glb',sha256:'79f32c38911bad527f21935f4b220ba5dcc5430f4c9b3dfd63a8747f2c9792d7',w:561,d:394,h:837,front:'+Z',sourceYaw:Math.PI};
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
  function supportsSemanticExtent(model, extent) {
    return !!model && (model.semanticExtent === extent || Array.isArray(model.compatibleSemanticExtents) && model.compatibleSemanticExtents.indexOf(extent) >= 0);
  }
  function supportsSourceObjectType(model, type) {
    return !!model && ((model.sourceObjectType || model.kind) === type || Array.isArray(model.compatibleSourceObjectTypes) && model.compatibleSourceObjectTypes.indexOf(type) >= 0);
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
      var extent = own(VERIFIED_FIXTURES, id) || /^(original-bathtub|fmp-BathTub\d+)$/.test(id) ? 'individual-fixture' : 'asset';
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
      var rc=REFRIGERATOR_CERTIFICATE;
      if(id===rc.id&&item.model===rc.url&&item.w===rc.w&&item.d===rc.d&&item.h===rc.h&&(item.front===undefined||item.front===rc.front)){
        entries[id].front=rc.front; entries[id].frontProvenance='hash-pinned-native-normalized-front-audit';
        entries[id].frontAudit={axis:rc.front,assetSha256:rc.sha256,url:rc.url,sourceYaw:rc.sourceYaw};
        entries[id].compatibleSemanticExtents=['asset','individual-fixture']; entries[id].semanticExtentProvenance='exact-asset-native-unit-audit';
      }
      // Exact already-audited cabinet unit: bridge schema vocabulary, not names.
      var cc=id===SIDEBOARD_CERTIFICATE.id?SIDEBOARD_CERTIFICATE:CABINET_CERTIFICATE;
      if(id===cc.id&&item.model===cc.url&&item.w===cc.w&&item.d===cc.d&&item.h===cc.h&&(item.front===undefined||item.front===cc.front)){
        entries[id].compatibleSourceObjectTypes=['cabinet-like'];
        entries[id].sourceTypeAudit={assetSha256:cc.sha256,url:cc.url,sourceYaw:cc.sourceYaw,basis:'exact-asset-native-unit-audit'};
      }
      // A single basin/faucet/drain, audited front opposite the rear faucet.
      var sc=SINK_CERTIFICATE;
      if(id===sc.id&&item.model===sc.url&&item.w===sc.w&&item.d===sc.d&&item.h===sc.h&&(item.front===undefined||item.front===sc.front)){
        entries[id].front=sc.front;entries[id].frontProvenance='hash-pinned-native-normalized-front-audit';
        entries[id].frontAudit={axis:sc.front,assetSha256:sc.sha256,url:sc.url,sourceYaw:sc.sourceYaw};
        entries[id].sourceObjectType='kitchen-sink';entries[id].kind='kitchen-sink';
        entries[id].compatibleSemanticExtents=['asset','individual-fixture'];
        entries[id].semanticExtentProvenance='exact-asset-native-unit-audit';
      }
      // The existing A_Sink asset is a cabinet with a cutout, not a sink basin.
      if(id==='fmp-CabinetA_Sink'){entries[id].sourceObjectType='cabinet';entries[id].semanticExtentProvenance='native-unit-audit-corrects-category-tag';entries[id].representationLimit='Cabinet with a top cutout; no independently represented sink basin or faucet. Not an individual kitchen-sink fixture.';}
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
  return { supportsSourceObjectType: supportsSourceObjectType, cabinetCertificate: Object.freeze(CABINET_CERTIFICATE), sideboardCertificate: Object.freeze(SIDEBOARD_CERTIFICATE), sinkCertificate: Object.freeze(SINK_CERTIFICATE), supportsSemanticExtent: supportsSemanticExtent, deriveFootprintFit: deriveFootprintFit, carCertificate: Object.freeze(CAR_CERTIFICATE), refrigeratorCertificate: Object.freeze(REFRIGERATOR_CERTIFICATE), create: create, cleanId: cleanId, isColor: function (v) { return typeof v === 'string' && COLOR.test(v); } };
}));
