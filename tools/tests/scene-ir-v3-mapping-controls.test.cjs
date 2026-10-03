/* Review integration, not pre-approved compiler fixtures: every mapping and
 * review decision below is made through production-rendered DOM events. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runtime}=require('./scene-fixtures.cjs');
const SceneV3=require('../../assets/js/scene-ir-v3.js');
const {createReviewDocument,ReviewEvent}=require('./scene-review-dom.cjs');
const RoomGeometry=require('../../assets/js/room-geometry.js');
const fixturePath=path.join(__dirname,'fixtures/scene-ir/v3-mapping-full.json');
const fullFixture=()=>JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
const unknown=()=>({value:null,status:'unknown'});
function setup(source=fullFixture()){
 const c=runtime(),document=createReviewDocument();c.document=document;c.RoomGeometry=RoomGeometry;
 c.CONTEXT_CAR_GLB=c.SceneCatalogue.carCertificate.url;
 const modal=document.createElement('div');modal.id='plan-import-modal';document.body.appendChild(modal);
 const review=document.createElement('section');review.id='plan-import-step3';modal.appendChild(review);
 for(const id of ['plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost']){const e=document.createElement('div');e.id=id;review.appendChild(e);}
 const apply=document.createElement('button');apply.id='plan-import-apply';review.appendChild(apply);
 // The production HTML's inline handler is installed on the test DOM button.
 const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
 const markup=html.match(/<button\b[^>]*\bid="plan-import-apply"[^>]*>/)[0];
 assert.match(markup,/onclick="applyPlanImport\(\)"/);
 apply.addEventListener('click',()=>c.applyPlanImport());
 const raw=JSON.stringify(source),sourceHash=SceneV3.sourceHash(source),before=JSON.stringify(c.DATA);
 const rawResponse=JSON.stringify(source,null,2)+'\n';
 const extraction={rawResponse,rawSha256:crypto.createHash('sha256').update(rawResponse).digest('hex'),contract:{id:'synthetic-ui-mapping-test'}};
 c.PlanImport.stageSceneIR(source,{materialization:'bounded-v3',pageScope:['synthetic-full-plan-image'],extraction});
 return {c,document,source,raw,sourceHash,extraction,before,apply};
}
function result(h){return h.c.PlanImport.state.result;}
function control(h,selector,scope=h.document){const node=scope.querySelector(selector);assert.ok(node,'Rendered control missing: '+selector);return node;}
function group(h,collection,id){return control(h,'details[data-scene-group="'+collection+':'+id+'"]');}
function openMapping(h,id,collection='objects'){
 group(h,collection,id).open=true;
 control(h,'button[data-scene-mapping="'+id+'"]',group(h,collection,id)).click();
 return group(h,collection,id);
}
function setSelect(h,id,key,value,collection='objects'){
 const node=control(h,'select['+key+']',group(h,collection,id));
 assert.ok(node.options.some(o=>o.value===value),'Rendered '+key+' lacks '+value+'; offered: '+node.options.map(o=>o.value).join(', '));
 node.value=value;node.dispatchEvent(new ReviewEvent('change',{bubbles:true}));return node;
}
function setRegion(h,id,region,value){return setSelect(h,id,'data-scene-region="'+region+'"',value);}
function confirmMapping(h,id,collection='objects'){
 const button=control(h,'button[data-scene-mapping-confirm]',group(h,collection,id));
 assert.equal(button.disabled,false,'Mapping confirmation unexpectedly disabled for '+id+'\n'+group(h,collection,id).textContent);
 button.click();
 const decisions=result(h).sceneOptions.bindingDecisions;
 const decision=decisions.find(d=>d.binding.sourceEntityId===id);
 assert.ok(decision,'Rendered Confirm must save a separate binding decision for '+id);
 const source=h.source[collection].find(e=>e.id===id);
 assert.equal(decision.sourceSnapshot,JSON.stringify(source));
 assert.equal(JSON.stringify(result(h).sceneIR),h.raw,'Mapping controls must not rewrite source evidence');
 return decision;
}
function mapObject(h,id,catalogue,sizing,regions){
 openMapping(h,id);setSelect(h,id,'data-scene-catalogue',catalogue);setSelect(h,id,'data-scene-sizing',sizing);
 setSelect(h,id,'data-scene-appearance','match-diagram-appearance');
 for(const [region,channel] of Object.entries(regions))setRegion(h,id,region,channel);
 return confirmMapping(h,id);
}
function mapSurface(h,collection,id){openMapping(h,id,collection);setSelect(h,id,'data-scene-appearance','match-diagram-appearance',collection);return confirmMapping(h,id,collection);}
function mapFullScene(h){
 for(const room of h.source.rooms)mapSurface(h,'rooms',room.id);
 for(const opening of h.source.openings.filter(e=>e.appearance?.diagramColor))mapSurface(h,'openings',opening.id);
 mapObject(h,'object-desk','original-desk-work','native',{top:'wood'});
 mapObject(h,'object-chair','original-chair','fit-source',{seat:'fabric',body:'wood'});
 mapObject(h,'object-car','car','fit-source',{body:'color',top:'__overlay__'});
}
function acceptReviews(h){
 // Requery after each event: production rerenders, so old controls are stale.
 let accepted=0;
 for(;;){
  const checkbox=h.document.querySelectorAll('input[data-scene-accept]').find(n=>!n.checked&&!n.disabled);
  if(!checkbox)break;
  assert.ok(accepted++<400,'Review controls failed to retain accepted state');
  checkbox.click();
 }
 return accepted;
}
function appliedEntity(h,sourceId){const report=h.c.DATA.sceneReconstructionReports[0],id=report.sourceIdMap[sourceId];return [...h.c.DATA.rooms,...h.c.DATA.items,...h.c.DATA.walls].find(e=>e.id===id);}
function diagnosticText(h){return JSON.stringify(result(h).sceneCompilation.diagnostics,null,2);}
function assertUnchanged(h){assert.equal(JSON.stringify(h.c.DATA),h.before);assert.equal(h.c.HISTORY.length,0);assert.equal(JSON.stringify(result(h).sceneIR),h.raw);}

test('full source-first mappings use rendered controls through real compiler and Apply',()=>{
 const h=setup();assert.equal(h.apply.disabled,true);assertUnchanged(h);
 assert.deepEqual(clone(result(h).sceneOptions.bindingDecisions),[]);
 assert.equal(result(h).sceneIR.bindings.length,0);
 mapFullScene(h);
 assert.equal(h.apply.disabled,true,'Confirming mappings does not silently approve review groups');
 assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0);
 assert.ok(acceptReviews(h)>0);
 const compiled=result(h).sceneCompilation;
 assert.equal(compiled.canApply,true,diagnosticText(h));assert.equal(h.apply.disabled,false);
 assert.equal(compiled.reconstructionStatus,'incomplete-source-overlays');
 assert.ok(compiled.unmatchedSourceRegions.some(x=>x.entityId==='object-car'&&x.region==='top'&&x.color==='#8798a8'));
 assertUnchanged(h);
 const decisions=clone(result(h).sceneOptions.bindingDecisions);
 assert.equal(decisions.length,10);
 const carDecision=decisions.find(d=>d.binding.sourceEntityId==='object-car');
 assert.deepEqual(carDecision.retainedAppearanceRegions,['top']);
 assert.deepEqual(carDecision.binding.channels,[{sourceRegion:'body',channel:'color',color:'#9dabb9'}]);
 h.apply.click();
 assert.equal(h.c.HISTORY.length,1);assert.equal(h.c.DATA.rooms.length,3);assert.equal(h.c.DATA.items.length,8);
 for(const [id,color] of [['room-living','#e6ceaa'],['room-entry','#f0e5d4'],['room-study','#cad9c6']])assert.equal(appliedEntity(h,id).floorColor,color,id);
 assert.equal(appliedEntity(h,'room-entry').floorRaiseMm-appliedEntity(h,'room-living').floorRaiseMm,-150,'Entry stays exactly 150 mm below its source reference room');
 assert.equal(appliedEntity(h,'room-entry').floorModuleMm,300);
 assert.equal(appliedEntity(h,'room-living').shape.outer.length,6);
 for(const [id,color] of [['opening-pocket','#9b9b90'],['opening-entry-exterior','#b88552'],['opening-window-north','#bdd8e0'],['opening-window-east','#bdd8e0']]){assert.equal(appliedEntity(h,id).color,color,id);assert.equal(appliedEntity(h,id).colorCustom,true,id);}
 const desk=appliedEntity(h,'object-desk'),chair=appliedEntity(h,'object-chair'),car=appliedEntity(h,'object-car');
 assert.equal(desk.type,'original-desk-work');assert.deepEqual(clone(desk.finishColors),{wood:'#497eaa'});assert.equal(desk.w,1400);assert.equal(desk.d,700);
 assert.equal(chair.type,'original-chair');assert.deepEqual(clone(chair.finishColors),{fabric:'#d8903c',wood:'#bb782b'});assert.equal(chair.w,600);assert.equal(chair.d,620);
 assert.equal(car.type,'car');assert.equal(car.color,'#9dabb9');assert.equal(car.colorCustom,true);assert.equal(car.w,1800);assert.equal(car.d,4400);assert.equal(((car.rot%360)+360)%360,180);
 const sourceFront=h.source.objects.find(e=>e.id==='object-car').frontDirection.value,angle=car.rot*Math.PI/180;
 assert.ok(Math.abs(-Math.sin(angle)-sourceFront.x)<1e-9);assert.ok(Math.abs(Math.cos(angle)-sourceFront.y)<1e-9,'Certified car +Z front preserves the exact north-facing source direction');
 const report=h.c.DATA.sceneReconstructionReports[0];assert.equal(JSON.stringify(report.originalIR),h.raw);assert.equal(report.originalIR.bindings.length,0);assert.equal(SceneV3.sourceHash(report.originalIR),h.sourceHash);
 assert.deepEqual(clone(report.reviewDecisions.bindingDecisions),decisions);
 assert.deepEqual(clone(report.extraction),h.extraction,'The original provider response, its hash and contract survive every mapping event');
 const loaded=require('../../assets/js/plan-schema.js').normalizePlan(clone(h.c.DATA));
 assert.equal(JSON.stringify(loaded.sceneReconstructionReports[0].originalIR),h.raw);
 assert.deepEqual(loaded.sceneReconstructionReports[0].extraction,h.extraction);
 assert.deepEqual(loaded.sceneReconstructionReports[0].reviewDecisions.bindingDecisions,decisions);
 const loadedCar=loaded.items.find(e=>e.id===car.id);assert.equal(loadedCar.w,1800);assert.equal(loadedCar.d,4400);assert.equal(loadedCar.color,'#9dabb9');
 assert.deepEqual(loaded.rooms.find(e=>e.id===appliedEntity(h,'room-living').id).shape,clone(appliedEntity(h,'room-living').shape));
 assert.ok(report.sourcePreview.overlayEntityIds.includes('object-car'));
 assert.equal(h.c.HISTORY[0],h.before,'One undo restores the entire pre-Apply scene');
});

test('desk mapping starts empty and only offers compatible exact catalogue entries',()=>{
 const h=setup(),detail=openMapping(h,'object-desk');
 const select=control(h,'select[data-scene-catalogue]',detail);
 assert.equal(select.value,'','A recommendation must not auto-select an asset');
 const ids=select.options.map(o=>o.value).filter(Boolean);
 assert.ok(ids.includes('original-desk-work'));assert.ok(!ids.includes('original-table'));
 for(const id of ids){const item=h.c.PlanImport.sceneCatalogue().get(id);assert.ok(item,'Option is an exact real catalogue ID: '+id);assert.equal(item.sourceObjectType||item.kind,'desk','Desk must not be routed to generic table/category sibling');assert.equal(item.semanticExtent,'asset');}
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0);
 control(h,'button[data-scene-mapping-cancel]',detail).click();assertUnchanged(h);
});

test('regional finish choices come from the actual asset and stay unselected until explicitly chosen',()=>{
 const h=setup();openMapping(h,'object-chair');setSelect(h,'object-chair','data-scene-catalogue','original-chair');setSelect(h,'object-chair','data-scene-appearance','match-diagram-appearance');
 const expected=h.c.PlanImport.sceneCatalogue().get('original-chair').finishChannels.map(x=>x.key).sort();
 for(const region of ['seat','body']){const select=control(h,'select[data-scene-region="'+region+'"]',group(h,'objects','object-chair'));assert.equal(select.value,'');assert.deepEqual(select.options.map(o=>o.value).filter(v=>v&&v!=='__overlay__').sort(),expected);assert.ok(select.options.some(o=>o.value==='__overlay__'));}
 assertUnchanged(h);
});

test('cancel, reopen, and change preserve confirmed decisions until Confirm',()=>{
 const h=setup();mapObject(h,'object-desk','original-desk-work','native',{top:'wood'});acceptReviews(h);
 const before=JSON.stringify(result(h).sceneOptions);
 openMapping(h,'object-desk');setSelect(h,'object-desk','data-scene-catalogue','original-desk');setSelect(h,'object-desk','data-scene-sizing','fit-source');setSelect(h,'object-desk','data-scene-appearance','unspecified');
 control(h,'button[data-scene-mapping-cancel]',group(h,'objects','object-desk')).click();
 assert.equal(JSON.stringify(result(h).sceneOptions),before,'Cancel must preserve the confirmed binding and review state');
 openMapping(h,'object-desk');
 assert.equal(control(h,'select[data-scene-catalogue]',group(h,'objects','object-desk')).value,'original-desk-work');
 assert.equal(control(h,'select[data-scene-sizing]',group(h,'objects','object-desk')).value,'native');
 assert.equal(control(h,'select[data-scene-appearance]',group(h,'objects','object-desk')).value,'match-diagram-appearance');
 assert.equal(control(h,'select[data-scene-region="top"]',group(h,'objects','object-desk')).value,'wood');
 setSelect(h,'object-desk','data-scene-catalogue','original-desk');setSelect(h,'object-desk','data-scene-sizing','fit-source');setSelect(h,'object-desk','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-desk','top','wood');
 const changed=confirmMapping(h,'object-desk');assert.equal(changed.binding.catalogId.value,'original-desk');assert.equal(changed.binding.sizingPolicy,'fit-source');
 assert.equal(result(h).sceneOptions.bindingDecisions.length,1,'Changing a source replaces rather than duplicates its decision');
 assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0,'A confirmed changed mapping clears all older group reviews');
 assert.deepEqual(clone(result(h).sceneOptions.reviewedEntities),{});assertUnchanged(h);
});

test('opening a draft editor blocks UI Apply and direct Apply dispatch until Cancel',()=>{
 const h=setup();mapFullScene(h);acceptReviews(h);assert.equal(h.apply.disabled,false,diagnosticText(h));
 const confirmed=JSON.stringify(result(h).sceneOptions);openMapping(h,'object-desk');
 assert.equal(h.apply.disabled,true,'Uncommitted mapping must disable Apply');
 h.c.cancelPlanImportDrag();
 assert.equal(h.apply.disabled,true,'Global touchcancel/button synchronization must not re-enable Apply during a mapping draft');
 assert.ok(h.document.querySelectorAll('[data-scene-review-control]').every(n=>n.disabled),'Placement, other mapping and acceptance controls remain disabled');
 h.apply.dispatchEvent(new ReviewEvent('click'));
 assertUnchanged(h);
 control(h,'button[data-scene-mapping-cancel]',group(h,'objects','object-desk')).click();
 assert.equal(JSON.stringify(result(h).sceneOptions),confirmed);assert.equal(h.apply.disabled,false);
 h.apply.click();assert.equal(h.c.HISTORY.length,1);
});

test('stale Confirm, Cancel, select and review controls cannot affect a newly staged result',()=>{
 const h=setup();mapObject(h,'object-desk','original-desk-work','native',{top:'wood'});
 const oldReview=h.document.querySelector('input[data-scene-accept]');assert.ok(oldReview);
 openMapping(h,'object-desk');const detail=group(h,'objects','object-desk');
 const oldConfirm=control(h,'button[data-scene-mapping-confirm]',detail),oldCancel=control(h,'button[data-scene-mapping-cancel]',detail),oldSelect=control(h,'select[data-scene-catalogue]',detail);
 h.c.PlanImport.stageSceneIR(h.source,{materialization:'bounded-v3',pageScope:['replacement-source']});
 const current=result(h),before=JSON.stringify(current.sceneOptions);
 assert.equal(oldConfirm.isConnected,false);assert.equal(oldReview.isConnected,false);
 oldConfirm.dispatchEvent(new ReviewEvent('click'));oldSelect.value='original-desk';oldSelect.dispatchEvent(new ReviewEvent('change'));oldReview.checked=true;oldReview.dispatchEvent(new ReviewEvent('change'));oldCancel.dispatchEvent(new ReviewEvent('click'));
 assert.equal(result(h),current);assert.equal(JSON.stringify(result(h).sceneOptions),before);assertUnchanged(h);
});

test('cancelled editor controls cannot later confirm a discarded draft',()=>{
 const h=setup();openMapping(h,'object-desk');setSelect(h,'object-desk','data-scene-catalogue','original-desk-work');setSelect(h,'object-desk','data-scene-sizing','native');setSelect(h,'object-desk','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-desk','top','wood');
 const oldConfirm=control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-desk'));
 control(h,'button[data-scene-mapping-cancel]',group(h,'objects','object-desk')).click();
 assert.equal(oldConfirm.isConnected,false);oldConfirm.dispatchEvent(new ReviewEvent('click'));
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0);assertUnchanged(h);
});

test('unknown catalogue values cannot become confirmed auto-selected assets',()=>{
 const h=setup();openMapping(h,'object-desk');const select=control(h,'select[data-scene-catalogue]',group(h,'objects','object-desk'));
 assert.ok(!select.options.some(o=>o.value==='unregistered-desk'));select.value='unregistered-desk';select.dispatchEvent(new ReviewEvent('change'));
 control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-desk')).click();
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0);assert.equal(h.apply.disabled,true);assertUnchanged(h);
});

test('a catalogue entry removed while the mapping editor is open cannot pass Apply',()=>{
 const h=setup();openMapping(h,'object-desk');setSelect(h,'object-desk','data-scene-catalogue','original-desk-work');setSelect(h,'object-desk','data-scene-sizing','native');setSelect(h,'object-desk','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-desk','top','wood');
 delete h.c.FMP_ITEMS['original-desk-work'];
 control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-desk')).click();acceptReviews(h);
 assert.equal(result(h).sceneCompilation.canApply,false);h.apply.dispatchEvent(new ReviewEvent('click'));assertUnchanged(h);
});

for(const [name,change] of [
 ['missing footprint axis',s=>{delete s.objects[0].sourceFootprint.value.axisX;}],
 ['unknown footprint',s=>{s.objects[0].sourceFootprint=unknown();}],
 ['unknown semantic extent',s=>{s.objects[0].semanticExtent=unknown();}],
])test(name+' remains unresolved after review and cannot be filled by a catalogue suggestion',()=>{
 const source=fullFixture();change(source);const h=setup(source);
 const open=h.document.querySelector('button[data-scene-mapping="object-desk"]');
 if(open&&!open.disabled){open.click();const select=h.document.querySelector('select[data-scene-catalogue]');if(select)assert.equal(select.value,'');const cancel=h.document.querySelector('button[data-scene-mapping-cancel]');if(cancel)cancel.click();}
 acceptReviews(h);assert.equal(result(h).sceneCompilation.canApply,false);assert.equal(h.apply.disabled,true);
 h.apply.dispatchEvent(new ReviewEvent('click'));assertUnchanged(h);
});

test('unmapped regional color cannot silently collapse into another renderer channel',()=>{
 const h=setup();openMapping(h,'object-car');setSelect(h,'object-car','data-scene-catalogue','car');setSelect(h,'object-car','data-scene-sizing','fit-source');setSelect(h,'object-car','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-car','body','color');
 assert.equal(control(h,'select[data-scene-region="top"]',group(h,'objects','object-car')).value,'');
 control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-car')).click();
 const decision=result(h).sceneOptions.bindingDecisions.find(d=>d.binding.sourceEntityId==='object-car');
 if(decision)assert.ok(!decision.retainedAppearanceRegions?.includes('top'),'No implicit source-only retention');
 assert.equal(result(h).sceneCompilation.canApply,false);assertUnchanged(h);
});

test('a missing required catalogue front axis excludes that model without guessing',()=>{
 const h=setup();delete h.c.FMP_ITEMS['original-desk-work'].front;
 assert.equal(h.c.PlanImport.sceneCatalogue().get('original-desk-work').front,null);
 const detail=openMapping(h,'object-desk'),select=control(h,'select[data-scene-catalogue]',detail);
 assert.ok(!select.options.some(o=>o.value==='original-desk-work'));
 assert.equal(select.value,'');assert.equal(result(h).sceneOptions.bindingDecisions.length,0);
 assert.ok(detail.textContent.includes('original-desk-work'),'Excluded exact asset and reason stay visible');
 assertUnchanged(h);
});

test('native size mismatch needs an explicit fit-source choice rather than automatic scaling',()=>{
 const h=setup();openMapping(h,'object-chair');setSelect(h,'object-chair','data-scene-catalogue','original-chair');setSelect(h,'object-chair','data-scene-sizing','native');setSelect(h,'object-chair','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-chair','seat','fabric');setRegion(h,'object-chair','body','wood');
 control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-chair')).click();
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0,'Native mismatch must not save an automatically scaled binding');
 assert.equal(control(h,'select[data-scene-sizing]',group(h,'objects','object-chair')).value,'native');
 setSelect(h,'object-chair','data-scene-sizing','fit-source');const decision=confirmMapping(h,'object-chair');
 assert.equal(decision.binding.sizingPolicy,'fit-source');assert.equal(result(h).sceneOptions.acceptedReviewGroups.length,0);assertUnchanged(h);
});

test('distinct source colors cannot both silently overwrite one generic car color channel',()=>{
 const h=setup();openMapping(h,'object-car');setSelect(h,'object-car','data-scene-catalogue','car');setSelect(h,'object-car','data-scene-sizing','fit-source');setSelect(h,'object-car','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-car','body','color');setRegion(h,'object-car','top','color');
 control(h,'button[data-scene-mapping-confirm]',group(h,'objects','object-car')).click();
 assert.equal(result(h).sceneOptions.bindingDecisions.length,0);assert.equal(h.apply.disabled,true);assertUnchanged(h);
});

test('an unspecified appearance choice preserves known colors as unresolved evidence',()=>{
 const h=setup();openMapping(h,'room-study','rooms');setSelect(h,'room-study','data-scene-appearance','unspecified','rooms');
 const decision=confirmMapping(h,'room-study','rooms');assert.equal(decision.binding.appearanceMode,'unspecified');acceptReviews(h);
 assert.ok(result(h).sceneCompilation.diagnostics.some(d=>d.code==='appearance_mapping_required'));
 assert.equal(result(h).sceneCompilation.canApply,false);h.apply.dispatchEvent(new ReviewEvent('click'));assertUnchanged(h);
});

test('a new legacy read retires an open mapping editor and its stale controls before Apply',async()=>{
 const h=setup();openMapping(h,'object-desk');setSelect(h,'object-desk','data-scene-catalogue','original-desk-work');setSelect(h,'object-desk','data-scene-sizing','native');setSelect(h,'object-desk','data-scene-appearance','match-diagram-appearance');setRegion(h,'object-desk','top','wood');
 const detail=group(h,'objects','object-desk'),staleConfirm=control(h,'button[data-scene-mapping-confirm]',detail),staleCancel=control(h,'button[data-scene-mapping-cancel]',detail);
 h.c.PlanImport.state.pages=['data:image/png;base64,synthetic-next-legacy-image'];
 const legacy={plan:{walls:[],rooms:[{x:0,y:0,w:3000,d:2500,floor:1,n:'New legacy room'}],items:[]},summary:{walls:0,rooms:1,items:0,floors:[1]},revise:{skipAll:true}};
 let resolveResponse,calls=0;
 h.c.fetch=(url,options)=>{assert.equal(url,'/api/ai/import-plan');assert.equal(JSON.parse(options.body).extractionContract,undefined);calls++;return new Promise(resolve=>resolveResponse=resolve);};
 const pending=h.c.runPlanImport();
 assert.equal(h.c.PlanImport.state.mappingEditor,null,'Starting the new read clears the old editor lock');
 staleConfirm.dispatchEvent(new ReviewEvent('click'));staleCancel.dispatchEvent(new ReviewEvent('click'));
 assert.equal(result(h),null);assert.equal(h.apply.disabled,true);assert.equal(h.c.HISTORY.length,0);
 resolveResponse({status:200,text:async()=>JSON.stringify(legacy)});await pending;
 assert.equal(calls,1);assert.equal(result(h).sceneIR,undefined);assert.equal(h.apply.disabled,false);
 const current=result(h);staleConfirm.dispatchEvent(new ReviewEvent('click'));staleCancel.dispatchEvent(new ReviewEvent('click'));
 assert.equal(result(h),current);assert.equal(h.c.PlanImport.state.mappingEditor,null);
 h.apply.click();assert.equal(h.c.HISTORY.length,1);assert.equal(h.c.DATA.rooms.length,1);assert.equal(h.c.DATA.rooms[0].n,'New legacy room');assert.equal(h.c.DATA.items.length,0);assert.equal(h.c.DATA.sceneReconstructionReports,undefined);
});

test('frozen source full blockers and evidence remain reachable in partial review without changing approvals',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../../local-preview/frozen-page-2.json'),'utf8'));
 const h=setup(source),opts=clone(result(h).sceneOptions);
 opts.partialSelection=SceneV3.createPartialSelection(source,[],true,['wall-west']);
 h.c.PlanImport.stageSceneIR(source,opts);
 const body=result(h),before=JSON.stringify(body.sceneOptions),data=JSON.stringify(h.c.DATA);
 assert.equal(body.sceneCompilation.diagnostics.some(d=>d.code==='unsupported_opening_mechanism'),false);
 assert.ok(body.sceneFullCompilation.diagnostics.some(d=>d.code==='unsupported_opening_mechanism'));
 assert.match(control(h,'[data-scene-full-errors]').textContent,/unsupported_stair_reconstruction/);
 assert.match(control(h,'[data-scene-full-status]').textContent,/全体適用: 不可/);
 const fullStair=body.sceneFullCompilation.reviewGroups.find(g=>g.diagnostics.some(d=>d.code==='unsupported_stair_reconstruction'));
 const stairGroup=group(h,fullStair.collection,fullStair.entityId);
 assert.ok(stairGroup.textContent.includes(fullStair.evidence[0].path),'Deferred groups keep actual source evidence');
 assert.equal(stairGroup.querySelector('[data-scene-omit]'),null,'Stairs cannot be waived');
 const search=control(h,'[data-scene-review-search]');search.value='unsupported_stair_reconstruction';search.dispatchEvent(new ReviewEvent('input'));
 assert.equal(stairGroup.hidden,false);assert.equal(group(h,'walls','wall-west').hidden,true);
 assert.equal(JSON.stringify(body.sceneOptions),before);assert.equal(JSON.stringify(h.c.DATA),data);
 assert.equal(JSON.stringify(body.sceneIR),h.raw);assert.deepEqual(clone(body.extraction),h.extraction);
 const stale=search;
 h.c.PlanImport.stageSceneIR(source,opts);
 assert.equal(control(h,'[data-scene-review-search]').value,'unsupported_stair_reconstruction');
 const text=control(h,'[data-scene-filter-count]').textContent;stale.value='never-match';stale.dispatchEvent(new ReviewEvent('input'));
 assert.equal(control(h,'[data-scene-filter-count]').textContent,text);
 const freshSearch=control(h,'[data-scene-review-search]');freshSearch.value='';freshSearch.dispatchEvent(new ReviewEvent('input'));
 const filter=control(h,'[data-scene-review-filter]');filter.value='unresolved';filter.dispatchEvent(new ReviewEvent('change'));
 assert.equal(group(h,'walls','wall-west').hidden,true);assert.equal(group(h,fullStair.collection,fullStair.entityId).hidden,false);
 assert.equal(result(h).sceneFullCompilation.canApply,false);assertUnchanged(h);
});

test('full diagnostic refresh follows explicit room mapping while frozen raw and stair blockers remain intact',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../../local-preview/frozen-page-2.json'),'utf8'));
 const h=setup(source),opts=clone(result(h).sceneOptions);opts.partialSelection=SceneV3.createPartialSelection(source,[],true,['wall-west']);
 h.c.PlanImport.stageSceneIR(source,opts);
 assert.ok(result(h).sceneFullCompilation.diagnostics.some(d=>d.path==='rooms[0].appearance'&&d.code==='appearance_mapping_required'));
 mapSurface(h,'rooms','room-ldk');
 assert.equal(result(h).sceneFullCompilation.diagnostics.some(d=>d.path==='rooms[0].appearance'&&d.code==='appearance_mapping_required'),false);
 assert.ok(result(h).sceneFullCompilation.diagnostics.some(d=>d.code==='unsupported_opening_mechanism'));
 assert.ok(result(h).sceneFullCompilation.diagnostics.some(d=>d.code==='unsupported_stair_reconstruction'));
 assert.equal(JSON.stringify(result(h).sceneIR),h.raw);assert.deepEqual(clone(result(h).extraction),h.extraction);assertUnchanged(h);
});
