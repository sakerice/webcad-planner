const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../../assets/js/plan-registration.js');
const {runtime}=require('./scene-fixtures.cjs'),{createReviewDocument}=require('./scene-review-dom.cjs');
async function setup(){
 const raw=JSON.parse(fs.readFileSync(__dirname+'/fixtures/registration/native-astra-three-floor.raw.json'));
 const {mergeReadPages}=await import('../../worker/plan-pages.mjs'),{finishImportedPlan}=await import('../../worker/routes-ai.mjs');
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const res=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{}),body=await res.json();
 const c=runtime(),doc=createReviewDocument();c.document=doc;c.PlanRegistration=R;c.SourceObjectMapping=require('../../assets/js/source-object-mapping.js');
 const host=doc.createElement('section');host.id='plan-import-step3';doc.body.appendChild(host);
 for(const id of ['plan-import-modal','plan-import-status','plan-import-summary','plan-import-rooms','plan-import-notes','plan-import-cost','plan-import-apply']){const e=doc.createElement(id==='plan-import-apply'?'button':'div');e.id=id;host.appendChild(e);}
 c.PlanImport.stageBuildingReview(body);
 for(const floor of [1,2,3]){const group=doc.querySelector('details[data-building-floor="'+floor+'"]');group.querySelector('[data-building-identity]').click();group.querySelector('[data-building-identity-evidence]').value='Test-only source title confirmation';group.querySelector('[data-building-confirm]').click();}
 doc.querySelector('[data-building-partial]').click();return {c,doc,body};
}
test('explicit native bath mapping produces a real editable long tub at the source symbol, preserves source/history/default-height provenance',async()=>{
 const {c,doc,body}=await setup(),before=JSON.stringify(body.sourceLocal);
 assert.equal(c.PlanImport.bathtubCandidates(body).length,1);
 doc.querySelector('[data-source-bathtub]').click();c.applyPlanImport();
 const tubs=c.DATA.items.filter(i=>i.type==='original-bathtub');assert.equal(tubs.length,1);
 assert.equal(c.DATA.items.some(i=>i.type==='bath'),false);assert.equal(tubs[0].w,1550);assert.equal(tubs[0].d,740);assert.equal(tubs[0].x+775,6400);assert.equal(tubs[0].y+370,520);
 assert.equal(tubs[0].sourceFixtureMapping.heightProvenance,'catalogue-display-default');assert.equal(tubs[0].sourceFixtureMapping.heightMm,600);
 assert.equal(JSON.stringify(body.sourceLocal),before);assert.equal(c.DATA.sceneReconstructionReports[0].fixtureDecisions.length,1);
 assert.equal(JSON.parse(c.HISTORY[0]).items.length,0);assert.equal(c.DATA.items.some(i=>/^stair/.test(i.type)),false);
});
test('unselected and ambiguous bathtub symbol mappings never silently replace or duplicate equipment',async()=>{
 const {c,body}=await setup();const mapped=c.PlanImport.mapReviewedFixtures(body.buildingCompilation.plan,body);
 assert.equal(mapped.items.filter(i=>i.type==='bath').length,1);assert.equal(mapped.items.some(i=>i.type==='original-bathtub'),false);
 const other=JSON.parse(JSON.stringify(body));other.sourceLocal.marks.push(JSON.parse(JSON.stringify(other.sourceLocal.marks.find(m=>m.guess==='bathtub'))));
 assert.equal(c.PlanImport.bathtubCandidates(other).length,0);
});
test('stale source or registration fixture choices cannot alter DATA/history/IDs',async()=>{
 const {c,doc,body}=await setup();doc.querySelector('[data-source-bathtub]').click();body.fixtureDecisions[0].sourceSnapshot='stale';
 const before=JSON.stringify(c.DATA),ids=c.nextId;c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,ids);assert.equal(c.HISTORY.length,0);
 assert.match(doc.getElementById('plan-import-status').textContent,/再確認/);
});
test('entry step is an explicit app display assumption, separate from source level and ordinary floor',async()=>{
 const {c,doc,body}=await setup(),source=JSON.stringify(body.sourceLocal);
 doc.querySelector('[data-source-entry-floor]').click();c.applyPlanImport();
 const entry=c.DATA.rooms.find(r=>r.use==='entry'),ordinary=c.DATA.rooms.find(r=>r.floor===1&&r.use!=='entry');
 assert.equal(entry.floorRaiseMm,0);assert.equal(entry.floorMaterial,'tile_floor');assert.equal(entry.sourceRoomMapping.measured,false);
 assert.equal(entry.sourceRoomMapping.provenance,'user-reviewed-app-display-assumption');assert.equal(ordinary.floorRaiseMm,150);
 assert.equal(JSON.stringify(body.sourceLocal),source);assert.equal(c.DATA.sceneReconstructionReports[0].entryFloorDecisions.length,1);
});
test('unselected entry assumption and changed target height cannot silently lower the floor',async()=>{
 const {c,doc,body}=await setup();assert.equal(c.PlanImport.entryFloorCandidates(body).length,1);
 const plain=c.PlanImport.toAppObjects(body.buildingCompilation.plan);assert.equal(plain.rooms.find(r=>r.use==='entry').floorRaiseMm,150);
 doc.querySelector('[data-source-entry-floor]').click();body.entryFloorDecisions[0].ordinaryRaiseMm=99;
 const before=JSON.stringify(c.DATA),ids=c.nextId;c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),before);assert.equal(c.nextId,ids);assert.equal(c.HISTORY.length,0);assert.match(doc.getElementById('plan-import-status').textContent,/再確認/);
});

