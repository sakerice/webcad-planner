/* Session-local capability API. No transport, credentials, persistence or Apply. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./scene-ir.js'),require('./scene-catalogue.js'),require('./scene-appearance-profiles.js'));
  else root.EditorInternalAPI=factory(root.SceneIR,root.SceneCatalogue,root.SceneAppearanceProfiles);
}(typeof self!=='undefined'?self:this,function(SceneIR,Catalogue,Profiles){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v)),hash=v=>SceneIR.sourceHash(v);
  function fail(code,message){const e=new Error(message);e.code=code;throw e;}
  function json(v,depth=0){
    if(depth>32)fail('invalid_request','JSON nesting exceeds limit');
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'&&Number.isFinite(v))return;
    if(typeof v!=='object'||!v||(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]'))fail('invalid_request','Only JSON values are accepted');
    if(!Array.isArray(v)){const proto=Object.getPrototypeOf(v);if(proto&&Object.getPrototypeOf(proto)!==null)fail('invalid_request','Custom JSON prototypes are not accepted');}
    for(const k of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(k)||Object.getOwnPropertyDescriptor(v,k).get)fail('invalid_request','Unsafe JSON property');json(v[k],depth+1);}
  }
  function keys(v,allowed){json(v);if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!allowed.includes(k)))fail('invalid_request','Unexpected request field');}
  function id(v){if(typeof v!=='string'||!SceneId(v))fail('invalid_request','Expected an explicit bounded ID');return v;}
  function SceneId(v){return /^[a-zA-Z0-9_-]{1,100}$/.test(v);}
  function catalogueId(v){if(!Catalogue||!Catalogue.cleanId(v))fail('invalid_request','Expected an exact bounded catalogue ID');return v;}
  const geometryKeys=['id','type','floor','x','y','x1','y1','x2','y2','w','d','h','rot','flipX','flipY','thick','wallHeight','n','shape','floorRaiseMm','skipLevelMm','floorMaterial','floorColor','floorModuleMm','floorDiagramPattern','sourceBoundaryBasis','elev','baseRoom','baseLevel','color','colorCustom','finishColors','finishTextures','finishRoughness','tailoredSofaColors','modelScale','heightMm','windowHeight','windowSill','windowKind','openingHostWallId','sourceExactGap'];
  const heightKeys=['modelVersion','floorThickness','floorRaise','floorRaiseSet','wallHeight','perFloor'];
  function pick(v,allowed){const out={};for(const k of allowed)if(v&&v[k]!==undefined)out[k]=clone(v[k]);return out;}
  function geometry(v){
    const out=pick(v,geometryKeys);
    if(out.tailoredSofaColors){const colors=Profiles.nativeColors(out);if(colors)out.tailoredSofaColors={version:1,colors};else delete out.tailoredSofaColors;}
    if(out.shape){const shape=out.shape;out.shape=pick(shape,['kind']);for(const k of ['outer','rectangles'])if(Array.isArray(shape[k]))out.shape[k]=shape[k].map(p=>pick(p,['x','y','w','d']));if(Array.isArray(shape.holes))out.shape.holes=shape.holes.map(loop=>loop.map(p=>pick(p,['x','y'])));}
    for(const k of ['finishColors','finishTextures','finishRoughness'])if(out[k])out[k]=Object.fromEntries(Object.entries(out[k]).filter(([key,value])=>SceneId(key)&&!/(token|secret|password|credential|authorization)/i.test(key)&&['string','number'].includes(typeof value)));
    return out;
  }
  // Project geometry/settings only; never export unknown metadata, extraction logs,
  // collaboration state, credentials, storage objects or arbitrary file handles.
  function publicSnapshot(plan){return {walls:(plan.walls||[]).map(geometry),rooms:(plan.rooms||[]).map(geometry),items:(plan.items||[]).map(geometry),heightDefaults:pick(plan.heightDefaults,heightKeys),floors:Object.fromEntries(Object.entries(plan.floors||{}).filter(([k])=>/^[1-5]$/.test(k)).map(([k,v])=>[k,pick(v,heightKeys)]))};}
  // Shared with PlanImport; all height/window consumers read this copy.
  function previewSceneIRSnapshot(source,snapshot,options){return SceneIR.previewSnapshot(source,snapshot,options);}
  function displayObject(entity,binding,plan,registry){
    if(!binding)return null;
    const catalogId=binding.catalogId&&binding.catalogId.value,model=catalogId&&registry.get(catalogId);
    if(!model)return null;
    const item=(plan.items||[]).find(it=>it.id===entity.id),audit=model.materialCapability||{};
    const height=Number.isFinite(model.h)&&model.h>0?model.h:null;
    return {catalogId,sourceHeight:entity.heightMm===undefined?null:clone(entity.heightMm),sourceFootprint:clone(entity.sourceFootprint),
      effectiveHeight:{valueMm:height,origin:height===null?'unknown':'catalogue-default',sourceMeasured:false,certainty:audit.status==='asset-and-code-audited'?'asset-and-renderer-rule-audited':'catalogue-declared-only',materialized:!!item,rendererBasis:height===null?'No verified fixed height':model.source==='catalogue'?'getItemHeightValue -> getItemH -> FMP manifest h':'Builtin catalogue declaration; runtime height is not audited',widthDepthFitChangesHeight:audit.status==='asset-and-code-audited'?false:null},
      shape:{asset:audit.asset||null,nativeDimensionsMm:{w:model.w,d:model.d,h:model.h},displayFootprintMm:item?{w:item.w,d:item.d}:null,equivalenceToSource:'unverified-catalogue-representation'},
      appearance:{mode:binding.appearanceMode||'unspecified',materialAuditStatus:audit.status||'unreviewed',appearanceProfile:binding.appearanceProfile?clone(binding.appearanceProfile):null,tailoredSofaColors:item&&item.tailoredSofaColors?clone(item.tailoredSofaColors):null,finishColors:item&&item.finishColors?clone(item.finishColors):null,color:item&&item.colorCustom?item.color:null}};
  }
  function displayWall(entity,proposal,plan,native){
    const wall=(plan.walls||[]).find(w=>w.id===entity.id);
    return {sourceEntityId:entity.id,sourceHeight:null,sourceMeasured:false,approvalState:'unreviewed',
      requestedHeight:proposal?clone(proposal):null,materializedWallHeightMm:wall&&wall.wallHeight!==undefined?wall.wallHeight:null,
      origin:proposal?'explicit-display-assumption':'editor-default',
      effectiveHeight:native?clone(native.effectiveHeight):{valueMm:null,basis:'awaiting-native-editor',sourceMeasured:false},
      bbox:native?clone(native.bbox):null,rendererContext:native?clone(native.rendererContext):null};
  }
  function create(capabilities){
    let busy=false,lastRendered=null;
    function catalog(){const registry=capabilities.catalogue(),entries=registry.list().sort((a,b)=>a.id.localeCompare(b.id));return {registry,entries,hash:hash(entries)};}
    function read(planId){
      id(planId);const c=catalog(),original=capabilities.readScene(planId);
      if(!original)fail('unknown_plan','No authorized scene with this plan ID');
      const s=clone(original);
      if(!s.source||s.source.sceneVersion!==3)fail('missing_source','Stage a v3 source in the existing review dialog first');
      const check=SceneIR.compile(s.source,{});
      if(!check.valid)fail('invalid_source','Staged source does not satisfy the current v3 schema');
      const revision=hash({planId,plan:s.snapshot,source:s.source,options:s.options||{},camera:s.camera,state:s.state,catalogue:c.hash});
      return {s,c,revision};
    }
    function sceneResult(planId,current){const {s,c,revision}=current;return {apiVersion:1,planId,revision,snapshot:publicSnapshot(s.snapshot),camera:clone(s.camera),source:clone(s.source),sourceHash:hash(s.source),rawSha256:s.rawSha256||null,catalogueHash:c.hash,wallHeightContract:clone(SceneIR.wallHeightContract),displayBindings:clone((s.options||{}).bindingDecisions||[]),diagnostics:clone(s.diagnostics||[]),applyAvailable:false};}
    const api={
      read_catalog(request={}){keys(request,['ids']);const c=catalog();if(request.ids!==undefined&&(!Array.isArray(request.ids)||request.ids.length>64))fail('invalid_request','At most 64 explicit catalogue IDs');const entries=request.ids?request.ids.map(v=>{catalogueId(v);const e=c.registry.get(v);if(!e)fail('unknown_catalogue','Unknown catalogue ID');return e;}):c.entries;return clone({apiVersion:1,version:'scene-catalogue-v1',hash:c.hash,entries});},
      get_scene(request){keys(request,['planId']);return sceneResult(id(request.planId),read(request.planId));},
      async preview_patch(request){
        keys(request,['planId','baseRevision','displayBindings','selectedObjectIds','selectedEntityIds','incompleteConfirmed','displayOverrides']);
        if(JSON.stringify(request).length>65536)fail('invalid_request','Patch exceeds 64KiB');
        if(busy)fail('preview_busy','One isolated preview operation may run at a time');
        id(request.planId);if(typeof request.baseRevision!=='string')fail('invalid_request','baseRevision is required');
        const current=read(request.planId),{s,c,revision}=current;
        if(request.baseRevision!==revision)fail('stale_revision','Scene, source, camera or catalogue changed; read again');
        if(request.selectedEntityIds!==undefined&&(!Array.isArray(request.selectedEntityIds)||request.selectedEntityIds.length>32))fail('invalid_patch','At most 32 explicit structural IDs');
        if(!Array.isArray(request.displayBindings)||request.displayBindings.length>32||!Array.isArray(request.selectedObjectIds)||request.selectedObjectIds.length>32||request.incompleteConfirmed!==true)fail('invalid_patch','Bounded display bindings and explicit incomplete subset confirmation required');
        const partial=SceneIR.createPartialSelection(s.source,request.selectedObjectIds,true,request.selectedEntityIds);
        if(!partial)fail('invalid_patch','Select existing object/structural IDs without duplicates');
        const opts=clone(s.options||{}),changes=[],seen=new Set();
        const previous=lastRendered&&lastRendered.revision===revision?lastRendered:null;
        opts.displayOverrideContext={baseRevision:revision,sourceHash:hash(s.source),selectedEntityIds:clone(request.selectedEntityIds||[])};
        const requestedOverrides=request.displayOverrides===undefined?[]:request.displayOverrides;
        if(Array.isArray(requestedOverrides))for(const proposal of requestedOverrides){if(proposal&&proposal.sourceEntityId!==undefined)id(proposal.sourceEntityId);}
        try{opts.displayOverrides=SceneIR.validateDisplayOverrides(s.source,requestedOverrides,opts.displayOverrideContext,false);}
        catch(error){fail('invalid_display_override',error.message);}
        opts.bindingDecisions=opts.bindingDecisions||[];
        for(const p of request.displayBindings){
          keys(p,['sourceEntityId','catalogId','sizingPolicy','appearanceMode','appearanceProfile']);id(p.sourceEntityId);
          if(seen.has(p.sourceEntityId)||!partial.entityIds.includes(p.sourceEntityId))fail('invalid_patch','Duplicate or out-of-scope binding');seen.add(p.sourceEntityId);
          const obj=s.source.objects.find(e=>e.id===p.sourceEntityId),room=s.source.rooms.find(e=>e.id===p.sourceEntityId),entity=obj||room;
          if(!entity)fail('invalid_patch','Only source objects and selected/dependent rooms can be bound');
          if(!['native','fit-source'].includes(p.sizingPolicy)||!['unspecified','match-diagram-appearance'].includes(p.appearanceMode))fail('invalid_patch','Unsupported display policy');
          if(obj){catalogueId(p.catalogId);const model=c.registry.get(p.catalogId);if(!model||model.openingOnly)fail('unknown_catalogue','Choose an existing non-opening catalogue ID');}
          else if(p.catalogId!==null||p.sizingPolicy!=='native')fail('invalid_patch','Room binding only supports appearance mapping');
          const before=opts.bindingDecisions.find(d=>d.binding.sourceEntityId===entity.id)||null;
          const decision={sourceSnapshot:JSON.stringify(entity),binding:{id:'api-display-'+entity.id,sourceEntityId:entity.id,catalogId:obj?{value:p.catalogId,status:'inferred',source:'internal-api display proposal',reason:'Display representation only; unchanged raw source is retained'}:{value:null,status:'unknown'},sizingPolicy:p.sizingPolicy,appearanceMode:p.appearanceMode}};
          if(p.appearanceProfile!==undefined){try{const verified=Profiles.validate(p.appearanceProfile,decision.binding,entity,c.registry.get(p.catalogId));decision.binding.appearanceProfile=verified.profile;decision.appearanceProvenance=verified.provenance;}catch(error){fail('invalid_appearance_profile',error.message);}}
          opts.bindingDecisions=opts.bindingDecisions.filter(d=>d.binding.sourceEntityId!==entity.id).concat(decision);
          changes.push({sourceEntityId:entity.id,before,after:clone(decision)});
        }
        Object.assign(opts,{registry:c.registry,materialization:'bounded-v3',partialSelection:partial,acceptedReviews:[],acceptedReviewGroups:[],reviewedEntities:{},unresolvedDecisions:[]});
        const compiled=previewSceneIRSnapshot(s.source,s.snapshot,opts);
        const full=previewSceneIRSnapshot(s.source,s.snapshot,Object.assign({},opts,{partialSelection:null}));
        changes.forEach(change=>{
          const entity=s.source.objects.find(e=>e.id===change.sourceEntityId);if(!entity)return;
          const prior=previous&&previous.objects[entity.id];
          const beforeDisplay=prior?clone(prior):displayObject(entity,change.before&&change.before.binding,s.snapshot,c.registry);
          const afterDisplay=displayObject(entity,change.after.binding,compiled.plan,c.registry);
          const catalogueChanged=!!(beforeDisplay&&afterDisplay&&beforeDisplay.catalogId!==afterDisplay.catalogId);
          const beforeMm=beforeDisplay&&beforeDisplay.effectiveHeight.valueMm,afterMm=afterDisplay&&afterDisplay.effectiveHeight.valueMm;
          const heightChanged=beforeMm!=null&&afterMm!=null&&beforeMm!==afterMm;
          const beforeAsset=beforeDisplay&&beforeDisplay.shape.asset,afterAsset=afterDisplay&&afterDisplay.shape.asset;
          const geometryIdentityChanged=beforeAsset&&afterAsset&&beforeAsset.geometrySHA256&&afterAsset.geometrySHA256?beforeAsset.geometrySHA256!==afterAsset.geometrySHA256:catalogueChanged?null:false;
          change.display={comparisonBasis:prior?'previous-successful-isolated-preview':change.before?'current-scene-binding':'unbound-source',before:beforeDisplay,after:afterDisplay,catalogueChanged,geometryIdentityChanged,heightChanged,heightDeltaMm:beforeMm!=null&&afterMm!=null?afterMm-beforeMm:null,sourceFactsChanged:false};
          if(heightChanged)compiled.diagnostics.push({code:'display_height_changed',path:'objects['+s.source.objects.indexOf(entity)+'].binding',severity:'review',message:'Catalogue substitution changes display height from '+beforeMm+' to '+afterMm+' mm; retained source height is unchanged',beforeMm,afterMm,origin:'catalogue-default'});
          if(catalogueChanged)compiled.diagnostics.push({code:'display_geometry_substitution',path:'objects['+s.source.objects.indexOf(entity)+'].binding',severity:'review',message:'Catalogue replacement selects a different asset representation; color improvement does not certify shape equivalence',beforeCatalogId:beforeDisplay.catalogId,afterCatalogId:afterDisplay.catalogId,geometryIdentityChanged});
        });

        const wallDisplays=compiled.plan.walls.map(w=>displayWall(s.source.walls.find(e=>e.id===w.id),opts.displayOverrides.find(p=>p.sourceEntityId===w.id),compiled.plan));
        for(const after of wallDisplays){
          const prior=previous&&previous.walls&&previous.walls[after.sourceEntityId];
          if(!after.requestedHeight&&!(prior&&prior.requestedHeight))continue;
          const entity=s.source.walls.find(e=>e.id===after.sourceEntityId);
          const before=prior?clone(prior):displayWall(entity,null,s.snapshot);
          changes.push({kind:'wall-height-display-override',sourceEntityId:entity.id,before:before.requestedHeight,after:after.requestedHeight,
            display:{comparisonBasis:prior?'previous-successful-isolated-preview':'current-scene',before,after:clone(after),sourceFactsChanged:false,
              materializedHeightDeltaMm:before.materializedWallHeightMm!==null&&after.materializedWallHeightMm!==null?after.materializedWallHeightMm-before.materializedWallHeightMm:null,effectiveHeightDeltaMm:null}});
        }

        const response={apiVersion:1,planId:request.planId,baseRevision:revision,sourceHash:hash(s.source),catalogueHash:c.hash,diff:changes,diagnostics:clone(compiled.diagnostics),unresolved:clone(compiled.unresolvedEntities||[]),deferred:clone(compiled.deferredEntities||[]),fullDiagnostics:clone(full.diagnostics),fullUnresolved:clone(full.unresolvedEntities||[]),reviewGroups:clone(compiled.reviewGroups||[]),displayBindings:clone(opts.bindingDecisions),appearanceProfiles:clone(compiled.appearanceProfiles||[]),displayOverrides:clone(opts.displayOverrides),wallHeightContract:clone(SceneIR.wallHeightContract),wallDisplays:clone(wallDisplays),selectedObjectIds:partial.objectIds,selectedEntityIds:partial.structureIds||[],selectionScope:clone(partial),defaults:clone(compiled.defaults||[]),rendered:false,image:null,imageCaptureStatus:'external-not-captured',applyAvailable:false,fullReconstructionReady:false,reconstructionStatus:'incomplete-selected-preview',previewPlan:clone(compiled.plan)};
        if(compiled.diagnostics.some(d=>d.severity==='error'))return response;
        busy=true;const controller=new AbortController();let timer;
        const cancel=(code='preview_cancelled',message='Isolated preview cancelled')=>{if(!controller.signal.aborted){const error=new Error(message);error.code=code;controller.abort(error);}};
        try{
          const assertFresh=()=>{if(controller.signal.aborted)throw controller.signal.reason;if(read(request.planId).revision!==revision)fail('stale_revision','Source scene changed while preparing preview');};
          const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
          const timeout=Number.isFinite(capabilities.previewTimeoutMs)?Math.max(1,Math.min(60000,capabilities.previewTimeoutMs)):45000;
          timer=setTimeout(()=>cancel('preview_timeout','Isolated preview deadline exceeded'),timeout);
          assertFresh();response.preview=await Promise.race([Promise.resolve().then(()=>capabilities.renderPreview({plan:clone(compiled.plan),targetSnapshot:clone(s.snapshot),source:clone(s.source),camera:clone(s.camera),displayBindings:clone(opts.bindingDecisions),displayOverrides:clone(opts.displayOverrides),diagnostics:clone(compiled.diagnostics),assertFresh,signal:controller.signal,cancel})),aborted]);assertFresh();
          for(const required of compiled.appearanceProfiles||[]){const proof=response.preview?.appearanceProfileDisplays?.find(p=>p.sourceEntityId===required.sourceEntityId);if(!proof||!Profiles.acceptsRenderProof(proof.proof,required.profile.colors))fail('native_profile_not_rendered','Native profile proof is missing; fallback is not a successful appearance preview');}
          if(response.preview?.appearanceProfileDisplays)response.preview.appearanceProfileDisplays=response.preview.appearanceProfileDisplays.map(({proof,...publicResult})=>publicResult);
          response.rendered=true;
          const nativeWalls=response.preview&&response.preview.wallDisplays||[];
          response.wallDisplays=compiled.plan.walls.map(w=>displayWall(s.source.walls.find(e=>e.id===w.id),opts.displayOverrides.find(p=>p.sourceEntityId===w.id),compiled.plan,nativeWalls.find(p=>p.sourceEntityId===w.id)));
          changes.filter(c=>c.kind==='wall-height-display-override').forEach(change=>{
            change.display.after=clone(response.wallDisplays.find(w=>w.sourceEntityId===change.sourceEntityId));
            const b=change.display.before.effectiveHeight.valueMm,a=change.display.after.effectiveHeight.valueMm;
            change.display.effectiveHeightDeltaMm=b!==null&&a!==null?a-b:null;
          });
          lastRendered={revision,walls:Object.fromEntries(response.wallDisplays.map(w=>[w.sourceEntityId,clone(w)])),objects:Object.fromEntries(partial.objectIds.map(entityId=>{const entity=s.source.objects.find(e=>e.id===entityId),decision=opts.bindingDecisions.find(d=>d.binding.sourceEntityId===entityId);return [entityId,displayObject(entity,decision&&decision.binding,compiled.plan,c.registry)];}))};
        }catch(error){cancel(error.code||'preview_cancelled',error.message);capabilities.cancelPreview?.(controller.signal.reason,controller.signal);throw error;}
        finally{clearTimeout(timer);busy=false;}
        return response;
      }
    };
    return Object.freeze(api);
  }
  return {create,previewSceneIRSnapshot};
}));
