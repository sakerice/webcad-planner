const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const Catalogue=require('../../assets/js/scene-catalogue.js'),V3=require('../../assets/js/scene-ir-v3.js');
const {runtime}=require('./scene-fixtures.cjs');
const raw=fs.readFileSync('local-preview/frozen-page-2.json'),source=JSON.parse(raw),f=value=>({value,status:'inferred',source:'offline regression binding',reason:'Test-only choice, not user approval'});
function options(){return {materialization:'bounded-v3',partialSelection:V3.createPartialSelection(source,['obj-refrigerator'],true),bindingDecisions:['obj-refrigerator','room-ldk'].map(id=>({sourceSnapshot:JSON.stringify([...source.objects,...source.rooms].find(e=>e.id===id)),binding:{id:'regression-'+id,sourceEntityId:id,catalogId:id==='room-ldk'?{value:null,status:'unknown'}:f('fmp-Refrigerator01'),sizingPolicy:id==='room-ldk'?'native':'fit-source',appearanceMode:'match-diagram-appearance'}}))};}
test('exact native refrigerator certificate preserves dimensions, distinguishes single appliance and pins asset bytes',()=>{
 const cert=Catalogue.refrigeratorCertificate,c=runtime().PlanImport.sceneCatalogue(),m=c.get(cert.id);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(cert.url)).digest('hex'),cert.sha256);
 assert.deepEqual([m.w,m.d,m.h],[706,749,1514]);assert.equal(m.front,'+Z');assert.equal(m.frontAudit.assetSha256,cert.sha256);
 assert.equal(m.semanticExtent,'asset','Preserve old asset-scoped callers');
 assert.equal(Catalogue.supportsSemanticExtent(m,'individual-fixture'),true);assert.equal(Catalogue.supportsSemanticExtent(m,'room-assembly'),false);assert.equal(Catalogue.supportsSemanticExtent(m,'symbol-only'),false);
 assert.equal(c.get('fmp-Refrigerator02').front,null);assert.equal(Catalogue.supportsSemanticExtent(c.get('fmp-Refrigerator02'),'individual-fixture'),false);
});
test('replacement model or dimensions cannot inherit audited fridge front and extent by ID alone',()=>{
 const original=runtime().FMP_ITEMS['fmp-Refrigerator01'];
 const conflict=Catalogue.create({items:{[original.id]:{...original,front:'-Z'}}}).get(original.id);assert.equal(conflict.front,'-Z');assert.equal(conflict.frontAudit,undefined);assert.equal(Catalogue.supportsSemanticExtent(conflict,'individual-fixture'),false);
 for(const edit of [{model:'assets/models/other.glb'},{w:707},{d:750},{h:1515}]){
  const m=Catalogue.create({items:{[original.id]:{...original,...edit}}}).get(original.id);
  assert.equal(m.front,null);assert.equal(m.frontAudit,undefined);assert.equal(Catalogue.supportsSemanticExtent(m,'individual-fixture'),false);
 }
});
test('unchanged real 2F source previously blocked by missing asset metadata now preserves exact world envelope and east front',()=>{
 const c=runtime(),registry=c.PlanImport.sceneCatalogue(),oldModel={...registry.get('fmp-Refrigerator01'),front:null};delete oldModel.compatibleSemanticExtents;delete oldModel.frontAudit;
 const oldRegistry={...registry,get:id=>id==='fmp-Refrigerator01'?oldModel:registry.get(id),list:()=>registry.list().map(m=>m.id==='fmp-Refrigerator01'?oldModel:m)};
 const old=c.PlanImport.previewSceneIR(source,{...options(),registry:oldRegistry});assert.equal(old.canApply,false);assert.ok(old.diagnostics.some(d=>d.code==='asset_semantic_extent'));assert.ok(old.diagnostics.some(d=>d.code==='mapping_unresolved'));assert.equal(old.plan.items.length,0);
 assert.equal(c.PlanImport.sceneMappingCandidates(source.objects[0],oldRegistry).candidates.length,0);
 assert.deepEqual(Array.from(c.PlanImport.sceneMappingCandidates(source.objects[0],registry).candidates,m=>m.id),['fmp-Refrigerator01']);
 const fresh=c.PlanImport.previewSceneIR(source,options());assert.equal(fresh.diagnostics.some(d=>d.severity==='error'),false);assert.equal(fresh.canApply,false,'Explicit fresh inference/default review still required');
 const reviewed=c.PlanImport.previewSceneIR(source,{...options(),acceptedReviewGroups:fresh.reviewGroups.map(g=>g.id),reviewedEntities:Object.fromEntries(fresh.reviewGroups.map(g=>[g.entityId,g.reviewKey]))});assert.equal(reviewed.canApply,true);assert.equal(reviewed.fullReconstructionReady,false);
 const item=reviewed.plan.items[0],angle=item.rot*Math.PI/180,points=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>({x:item.x+item.w/2+x*item.w/2*Math.cos(angle)-y*item.d/2*Math.sin(angle),y:item.y+item.d/2+x*item.w/2*Math.sin(angle)+y*item.d/2*Math.cos(angle)}));
 [Math.min(...points.map(p=>p.x)),Math.max(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.y))].forEach((v,i)=>assert.ok(Math.abs(v-[100,770,87.5,822.5][i])<1e-9));
 assert.ok(Math.abs(-Math.sin(angle)-1)<1e-10&&Math.abs(Math.cos(angle))<1e-10);assert.equal(item.floor,2);assert.deepEqual(item.finishColors,{body:'#D4D5D0'});assert.equal(item.h,undefined);assert.equal(source.objects[0].heightMm.status,'unknown');
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c');assert.equal(JSON.stringify(source),JSON.stringify(JSON.parse(raw)));
 assert.ok(reviewed.defaults.some(d=>d.path==='objects[0].heightMm'&&d.value===1514));
});
test('new metadata never removes full-source door/stair failures or source contradictions',()=>{
 const c=runtime(),opts=options();delete opts.partialSelection;const full=c.PlanImport.previewSceneIR(source,opts);
 for(const code of ['unsupported_opening_mechanism','unsupported_stair_room_floor','unsupported_stair_reconstruction','wrong_adjacent_room'])assert.ok(full.diagnostics.some(d=>d.code===code));assert.equal(full.canApply,false);
 const changed=structuredClone(source);changed.objects[0].sourceFootprint.value.center.x=10;
 const stale=c.PlanImport.previewSceneIR(changed,options());assert.equal(stale.canApply,false);assert.ok(stale.diagnostics.some(d=>d.code==='stale_binding_decision'||d.code==='stale_partial_selection'));
});

test('v2 direct import keeps legacy asset scope and accepts only the newly audited single-fixture scope',()=>{
 const {fixture,observed}=require('./scene-fixtures.cjs'),c=runtime();
 for(const extent of ['asset','individual-fixture','room-assembly']){
  const s=fixture(),item={...s.furniture[0],id:'fridge',catalogId:observed('fmp-Refrigerator01'),sizeMm:observed({w:706,d:749}),semanticExtent:observed(extent)};
  delete item.finishColors;delete item.finishTextures;delete item.finishRoughness;s.furniture=[item];
  const result=c.PlanImport.previewSceneIR(s,{}),errors=result.diagnostics.filter(d=>d.severity==='error');
  if(extent==='room-assembly')assert.ok(errors.some(d=>d.code==='asset_semantic_extent'));
  else {assert.deepEqual(errors,[]);assert.ok(result.plan.items.some(i=>i.id==='fridge'&&i.type==='fmp-Refrigerator01'));}
 }
});
