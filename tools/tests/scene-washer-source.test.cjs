/* Anonymous synthetic observations only. Exercise the real catalogue,
 * production-rendered mapping controls, compiler and one-shot Apply lifecycle. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runtime}=require('./scene-fixtures.cjs');
const C=require('../../assets/js/scene-catalogue.js'),V=require('../../assets/js/scene-ir-v3.js');
const M=require('../../assets/js/source-object-mapping.js'),Schema=require('../../assets/js/plan-schema.js');
const RoomGeometry=require('../../assets/js/room-geometry.js');
const {createReviewDocument,ReviewEvent}=require('./scene-review-dom.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const f=value=>({value,status:'observed',source:'anonymous synthetic survey; not a source-plan measurement'});
const unknown=()=>({value:null,status:'unknown'});
const washer='original-washer-drum';
const peers=['original-laundry-rail','original-laundry-cabinet','original-washer-pan','original-laundry-pole'];
function scene(){return {sceneVersion:3,units:'mm',coordinateSystem:'x-east-y-south-clockwise',annotations:[],walls:[],rooms:[{id:'utility-room',floor:f(1),shape:f({kind:'rectUnion',rectangles:[{x:0,y:0,w:3000,d:3000}]}),boundaryBasis:f('wall-centerline')}],openings:[],objects:[{id:'washer-observation',objectType:f('laundry-appliance'),semanticExtent:f('asset'),placement:f({domain:'room',roomId:'utility-room'}),sourceFootprint:f({center:{x:1500,y:1500},sizeMm:{w:640,d:720},axisX:{x:1,y:0}}),frontDirection:f({x:0,y:1}),heightMm:f(1050)}],siteRegions:[],buildingFootprints:[],bindings:[],connections:[]};}
function setup(source=scene(),changeCatalogue){
 const c=runtime(),document=createReviewDocument();c.document=document;c.RoomGeometry=RoomGeometry;
 if(changeCatalogue)changeCatalogue(c);
 const modal=document.createElement('div');modal.id='plan-import-modal';document.body.appendChild(modal);
 const review=document.createElement('section');review.id='plan-import-step3';modal.appendChild(review);
 for(const id of ['plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost']){const e=document.createElement('div');e.id=id;review.appendChild(e);}
 const apply=document.createElement('button');apply.id='plan-import-apply';review.appendChild(apply);
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
 assert.match(html.match(/<button\b[^>]*\bid="plan-import-apply"[^>]*>/)[0],/onclick="applyPlanImport\(\)"/);
 apply.addEventListener('click',()=>c.applyPlanImport());
 const raw=JSON.stringify(source),sourceHash=V.sourceHash(source),before=JSON.stringify(c.DATA);
 const rawResponse=JSON.stringify(source,null,2)+'\n',extraction={rawResponse,rawSha256:crypto.createHash('sha256').update(rawResponse).digest('hex'),contract:{id:'anonymous-washer-regression'}};
 c.PlanImport.stageSceneIR(source,{materialization:'bounded-v3',pageScope:['anonymous-survey'],extraction});
 return {c,document,source,raw,sourceHash,before,extraction,apply};
}
const result=h=>h.c.PlanImport.state.result;
function control(h,selector,scope=h.document){const n=scope.querySelector(selector);assert.ok(n,'Missing rendered control: '+selector);return n;}
const group=h=>control(h,'details[data-scene-group="objects:washer-observation"]');
function open(h){group(h).open=true;control(h,'button[data-scene-mapping="washer-observation"]',group(h)).click();return group(h);}
function select(h,key,value){const n=control(h,'select['+key+']',group(h));assert.ok(n.options.some(o=>o.value===value),'Missing option '+value);n.value=value;n.dispatchEvent(new ReviewEvent('change',{bubbles:true}));return n;}
function choose(h,policy='native'){open(h);select(h,'data-scene-catalogue',washer);select(h,'data-scene-sizing',policy);select(h,'data-scene-appearance','unspecified');}
function confirm(h){control(h,'button[data-scene-mapping-confirm]',group(h)).click();return result(h).sceneOptions.bindingDecisions[0];}
function accept(h){let count=0;for(;;){const n=h.document.querySelectorAll('input[data-scene-accept]').find(n=>!n.checked&&!n.disabled);if(!n)break;assert.ok(count++<40);n.click();}return count;}
function unchanged(h){assert.equal(JSON.stringify(h.c.DATA),h.before);assert.equal(h.c.HISTORY.length,0);assert.equal(JSON.stringify(result(h).sceneIR),h.raw);assert.equal(V.sourceHash(result(h).sceneIR),h.sourceHash);assert.deepEqual(clone(result(h).extraction),h.extraction);}
function reviewed(c,source,patch={}){
 const options={materialization:'bounded-v3',bindingDecisions:[{sourceSnapshot:JSON.stringify(source.objects[0]),binding:{id:'anonymous-binding',sourceEntityId:source.objects[0].id,catalogId:f(washer),sizingPolicy:'native',...patch}}]};
 const staged=c.PlanImport.previewSceneIR(source,options);
 return c.PlanImport.previewSceneIR(source,{...options,acceptedReviewGroups:staged.reviewGroups.map(g=>g.id),reviewedEntities:Object.fromEntries(staged.reviewGroups.map(g=>[g.entityId,g.reviewKey]))});
}

test('only the exact real washer gains additive laundry-appliance compatibility',()=>{
 const c=runtime(),registry=c.PlanImport.sceneCatalogue(),m=registry.get(washer),raw=c.FMP_ITEMS[washer];
 assert.equal(raw.model,'assets/models/original/original-washer-drum.glb');assert.equal(raw.front,'+Z');
 assert.equal(m.sourceObjectType,'laundry');assert.deepEqual(m.compatibleSourceObjectTypes,['laundry-appliance']);
 assert.deepEqual([m.w,m.d,m.h,m.front,m.genericColor,m.finishChannels],[640,720,1050,'+Z',false,[]]);
 assert.equal(C.supportsSourceObjectType(m,'laundry'),true);assert.equal(C.supportsSourceObjectType(m,'laundry-appliance'),true);
 for(const id of peers){assert.ok(registry.get(id));assert.equal(C.supportsSourceObjectType(registry.get(id),'laundry-appliance'),false,id);}
 const lookalike=C.create({items:{'unreviewed-washer-lookalike':{...raw,id:'unreviewed-washer-lookalike'}}}).get('unreviewed-washer-lookalike');
 assert.equal(C.supportsSourceObjectType(lookalike,'laundry-appliance'),false,'Name/category/model-path likeness cannot grant compatibility');
 assert.deepEqual(Array.from(c.PlanImport.sceneMappingCandidates(scene().objects[0],registry).candidates,m=>m.id),[washer]);
});

test('rendered singleton washer is only a tentative recommendation until Confirm, fresh review and Apply',()=>{
 const h=setup(),detail=open(h),catalogue=control(h,'select[data-scene-catalogue]',detail);
 assert.deepEqual(catalogue.options.map(o=>o.value).filter(Boolean),[washer]);assert.equal(catalogue.value,washer,'Existing singleton recommendation is tentative');
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0);assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0);assert.equal(h.apply.disabled,true);unchanged(h);
 h.c.applyPlanImport();unchanged(h);assert.equal(h.apply.disabled,true,'Tentative selection must never enable direct Apply');
 select(h,'data-scene-catalogue','');
 select(h,'data-scene-sizing','native');select(h,'data-scene-appearance','unspecified');confirm(h);
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0,'Missing explicit model choice cannot save a binding');unchanged(h);
 select(h,'data-scene-catalogue',washer);const decision=confirm(h);
 assert.equal(decision.binding.catalogId.value,washer);assert.equal(decision.sourceSnapshot,JSON.stringify(h.source.objects[0]));
 assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0);assert.equal(h.apply.disabled,true);unchanged(h);
 assert.ok(accept(h)>0);assert.equal(result(h).sceneCompilation.canApply,true);assert.equal(h.apply.disabled,false);unchanged(h);
 const options=clone(result(h).sceneOptions),sourceHash=h.sourceHash;h.apply.click();
 const item=h.c.DATA.items[0],report=h.c.DATA.sceneReconstructionReports[0];
 assert.equal(item.type,washer);assert.deepEqual([item.w,item.d,item.rot,item.x+item.w/2,item.y+item.d/2],[640,720,0,1500,1500]);
 assert.equal(item.finishColors,undefined);assert.equal(item.color,null,'No source-color reproduction is certified');
 assert.equal(h.c.HISTORY.length,1);assert.equal(h.c.HISTORY[0],h.before);assert.equal(V.sourceHash(report.originalIR),sourceHash);
 assert.equal(JSON.stringify(report.originalIR),h.raw);assert.equal(report.originalIR.bindings.length,0);assert.deepEqual(clone(report.extraction),h.extraction);
 assert.deepEqual(clone(report.reviewDecisions.bindingDecisions),options.bindingDecisions);
 const saved=Schema.normalizePlan(clone(h.c.DATA));assert.equal(JSON.stringify(saved.sceneReconstructionReports[0].originalIR),h.raw);assert.deepEqual(saved.sceneReconstructionReports[0].extraction,h.extraction);
 const committed=JSON.stringify(h.c.DATA);h.c.applyPlanImport();assert.equal(JSON.stringify(h.c.DATA),committed);assert.equal(h.c.HISTORY.length,1);
 h.c.DATA=JSON.parse(h.c.HISTORY.pop());assert.equal(JSON.stringify(h.c.DATA),h.before,'One existing Undo restores the complete pre-Apply plan');
});

test('washer mapping Cancel, reopen and stale controls preserve separate decisions and source evidence',()=>{
 const h=setup();choose(h);const abandoned=control(h,'button[data-scene-mapping-confirm]',group(h));control(h,'button[data-scene-mapping-cancel]',group(h)).click();
 abandoned.dispatchEvent(new ReviewEvent('click'));assert.equal(result(h).sceneOptions.bindingDecisions.length,0);unchanged(h);
 choose(h);confirm(h);accept(h);const confirmed=JSON.stringify(result(h).sceneOptions);
 open(h);assert.equal(control(h,'select[data-scene-catalogue]',group(h)).value,washer);select(h,'data-scene-sizing','fit-source');
 const stale=control(h,'button[data-scene-mapping-confirm]',group(h));control(h,'button[data-scene-mapping-cancel]',group(h)).click();
 assert.equal(JSON.stringify(result(h).sceneOptions),confirmed);stale.dispatchEvent(new ReviewEvent('click'));assert.equal(JSON.stringify(result(h).sceneOptions),confirmed);
 open(h);select(h,'data-scene-sizing','fit-source');confirm(h);assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0);unchanged(h);
 open(h);const oldConfirm=control(h,'button[data-scene-mapping-confirm]',group(h));h.c.PlanImport.stageSceneIR(h.source,{materialization:'bounded-v3',pageScope:['new-review'],extraction:h.extraction});
 const current=result(h);oldConfirm.dispatchEvent(new ReviewEvent('click'));assert.equal(result(h),current);assert.equal(current.sceneOptions.bindingDecisions.length,0);unchanged(h);
});

test('unknown catalogue front, invalid dimensions, missing asset and known height mismatch remain excluded',()=>{
 for(const patch of [{front:null},{front:'unverified-axis'},{w:0},{d:-1},{h:1049}]){
  const c=runtime();Object.assign(c.FMP_ITEMS[washer],patch);const choices=c.PlanImport.sceneMappingCandidates(scene().objects[0],c.PlanImport.sceneCatalogue());
  assert.equal(choices.candidates.length,0,JSON.stringify(patch));assert.ok(choices.rejected.some(r=>r.model.id===washer));
  const compiled=reviewed(c,scene());assert.equal(compiled.canApply,false,JSON.stringify(patch));assert.equal(compiled.plan.items.length,0);
 }
 const c=runtime();delete c.FMP_ITEMS[washer];assert.equal(c.PlanImport.sceneMappingCandidates(scene().objects[0],c.PlanImport.sceneCatalogue()).candidates.length,0);assert.equal(reviewed(c,scene()).canApply,false);
});

test('known height, extent, envelope and front conflicts cannot be approved away',()=>{
 for(const [change,code] of [
  [s=>s.objects[0].heightMm=f(1000),'unsupported_asset_height'],
  [s=>s.objects[0].semanticExtent=f('room-assembly'),'asset_semantic_extent'],
  [s=>s.objects[0].semanticExtent=unknown(),'asset_semantic_extent'],
  [s=>s.objects[0].sourceFootprint.value.sizeMm.w=650,'native_size_mismatch'],
  [s=>s.objects[0].frontDirection=f({x:Math.SQRT1_2,y:Math.SQRT1_2}),'asset_axis_conflict']
 ]){const source=scene();change(source);const raw=JSON.stringify(source),c=runtime(),compiled=reviewed(c,source);assert.equal(compiled.canApply,false,code);assert.ok(compiled.diagnostics.some(d=>d.code===code),JSON.stringify(compiled.diagnostics));assert.equal(compiled.plan.items.length,0);assert.equal(JSON.stringify(source),raw);}
 const source=scene();source.objects[0].sourceFootprint.value.sizeMm.w=650;const h=setup(source);choose(h);confirm(h);
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0,'Native-size mismatches fail actual Confirm');unchanged(h);
});

test('washer keeps known single and regional colors blocked without invented finish channels',()=>{
 for(const color of ['#123456',[{region:'body',color:'#123456'}]]){
  const source=scene();source.objects[0].appearance={diagramColor:f(color)};const c=runtime(),raw=JSON.stringify(source);
  if(typeof color==='string')assert.equal(c.PlanImport.sceneMappingCandidates(source.objects[0],c.PlanImport.sceneCatalogue()).candidates.length,0);
  const compiled=reviewed(c,source,{appearanceMode:'match-diagram-appearance'});assert.equal(compiled.canApply,false);assert.ok(compiled.diagnostics.some(d=>d.code==='appearance_channels_unresolved'));assert.equal(compiled.plan.items.length,0);assert.equal(JSON.stringify(source),raw);
  const forged=reviewed(c,source,{appearanceMode:'match-diagram-appearance',channels:[{sourceRegion:'body',channel:'color',color:'#123456'}]});assert.equal(forged.canApply,false);assert.equal(forged.plan.items.length,0);
 }
});

test('unknown source front, color and height remain unknown and require reviewed display assumptions',()=>{
 const source=scene(),object=source.objects[0];object.frontDirection=unknown();object.heightMm=unknown();object.appearance={diagramColor:unknown()};
 const h=setup(source);choose(h);assert.ok(control(h,'select[data-scene-orientation]',group(h)));const decision=confirm(h);
 assert.equal(decision.binding.rotationDeg.status,'inferred');assert.match(decision.binding.rotationDeg.reason,/unknown/);accept(h);
 assert.equal(result(h).sceneCompilation.canApply,true);assert.ok(result(h).sceneCompilation.defaults.some(d=>d.path==='objects[0].heightMm'&&d.value===1050));
 unchanged(h);h.apply.click();const report=h.c.DATA.sceneReconstructionReports[0],item=h.c.DATA.items[0];
 assert.deepEqual(clone(report.originalIR.objects[0].frontDirection),unknown());assert.deepEqual(clone(report.originalIR.objects[0].heightMm),unknown());assert.deepEqual(clone(report.originalIR.objects[0].appearance.diagramColor),unknown());
 assert.equal(item.color,null);assert.equal(item.finishColors,undefined);
 const extent=scene();extent.objects[0].semanticExtent=unknown();assert.equal(h.c.PlanImport.sceneMappingCandidates(extent.objects[0],h.c.PlanImport.sceneCatalogue()).candidates.length,0);
});

test('changed catalogue metadata cannot confirm or Apply a stale washer review',()=>{
 const h=setup();choose(h);h.c.FMP_ITEMS[washer].front='-Z';confirm(h);assert.equal(result(h).sceneOptions.bindingDecisions.length,0);unchanged(h);
 const ready=setup();choose(ready);confirm(ready);accept(ready);assert.equal(ready.apply.disabled,false);delete ready.c.FMP_ITEMS[washer];ready.c.applyPlanImport();
 assert.equal(result(ready).sceneCompilation.canApply,false);assert.equal(ready.apply.disabled,true);assert.ok(result(ready).sceneCompilation.diagnostics.some(d=>d.code==='mapping_unresolved'));unchanged(ready);
});

test('source hash and target-plan CAS invalidate accepted washer reviews before Apply',()=>{
 const h=setup();choose(h);confirm(h);accept(h);const options=clone(result(h).sceneOptions),changed=clone(h.source);changed.objects[0].frontDirection=f({x:0,y:-1});
 assert.notEqual(V.sourceHash(changed),h.sourceHash);assert.equal(h.c.PlanImport.previewSceneIR(changed,options).canApply,false);unchanged(h);
 h.c.DATA.heightDefaults.floorThickness=240;const target=JSON.stringify(h.c.DATA);h.c.applyPlanImport();assert.equal(result(h).sceneCompilation.canApply,false);assert.equal(h.apply.disabled,true);assert.equal(JSON.stringify(h.c.DATA),target);assert.equal(h.c.HISTORY.length,0);assert.equal(JSON.stringify(result(h).sceneIR),h.raw);
});

test('older laundry source mapping remains byte-equivalent after additive compatibility',()=>{
 const c=runtime(),registry=c.PlanImport.sceneCatalogue(),beforeRegistry={get:id=>{const m=registry.get(id);if(m&&id===washer)delete m.compatibleSourceObjectTypes;return m;},list:()=>registry.list().map(m=>{if(m.id===washer)delete m.compatibleSourceObjectTypes;return m;})};
 const source={marks:[{guess:'laundry',floor:1,x:1500,y:1500,w:640,d:720,rot:0,frontDirection:{x:0,y:1}}]},raw=JSON.stringify(source),candidate=M.candidates(source)[0];
 const decision={sourceId:candidate.id,sourceSnapshot:candidate.snapshot,reviewed:true,semantic:'laundry',catalogId:washer,sizingPolicy:'native'};
 const baseline=M.map(source,decision,beforeRegistry),current=M.map(source,decision,registry);assert.equal(baseline.canApply,true);assert.equal(JSON.stringify(current),JSON.stringify(baseline));assert.equal(JSON.stringify(source),raw);
});
