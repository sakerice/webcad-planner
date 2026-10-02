/* Scene IR v2 -> editor DATA; v3 -> source-only preview. Never reads or writes live DATA.
 * Every source-bearing value is {value,status:'observed'|'inferred'|'unknown',source?,reason?}.
 * Inferences/defaults remain reviewable. Editor/saved-file and legacy import schemas are unchanged.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scene-catalogue.js'), require('./scene-opening-geometry.js'), require('./scene-ir-v3.js'));
  else root.SceneIR = factory(root.SceneCatalogue, root.SceneOpeningGeometry, root.SceneIRV3);
}(typeof self !== 'undefined' ? self : this, function (Catalogue, Openings, V3) {
  'use strict';
  var EPS = 0.001, LIMIT = 1000000;
  var FACT_KEYS = ['value', 'status', 'source', 'reason'];
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT; }
  function positive(v) { return num(v) && v > 0; }
  function point(v) { return obj(v) && num(v.x) && num(v.y) && Object.keys(v).every(function (k) { return k === 'x' || k === 'y'; }); }
  function rect(v) { return obj(v) && num(v.x) && num(v.y) && positive(v.w) && positive(v.d) && Object.keys(v).every(function (k) { return ['x','y','w','d'].indexOf(k) >= 0; }); }
  function size(v) { return obj(v) && positive(v.w) && positive(v.d) && Object.keys(v).every(function (k) { return k === 'w' || k === 'd'; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function roomUse(v) {
    var s = String(v || '').normalize('NFKC').toLowerCase().replace(/[\s()（）\d]/g, '');
    return ({'玄関':'entrance','玄関土間':'entrance','entry':'entrance','entrance':'entrance','浴室':'bathroom','バス':'bathroom','bath':'bathroom','bathroom':'bathroom','洗面':'washroom','洗面所':'washroom','脱衣室':'washroom','washroom':'washroom','トイレ':'toilet','wc':'toilet','toilet':'toilet','廊下':'hall','ホール':'hall','hall':'hall'})[s] || s;
  }
  function footprint(item) {
    var a = (item.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var cx = item.x + item.w / 2, cy = item.y + item.d / 2;
    return [[-1,-1],[1,-1],[1,1],[-1,1]].map(function (p) {
      var x = p[0] * item.w / 2, y = p[1] * item.d / 2;
      return { x: cx + x*c-y*s, y: cy+x*s+y*c };
    });
  }
  function contains(r, p) { return p.x >= r.x-EPS && p.y >= r.y-EPS && p.x <= r.x+r.w+EPS && p.y <= r.y+r.d+EPS; }
  function boundaryContains(r, p, width, wall) {
    if (!contains(r,p)) return false;
    var dx=wall.x2-wall.x1,dy=wall.y2-wall.y1,len=Math.hypot(dx,dy);
    var a={x:p.x-dx/len*width/2,y:p.y-dy/len*width/2},b={x:p.x+dx/len*width/2,y:p.y+dy/len*width/2};
    var on = function (q) { return contains(r,q) && (Math.abs(q.x-r.x)<EPS || Math.abs(q.x-r.x-r.w)<EPS || Math.abs(q.y-r.y)<EPS || Math.abs(q.y-r.y-r.d)<EPS); };
    return on(a)&&on(b)&&on(p);
  }
  function compile(scene, options) {
    if (scene && scene.sceneVersion === 3) return V3.compile(scene, options);
    options = options || {};
    var registry = options.registry;
    var out = { version: 2, plan: {walls:[],rooms:[],items:[]}, diagnostics: [], evidence: [], defaults: [], suggestions: [], unresolved: [], reviewGroups: [], unresolvedEntities: [], acknowledgedOmissions: [], reconstructionStatus: 'invalid', canApply: false };
    var accepted = options.acceptedReviews || [], walls = Object.create(null), rooms = Object.create(null), ids = Object.create(null), roomDatums = Object.create(null);
    function issue(code, path, message, severity) {
      var d = { code: code, path: path, message: message, severity: severity || 'error' };
      out.diagnostics.push(d); if (d.severity === 'review') out.unresolved.push(d); return d;
    }
    function checkKeys(value, keys, path) {
      if (!obj(value)) { issue('invalid_object', path, 'Expected an object'); return false; }
      var valid = true;
      Object.keys(value).forEach(function (k) { if (keys.indexOf(k) < 0) { issue('unsupported_field', path+'.'+k, 'Unsupported field; not copied to editor DATA'); valid=false; } });
      return valid;
    }
    function fact(entity, key, path, validator, required) {
      var f = entity[key], p = path+'.'+key;
      if (f === undefined) { if (required) issue('missing_fact',p,'Required source value is missing'); return undefined; }
      if (!checkKeys(f,FACT_KEYS,p)) return undefined;
      if (['observed','inferred','unknown'].indexOf(f.status)<0) { issue('invalid_evidence',p,'Evidence status must be observed, inferred, or unknown'); return undefined; }
      if (f.status==='unknown') {
        if (f.value !== null) issue('unknown_has_value',p,'An unknown value must be null');
        out.evidence.push({path:p,status:'unknown',value:null});
        issue('unknown_value',p,required?'Required source value is unresolved; no exact value is invented':'Source does not establish this value; an editor default may be used',required?'error':'warning'); return undefined;
      }
      if (typeof f.source!=='string'||!f.source.trim()) { issue('missing_source',p,'Observed/inferred values require a source reference'); return undefined; }
      if (f.status==='inferred'&&(typeof f.reason!=='string'||!f.reason.trim())) { issue('missing_inference_reason',p,'An inferred value requires a reason'); return undefined; }
      if (!validator(f.value)) { issue('invalid_value',p,'Value is invalid or unsupported'); return undefined; }
      out.evidence.push({path:p,status:f.status,source:f.source,reason:f.reason||null,value:clone(f.value)});
      if (f.status==='inferred') issue('inference_review',p,f.reason,'review');
      return clone(f.value);
    }
    function defaultReview(path, value, reason) { out.defaults.push({path:path,value:value,provenance:'editor-default',reason:reason}); issue('default_value',path,reason,'warning'); }
    function entityId(e,path) { if (!Catalogue.cleanId(e&&e.id)||ids[e.id]) { issue('invalid_id',path+'.id','IDs must be safe and unique across the scene'); return false; } ids[e.id]=true; return true; }
    function floor(e,path) { return fact(e,'floor',path,function(v){return Number.isInteger(v)&&v>=1&&v<=5;},true); }
    function optional(e,key,path,validate,dest,field) { var v=fact(e,key,path,validate,false); if(v!==undefined)dest[field||key]=v; return v; }
    function errorsSince(n) { return out.diagnostics.slice(n).some(function(d){return d.severity==='error';}); }
    if (!checkKeys(scene,['sceneVersion','units','coordinateSystem','walls','rooms','openings','furniture','connections'], 'scene')) return out;
    if(scene.sceneVersion!==2||scene.units!=='mm'||scene.coordinateSystem!=='x-east-y-south-clockwise') { issue('unsupported_version','scene','Expected Scene IR 2, mm, x-east-y-south-clockwise'); return out; }
    if (!registry || typeof registry.get!=='function') { issue('missing_registry','scene','Actual editor catalogue is required'); return out; }
    ['walls','rooms','openings','furniture','connections'].forEach(function(k){if(!Array.isArray(scene[k]))issue('invalid_array','scene.'+k,'Expected an array');else if(scene[k].length>2000)issue('too_many_entities','scene.'+k,'Entity limit exceeded');});
    if(out.diagnostics.length)return out;
    scene.walls.forEach(function(e,i){
      var p='walls['+i+']',n=out.diagnostics.length;
      checkKeys(e,['id','floor','start','end','thicknessMm'],p); if(!entityId(e,p))return;
      var f=floor(e,p),a=fact(e,'start',p,point,true),b=fact(e,'end',p,point,true),t=fact(e,'thicknessMm',p,function(v){return positive(v)&&v<=1000;},true);
      if(a&&b&&(Math.hypot(a.x-b.x,a.y-b.y)<1 || (Math.abs(a.x-b.x)>EPS&&Math.abs(a.y-b.y)>EPS)))issue('unsupported_wall',p,'This compiler currently requires nonzero axis-aligned walls');
      if(errorsSince(n))return;
      var w={id:e.id,floor:f,x1:a.x,y1:a.y,x2:b.x,y2:b.y,thick:t}; walls[e.id]=w;out.plan.walls.push(w);
    });
    function validateFinishOffset(r,offset,p) {
      var hd=(options.targetPlan&&options.targetPlan.heightDefaults)||{},per=(options.targetPlan&&options.targetPlan.floors)||{};
      var thickness=hd.perFloor&&per[r.floor]&&per[r.floor].floorThickness!==undefined?per[r.floor].floorThickness:hd.floorThickness;
      thickness=num(thickness)?Math.max(20,Math.min(1000,thickness)):180;
      if(offset<0&&hd.modelVersion!==2)issue('height_model_incompatible',p+'.floorRaiseMm','Signed finish offset requires an already-v2 target plan; existing plans are never migrated by import');
      if(offset>600||offset<-(thickness-20))issue('floor_offset_out_of_range',p+'.floorRaiseMm','Finish offset would be clamped by renderer');
    }
    scene.rooms.forEach(function(e,i){
      var p='rooms['+i+']',n=out.diagnostics.length;
      checkKeys(e,['id','floor','bounds','name','use','floorRaiseMm','floorDatum','skipLevelMm','floorMaterial','floorColor'],p);if(!entityId(e,p))return;
      var f=floor(e,p),b=fact(e,'bounds',p,rect,true),r=Object.assign({id:e.id,type:'room',floor:f},b||{});
      optional(e,'name',p,function(v){return typeof v==='string'&&v.length<=120;},r,'n');
      var use=fact(e,'use',p,function(v){return typeof v==='string'&&v.length<=80;},false);
      var offset=optional(e,'floorRaiseMm',p,num,r),skip=optional(e,'skipLevelMm',p,function(v){return num(v)&&v>=0&&v<=2400&&Number.isInteger(v);},r);
      var datum=fact(e,'floorDatum',p,function(v){return v==='target-model-finish'||(obj(v)&&Object.keys(v).length===1&&Catalogue.cleanId(v.relativeToRoomId));},offset!==undefined);
      if(offset!==undefined){
        if(datum==='target-model-finish') validateFinishOffset(r,offset,p);
        else if(obj(datum))roomDatums[e.id]={reference:datum.relativeToRoomId,delta:offset,path:p};
        else issue('unsupported_floor_datum',p+'.floorDatum','A numeric offset requires an explicit datum');
      }else defaultReview(p+'.floorRaiseMm',null,'Unspecified finish offset uses the target editor default; it is not a measured entrance drop');
      optional(e,'floorMaterial',p,function(v){return ['tile_floor','wood_floor','wood_oak'].indexOf(v)>=0;},r);
      optional(e,'floorColor',p,Catalogue.isColor,r);
      var normalized=roomUse(use===undefined?r.n:use);
      if(!r.floorMaterial&&['entrance','bathroom','washroom','toilet'].indexOf(normalized)>=0)out.suggestions.push({path:p+'.floorMaterial',value:'tile_floor',provenance:'semantic-suggestion',reason:'Normalized room use '+normalized+'; material is not observed and is not applied'});
      if(skip&&offset!==undefined)out.evidence.push({path:p, status:'derived', reason:'Structural skipLevelMm and finish floorRaiseMm remain separate; finish offset does not move the ceiling'});
      if(errorsSince(n))return;rooms[e.id]=r;out.plan.rooms.push(r);
    });
    // First-floor rooms share the actual floorTopY datum; matching structural levels
    // let the observed relative difference map exactly without changing global heights.
    // Upper-floor support heights can vary locally, so they remain unresolved here.
    var resolving=Object.create(null),resolved=Object.create(null);
    function resolveRoomDatum(id) {
      if(resolved[id])return true;
      var d=roomDatums[id],r=rooms[id];
      if(!d){
        if(r&&num(r.floorRaiseMm))return true;
        if(r&&r.floor===1&&typeof options.defaultFloorOffset==='function'){
          var inherited=options.defaultFloorOffset(r.floor);
          if(num(inherited)){
            var rp='rooms['+scene.rooms.findIndex(function(e){return e.id===id;})+'].floorRaiseMm';
            r.floorRaiseMm=inherited;validateFinishOffset(r,inherited,rp.slice(0,rp.lastIndexOf('.')));
            out.defaults.push({path:rp,value:inherited,provenance:'editor-reference-datum',reason:'Chosen editor reference for an observed relative delta; not a measured absolute foundation datum'});
            issue('reference_datum_review',rp,'Relative floor delta uses the current editor reference-room default; review this absolute datum assumption','review');
            resolved[id]=true;return true;
          }
        }
        return false;
      }
      if(!r||resolving[id]){issue('relative_datum_cycle',d.path+'.floorDatum','Relative floor references must be acyclic and present');return false;}
      resolving[id]=true;
      var ref=rooms[d.reference];
      if(!ref||r.floor!==1||ref.floor!==1||(r.skipLevelMm||0)!==(ref.skipLevelMm||0)||!resolveRoomDatum(d.reference)){
        issue('unresolved_relative_datum',d.path+'.floorDatum','Relative offset requires a verified first-floor reference finish offset at the same structural level');
        delete r.floorRaiseMm;delete resolving[id];return false;
      }
      r.floorRaiseMm=ref.floorRaiseMm+d.delta;
      validateFinishOffset(r,r.floorRaiseMm,d.path);
      out.evidence.push({path:d.path+'.compiledFloorRaiseMm',status:'derived',value:r.floorRaiseMm,
        referenceRoomId:d.reference,observedDeltaMm:d.delta,referenceFinishOffsetMm:ref.floorRaiseMm,
        reason:'Same first-floor datum and structural level; source relative delta is retained separately'});
      resolved[id]=true;delete resolving[id];return true;
    }
    Object.keys(roomDatums).forEach(resolveRoomDatum);
    var specs=[];
    scene.openings.forEach(function(e,i){
      var p='openings['+i+']',n=out.diagnostics.length;
      var keys=['id','floor','hostWallId','adjacentRoomIds','center','widthMm','depthMm','kind','axis','rotationDeg','hinge','latch','swingSide','travelDirection','travel','wallFace','heightMm','sillMm','openState','windowKind','openingModel','doorFinish','color'];
      checkKeys(e,keys,p);if(!entityId(e,p))return;
      var s={id:e.id,floor:floor(e,p),_path:p,_properties:{}};
      ['hostWallId','kind'].forEach(function(k){s[k]=fact(e,k,p,Catalogue.cleanId,true);});
      s.center=fact(e,'center',p,point,true);s.widthMm=fact(e,'widthMm',p,positive,true);
      s.adjacentRoomIds=fact(e,'adjacentRoomIds',p,function(v){return Array.isArray(v)&&v.length===2&&v.every(function(x){return x===null||Catalogue.cleanId(x);})&&v[0]!==v[1];},true);
      ['axis','hinge','latch','swingSide','travelDirection','travel'].forEach(function(k){optional(e,k,p,point,s);});
      optional(e,'wallFace',p,function(v){return v==='center'||point(v);},s);
      optional(e,'depthMm',p,positive,s);optional(e,'rotationDeg',p,num,s);
      optional(e,'heightMm',p,function(v){return positive(v)&&v>=(s.kind&&s.kind.indexOf('window')===0?200:300)&&v<=3200;},s._properties,s.kind&&s.kind.indexOf('window')===0?'windowHeight':'doorHeight');
      optional(e,'sillMm',p,function(v){return num(v)&&v>=0&&v<=4000;},s._properties,'windowSill');
      optional(e,'openState',p,function(v){return v==='open'||v==='closed';},s._properties,'doorOpenState');
      optional(e,'windowKind',p,function(v){return ['fix','sliding','casement'].indexOf(v)>=0;},s._properties);
      optional(e,'color',p,Catalogue.isColor,s._properties);
      var model=optional(e,'openingModel',p,Catalogue.cleanId,s._properties);
      if(model)issue('unsupported_model_opening_geometry',p+'.openingModel','Registered model leaf thickness/motion is not yet validated by strict geometry; procedural doors are supported');
      if(model&&(!registry.get(model)||!registry.get(model).openingOnly))issue('unknown_opening_model',p+'.openingModel','Opening model is not registered as an opening');
      var finish=optional(e,'doorFinish',p,function(v){return v===''||v==='bath-clear';},s._properties);
      if(finish==='bath-clear'&&['door-swing','door-swing-s'].indexOf(s.kind)<0)issue('unsupported_door_finish',p+'.doorFinish','Transparent bathroom finish is only mapped for an interior swing door');
      if(model&&['door-swing','door-swing-s'].indexOf(s.kind)<0)issue('incompatible_opening_model',p+'.openingModel','Selected opening model cannot be rendered for this door kind');
      if(model&&registry.get(model)&&registry.get(model).category!=='ドア')issue('incompatible_opening_model',p+'.openingModel','An interior swing door requires a door model');
      if(s._properties.windowSill!==undefined&&s.kind&&s.kind.indexOf('window')!==0)issue('unsupported_door_sill',p+'.sillMm','Door sill is determined by the room floor, not windowSill');
      if(s._properties.windowKind!==undefined&&s.kind&&s.kind.indexOf('window')!==0)issue('window_field_on_door',p+'.windowKind','Window kind does not apply to a door');
      var w=walls[s.hostWallId];if(!w)issue('unknown_host_wall',p+'.hostWallId','Explicit host wall does not exist');
      if(w&&s.adjacentRoomIds&&s.center&&s.widthMm)s.adjacentRoomIds.forEach(function(id){if(id===null)return;var r=rooms[id];if(!r||r.floor!==s.floor||!boundaryContains(r,s.center,s.widthMm,w))issue('wrong_adjacent_room',p+'.adjacentRoomIds','Opening must lie completely on each declared adjacent room boundary');});
      if(s._properties.doorHeight===undefined&&s._properties.windowHeight===undefined)defaultReview(p+'.heightMm',null,'Opening height is unobserved; identified renderer default is used');
      if(s.kind&&s.kind.indexOf('window')===0&&e.sillMm===undefined)defaultReview(p+'.sillMm',null,'Window sill is unobserved; identified renderer default is used');
      if(errorsSince(n))return;specs.push(s);
    });
    specs.forEach(function(s){
      var result=Openings.compileOpening(s,out.plan.walls,specs);
      (result.diagnostics||[]).forEach(function(d){issue(d.code,s._path,d.message,d.severity);});
      if(result.ok&&result.item&&s.kind.indexOf('window')===0){
        if(typeof options.normalizeWindow!=='function'||typeof options.windowVerticalLimitMm!=='function')issue('missing_window_runtime',s._path,'Window parameters require the actual runtime vertical normalizer');
        else {
          var raw=Object.assign({type:s.kind,floor:s.floor,windowSill:s.kind==='window-door'?0:900,windowHeight:s.kind==='window-door'?2100:1200},s._properties);
          var available=options.windowVerticalLimitMm(s.floor,s.adjacentRoomIds.filter(function(id){return id!==null;}).map(function(id){return rooms[id];}));
          if(raw.windowSill+raw.windowHeight>available+EPS)issue('window_context_height_conflict',s._path,'Window frame would exceed the conservative host aperture clearance after room finish/structural offsets');
          var normalized=options.normalizeWindow(clone(raw));
          ['windowSill','windowHeight'].forEach(function(k){if(!normalized||Math.abs(normalized[k]-raw[k])>EPS)issue('window_vertical_clamp',s._path+'.'+k,'Window values/defaults would be silently clamped by the actual renderer');});
        }
        issue('window_sash_not_validated',s._path,'Window host/span and vertical parameters validated; moving sash trajectory is not modeled','warning');
      }
      if(result.ok&&result.item){var it=Object.assign({},result.item,s._properties,{id:s.id,modelFacingVersion:1,sceneImportVersion:2});if(s._properties.color)it.colorCustom=true;out.plan.items.push(it);s._compiled=it;}
    });
    scene.furniture.forEach(function(e,i){
      var p='furniture['+i+']',n=out.diagnostics.length;
      checkKeys(e,['id','floor','catalogId','center','sizeMm','sizePolicy','rotationDeg','flipX','flipY','hostRoomId','semanticExtent','elev','baseRoom','baseLevel','finishColors','finishTextures','finishRoughness','color','heightMm','facingDirection'],p);if(!entityId(e,p))return;
      var f=floor(e,p),id=fact(e,'catalogId',p,Catalogue.cleanId,true),m=registry.get(id),c=fact(e,'center',p,point,true),sz=fact(e,'sizeMm',p,size,true),rot=fact(e,'rotationDeg',p,num,true);
      var sizePolicy=fact(e,'sizePolicy',p,function(v){return v==='native'||v==='fit-observed';},false);
      if(m&&sz&&(Math.abs(m.w-sz.w)>EPS||Math.abs(m.d-sz.d)>EPS)){
        if(sizePolicy!=='fit-observed')issue('unreviewed_asset_scaling',p+'.sizePolicy','Asset dimensions differ from native catalogue dimensions; explicit fit-observed policy is required');
        else issue('asset_scaling_review',p+'.sizePolicy','Measured footprint requires non-native asset scaling; review that this is the intended product representation','review');
      }
      if(id!==undefined&&!m)issue('unknown_catalogue_id',p+'.catalogId',registry.resolveAlias(id)?'Legacy alias would silently substitute '+registry.resolveAlias(id)+'; select an exact catalogue ID':'Exact catalogue ID is not registered');
      if(m&&m.openingOnly)issue('opening_as_furniture',p+'.catalogId','Use the hosted opening compiler');
      var host=fact(e,'hostRoomId',p,function(v){return v===null||Catalogue.cleanId(v);},true),extent=fact(e,'semanticExtent',p,function(v){return ['asset','individual-fixture','room-assembly','symbol-only'].indexOf(v)>=0;},true);
      if(m&&extent&&extent!==m.semanticExtent)issue('asset_semantic_extent',p+'.semanticExtent','Source symbol extent does not match the selected asset ('+m.semanticExtent+')');
      var it=Object.assign({id:e.id,type:id,floor:f,rot:rot,modelFacingVersion:1,sceneImportVersion:2},sz?{w:sz.w,d:sz.d}:{});
      if(c&&sz){it.x=c.x-sz.w/2;it.y=c.y-sz.d/2;}
      ['flipX','flipY'].forEach(function(k){optional(e,k,p,function(v){return typeof v==='boolean';},it);});
      optional(e,'elev',p,function(v){return num(v)&&v>=-1000&&v<=10000;},it);
      optional(e,'baseRoom',p,Catalogue.cleanId,it);optional(e,'baseLevel',p,function(v){return ['floor','under','skip'].indexOf(v)>=0;},it);
      if(it.baseRoom&&it.baseLevel)issue('conflicting_base',p,'Specify baseRoom or baseLevel, not both');
      if(it.baseRoom&&(!rooms[it.baseRoom]||rooms[it.baseRoom].floor!==f))issue('invalid_base_room',p+'.baseRoom','Base room must exist on the same floor');
      if(host!==undefined&&host!==null){var r=rooms[host];if(!r||r.floor!==f)issue('unknown_host_room',p+'.hostRoomId','Host room does not exist on this floor');else if(c&&sz&&rot!==undefined&&!footprint(it).every(function(pt){return contains(r,pt);}))issue('asset_outside_room',p,'Full rotated asset footprint must fit inside its host room; center containment is insufficient');}
      else if(m&&m.kind!=='car')issue('uncontained_asset',p+'.hostRoomId','Interior asset needs an explicit host room; null is supported only for exterior cars');
      if(e.heightMm!==undefined){var h=fact(e,'heightMm',p,positive,false);if(h!==undefined&&(!m||m.h===null||Math.abs(h-m.h)>EPS))issue('unsupported_asset_height',p+'.heightMm','Asset height is fixed by renderer/manifest; arbitrary item.h is unsupported');}
      var facing=fact(e,'facingDirection',p,point,false);
      if(facing!==undefined){
        var axes={'+Z':{x:0,y:1},'-Z':{x:0,y:-1},'+X':{x:1,y:0},'-X':{x:-1,y:0}},front=m&&axes[m.front];
        if(!front)issue('unverified_front_axis',p+'.facingDirection','World-facing conversion needs separately verified model-axis metadata');
        else if(rot!==undefined){
          var fx=front.x*(it.flipX?-1:1),fy=front.y*(it.flipY?-1:1),angle=rot*Math.PI/180;
          var actual={x:fx*Math.cos(angle)-fy*Math.sin(angle),y:fx*Math.sin(angle)+fy*Math.cos(angle)},length=Math.hypot(facing.x,facing.y);
          if(length<EPS||Math.hypot(actual.x-facing.x/length,actual.y-facing.y/length)>EPS)issue('asset_facing_conflict',p+'.facingDirection','Observed facing conflicts with the verified asset axis, rotation and mirrors');
          else out.evidence.push({path:p+'.compiledFacingDirection',status:'derived',value:actual,modelFront:m.front,frontProvenance:m.frontProvenance});
        }
      }
      var color=fact(e,'color',p,Catalogue.isColor,false);if(color!==undefined){if(!m||!m.genericColor)issue('unsupported_generic_color',p+'.color','Catalogue assets use actual finishColors channels, not generic color');else{it.color=color;it.colorCustom=true;}}
      ['finishColors','finishTextures','finishRoughness'].forEach(function(k){
        var value=fact(e,k,p,obj,false);if(value===undefined)return;
        var allowed=m?(m.finishChannels||[]).map(function(ch){return ch.key;}):[];
        Object.keys(value).forEach(function(ch){
          if(allowed.indexOf(ch)<0)issue('unknown_finish_channel',p+'.'+k+'.'+ch,'Finish channel is not supported by this asset');
          if(k==='finishColors'&&!Catalogue.isColor(value[ch]))issue('invalid_finish_color',p+'.'+k+'.'+ch,'Expected #rrggbb');
          if(k==='finishTextures'&&registry.textureIds.indexOf(value[ch])<0)issue('unsafe_finish_texture',p+'.'+k+'.'+ch,'Only registered texture IDs are accepted; URLs are not allowed');
          if(k==='finishRoughness'&&(['fabric','accent'].indexOf(ch)>=0||[.85,.48,.22].indexOf(value[ch])<0))issue('invalid_finish_roughness',p+'.'+k+'.'+ch,'Unsupported material roughness preset');
        });it[k]=value;
      });
      if(m){
        if(e.heightMm===undefined)out.defaults.push({path:p+'.heightMm',value:m.h,provenance:'catalogue-dimension',reason:'Fixed asset height, not measured from the source'});
        ['flipX','flipY'].forEach(function(k){if(it[k]===undefined)out.defaults.push({path:p+'.'+k,value:false,provenance:'editor-default'});});
        if(it.elev===undefined)out.defaults.push({path:p+'.elev',value:m.defaultElevation||0,provenance:'editor-default'});
        if(color===undefined&&!it.finishColors)out.defaults.push({path:p+'.appearance',value:null,provenance:'catalogue-material',reason:'Native asset appearance is not source-observed'});
      }
      if(errorsSince(n))return;out.plan.items.push(it);
    });
    scene.connections.forEach(function(e,i){
      var p='connections['+i+']';checkKeys(e,['id','rooms','openingId','requiredTraversable'],p);if(!entityId(e,p))return;
      var pair=fact(e,'rooms',p,function(v){return Array.isArray(v)&&v.length===2&&v.every(Catalogue.cleanId)&&v[0]!==v[1];},true);
      var openingId=fact(e,'openingId',p,Catalogue.cleanId,true),required=fact(e,'requiredTraversable',p,function(v){return typeof v==='boolean';},true);
      if(pair&&pair.some(function(id){return !rooms[id];}))issue('unknown_connection_room',p,'Connected rooms must exist');
      if(required){var s=specs.filter(function(x){return x.id===openingId;})[0];if(!s||!s._compiled||s.kind.indexOf('door-')!==0||!pair||!pair.every(function(id){return s.adjacentRoomIds.indexOf(id)>=0;}))issue('missing_traversable_connection',p,'Required connection needs a valid hosted door/opening. Stairs and furniture do not cut walls');}
    });
    // Review is grouped by object/decision, without erasing the underlying facts.
    // A model cannot authorize its own omissions: decisions are supplied separately
    // by the reviewing user, never read from the extraction object.
    out.reviewGroups=[];out.unresolvedEntities=[];
    var acceptedGroups=options.acceptedReviewGroups||[],decisions=options.unresolvedDecisions||[];
    var omittedCodes=['unknown_value','unknown_catalogue_id','unverified_front_axis'];
    ['walls','rooms','openings','furniture','connections'].forEach(function(collection){
      scene[collection].forEach(function(entity,i){
        if(!obj(entity))return;
        var path=collection+'['+i+']',groupId=collection+':'+entity.id;
        var diagnostics=out.diagnostics.filter(function(d){return d.path===path||d.path.indexOf(path+'.')===0;});
        if(!diagnostics.length)return;
        var errors=diagnostics.filter(function(d){return d.severity==='error';});
        var knownType=entity.catalogId&&entity.catalogId.value;
        // Known circulation/structural records are never optional decoration.
        // Unknown roles are not inferred: an eligible item still needs the user's
        // affirmative noncritical-decoration classification below.
        var critical=collection!=='furniture'||/stair|ramp|階段|スロープ|door|wall|opening|foundation|roof/i.test(String(entity.id)+' '+String(knownType||''));
        var eligible=!critical&&errors.length>0&&errors.every(function(d){return omittedCodes.indexOf(d.code)>=0;});
        var decision=decisions.filter(function(d){return d&&d.entityId===entity.id&&d.decision==='leave-unplaced'&&d.classification==='noncritical-decoration';})[0];
        var omitted=!!(eligible&&decision);
        if(omitted)diagnostics.forEach(function(d){d.acknowledgedOmission=true;});
        var group={id:groupId,entityId:entity.id,collection:collection,path:path,
          label:entity.name&&entity.name.value||entity.id,diagnostics:diagnostics,
          evidence:out.evidence.filter(function(e){return e.path===path||e.path.indexOf(path+'.')===0;}),
          reviewPaths:diagnostics.filter(function(d){return d.severity==='review';}).map(function(d){return d.path;}),
          canAcknowledgeOmission:eligible,acknowledgedOmission:omitted,accepted:acceptedGroups.indexOf(groupId)>=0};
        out.reviewGroups.push(group);
        if(errors.length)out.unresolvedEntities.push({id:entity.id,collection:collection,source:clone(entity),
          reasons:errors.map(function(d){return {code:d.code,path:d.path,message:d.message};}),
          acknowledgedOmission:omitted,decision:omitted?clone(decision):null});
      });
    });
    function groupAccepted(path){return out.reviewGroups.some(function(g){return g.accepted&&(path===g.path||path.indexOf(g.path+'.')===0);});}
    out.canApply=!out.diagnostics.some(function(d){return !d.acknowledgedOmission&&(d.severity==='error'||(d.severity==='review'&&accepted.indexOf(d.path)<0&&!groupAccepted(d.path)));});
    out.acknowledgedOmissions=out.unresolvedEntities.filter(function(e){return e.acknowledgedOmission;}).map(function(e){return e.id;});
    out.reconstructionStatus=out.acknowledgedOmissions.length?'incomplete-acknowledged-omissions':'draft';

    return out;
  }
  return {createPlacementContext:V3&&V3.createPlacementContext,sourceHash:V3&&V3.sourceHash,compile:compile,footprint:footprint,normalizeRoomUse:roomUse};
}));