test('actual history functions restore both reviewed mappings and immutable source through JSON storage roundtrip',async()=>{
 const {c,doc,body}=await setup(),vm=require('node:vm'),{topLevelFunction}=require('./height-runtime.cjs');
 Object.assign(c,{REDO_HISTORY:[],HISTORY_LIMIT:100,DRAG:{active:false},ren:null,
 syncNorthFromPlan(){},ensureFloorMetadata(){},clearMultiSelection(){},sharedForceFullSync(){},markDirty(){},draw2d(){},sharedRememberEditTargets(){}});
 for(const name of ['serializeDataSnapshot','pushHistorySnapshot','saveState','restoreHistorySnapshot','undoAction','redoAction'])vm.runInContext(topLevelFunction(name),c);
 const source=JSON.stringify(body.sourceLocal),prior=c.serializeDataSnapshot();
 doc.querySelector('[data-source-bathtub]').click();doc.querySelector('[data-source-entry-floor]').click();c.applyPlanImport();
 const applied=c.serializeDataSnapshot();
 // The app serializes DATA as JSON for local storage. Exercise that boundary without claiming browser storage/UI coverage.
 c.DATA=JSON.parse(applied);
 assert.equal(c.DATA.items.find(i=>i.type==='original-bathtub').sourceFixtureMapping.heightProvenance,'catalogue-display-default');
 assert.equal(c.DATA.rooms.find(r=>r.use==='entry').sourceRoomMapping.measured,false);
 assert.equal(c.DATA.sceneReconstructionReports[0].fixtureDecisions.length,1);
 assert.equal(c.DATA.sceneReconstructionReports[0].entryFloorDecisions.length,1);
 c.undoAction();assert.equal(c.serializeDataSnapshot(),prior);
 c.redoAction();assert.equal(c.serializeDataSnapshot(),applied);
 assert.equal(JSON.stringify(body.sourceLocal),source);
});
test('anchor edits invalidate bath/entry choices and allow deselection or fresh selection after re-review',async()=>{
 const {c,doc,body}=await setup();const source=JSON.stringify(body.sourceLocal);
 doc.querySelector('[data-source-bathtub]').click();doc.querySelector('[data-source-entry-floor]').click();
 for(const floor of [1,2,3]){
  const group=doc.querySelector('details[data-building-floor="'+floor+'"]');
  for(const input of group.querySelectorAll('[data-building-anchor]'))if(input.getAttribute('data-building-anchor').endsWith(':building.x')){input.value=String(Number(input.value)+100);input.dispatchEvent({type:'input'});}
  doc.querySelector('details[data-building-floor="'+floor+'"]').querySelector('[data-building-confirm]').click();
 }
 for(const floor of [1,2,3]){const group=doc.querySelector('details[data-building-floor="'+floor+'"]');if(!group.querySelector('[data-building-identity]').checked)group.querySelector('[data-building-identity]').click();group.querySelector('[data-building-identity-evidence]').value='Test-only title re-confirmation';group.querySelector('[data-building-confirm]').click();}
 doc.querySelector('[data-building-partial]').click();
 assert.equal(body.fixtureDecisions.length,0);assert.equal(body.entryFloorDecisions.length,0);
 assert.match(body.fixtureReviewNotice,/再確認/);assert.equal(doc.querySelector('[data-source-entry-floor]').checked,false);
 const entry=doc.querySelector('[data-source-entry-floor]');entry.click();assert.equal(body.entryFloorDecisions.length,1);entry.click();assert.equal(body.entryFloorDecisions.length,0);
 entry.click();doc.querySelector('[data-source-bathtub]').click();c.applyPlanImport();
 assert.ok(c.DATA.rooms.length,doc.getElementById('plan-import-status').textContent+' '+JSON.stringify(body.buildingCompilation.diagnostics));
 assert.equal(c.DATA.rooms.find(r=>r.use==='entry').floorRaiseMm,0);assert.equal(c.DATA.items.filter(i=>i.type==='original-bathtub').length,1);
 assert.equal(JSON.stringify(body.sourceLocal),source);
});
test('cabinet source symbol becomes exactly one reviewed low storage asset without selecting TV or closet rooms',async()=>{const {c,doc,body}=await setup(),source=JSON.stringify(body.sourceLocal),asset='im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown';const candidates=c.PlanImport.buildingObjectCandidates(body),cab=candidates.find(v=>v.semantic==='cabinet');assert.ok(cab);assert.equal(candidates.some(v=>v.semantic==='tv'||v.semantic==='closet'),false);assert.equal(cab.models[0].id,asset);assert.equal(cab.models[0].h,600);assert.equal(cab.models[0].front,'+Z');const select=doc.querySelector('[data-source-object="'+cab.id+'"]');select.value=asset;select.dispatchEvent({type:'change'});c.applyPlanImport();const it=c.DATA.items.filter(i=>i.type===asset);assert.equal(it.length,1);assert.deepEqual([it[0].floor,it[0].x+it[0].w/2,it[0].y+it[0].d/2,it[0].w,it[0].d,it[0].rot],[2,3850,2910,1480,470,0]);assert.equal(it[0].sourceObjectMapping.assumptions.find(a=>a.field==='heightMm').value,600);assert.equal(it[0].sourceObjectMapping.catalogueDisplay.front,'+Z');assert.equal(JSON.stringify(body.sourceLocal),source);assert.ok(it[0].sourceObjectMapping.editorDisplayBaseline);});
test('existing represented cabinet and duplicate decisions cannot create repeated objects; stale source/catalogue rejects before DATA writes',async()=>{const asset='im0261-Cabinet-MEGA_PACK_CABINET-cabinet-354290_frame_walnut_brown';for(const corrupt of [d=>d.sourceSnapshot='old',d=>d.catalogueSnapshot='old',d=>d.entitySnapshot='old',(_,body)=>body.objectDecisions.push({...body.objectDecisions[0]})]){const {c,doc,body}=await setup(),cab=c.PlanImport.buildingObjectCandidates(body).find(v=>v.semantic==='cabinet'),select=doc.querySelector('[data-source-object="'+cab.id+'"]');select.value=asset;select.dispatchEvent({type:'change'});corrupt(body.objectDecisions[0],body);const data=JSON.stringify(c.DATA),ids=c.nextId;c.applyPlanImport();assert.equal(JSON.stringify(c.DATA),data);assert.equal(c.nextId,ids);assert.equal(c.HISTORY.length,0);}const {c,body}=await setup(),mark=body.sourceLocal.marks.find(m=>m.guess==='cabinet');body.sourceLocal.items.push({...mark,type:asset});assert.equal(c.PlanImport.buildingObjectCandidates(body).some(v=>v.semantic==='cabinet'),false);});

test('ambiguous duplicate cabinet marks offer no model instead of making duplicate furniture',async()=>{const {c,body}=await setup(),mark=body.sourceLocal.marks.find(m=>m.guess==='cabinet');body.sourceLocal.marks.push(JSON.parse(JSON.stringify(mark)));assert.equal(c.PlanImport.buildingObjectCandidates(body).some(v=>v.semantic==='cabinet'),false);});
test('same cabinet envelope with absent versus explicit rotation remains ambiguous and offers no duplicate choices',async()=>{const {c,body}=await setup(),mark=body.sourceLocal.marks.find(m=>m.guess==='cabinet');for(const rot of [0,90,180]){const clone=JSON.parse(JSON.stringify(body));clone.sourceLocal.marks.push({...mark,rot});assert.equal(c.PlanImport.buildingObjectCandidates(clone).some(v=>v.semantic==='cabinet'),false);}});
