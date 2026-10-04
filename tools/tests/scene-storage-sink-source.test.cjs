const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {runtime}=require('./scene-fixtures.cjs'),C=require('../../assets/js/scene-catalogue.js'),V=require('../../assets/js/scene-ir-v3.js');
const raw=fs.readFileSync('local-preview/frozen-page-2.json'),source=JSON.parse(raw),ids=['obj-west-cabinet','obj-kitchen-base','obj-tv-console','obj-kitchen-sink'];
const f=value=>({value,status:'inferred',source:'test-only separate mapping decision',reason:'Not production approval'});
function options(){return {materialization:'bounded-v3',partialSelection:V.createPartialSelection(source,ids,true),bindingDecisions:[...ids,'room-ldk'].map(id=>({sourceSnapshot:JSON.stringify([...source.objects,...source.rooms].find(e=>e.id===id)),binding:{id:'regression-'+id,sourceEntityId:id,catalogId:id==='room-ldk'?{value:null,status:'unknown'}:f(id==='obj-kitchen-sink'?C.sinkCertificate.id:C.cabinetCertificate.id),sizingPolicy:id==='room-ldk'?'native':'fit-source',appearanceMode:'match-diagram-appearance'}}))};}
test('cabinet schema vocabulary and single sink are certified only for exact unchanged assets',()=>{
 const c=runtime(),r=c.PlanImport.sceneCatalogue();
 for(const cert of [C.cabinetCertificate,C.sideboardCertificate,C.sinkCertificate]){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(cert.url)).digest('hex'),cert.sha256);
  const m=r.get(cert.id);assert.equal(m.front,cert.front);assert.deepEqual([m.w,m.d,m.h],[cert.w,cert.d,cert.h]);
  for(const patch of [{model:'other.glb'},{w:cert.w+1},{d:cert.d+1},{h:cert.h+1},{front:'-Z'}]){
   const changed=C.create({items:{[cert.id]:{...c.FMP_ITEMS[cert.id],...patch}}}).get(cert.id);
   if(cert!==C.sinkCertificate)assert.equal(C.supportsSourceObjectType(changed,'cabinet-like'),false);
   else {assert.equal(changed.frontAudit,undefined);assert.equal(C.supportsSemanticExtent(changed,'individual-fixture'),false);}
  }
 }
 assert.equal(r.get(C.cabinetCertificate.id).sourceObjectType,'cabinet','Existing vocabulary remains available');
 assert.equal(C.supportsSourceObjectType(r.get(C.cabinetCertificate.id),'cabinet-like'),true);
 assert.equal(C.supportsSemanticExtent(r.get(C.sinkCertificate.id),'individual-fixture'),true);
 assert.equal(C.supportsSemanticExtent(r.get(C.sinkCertificate.id),'room-assembly'),false);
 assert.equal(r.get('fmp-Sink02').front,null);assert.equal(r.get('fmp-Sink02').sourceObjectType,undefined);
});
test('real raw cabinet mappings become available through UI without changing source types; sink cabinet false certification is removed',()=>{
 const c=runtime(),registry=c.PlanImport.sceneCatalogue(),old={...registry,get:id=>{const m=registry.get(id);if(!m)return null;delete m.compatibleSourceObjectTypes;return m;},list:()=>registry.list().map(m=>{delete m.compatibleSourceObjectTypes;return m;})};
 for(const id of ids){const e=source.objects.find(x=>x.id===id),choices=c.PlanImport.sceneMappingCandidates(e,registry).candidates;assert.ok(choices.some(m=>m.id===(id==='obj-kitchen-sink'?C.sinkCertificate.id:C.cabinetCertificate.id)));if(id!=='obj-kitchen-sink')assert.equal(c.PlanImport.sceneMappingCandidates(e,old).candidates.length,0);}
 const bad=registry.get('fmp-CabinetA_Sink');assert.equal(bad.semanticExtent,'asset');assert.notEqual(bad.sourceObjectType,'kitchen-sink');assert.match(bad.representationLimit,/cutout/);
 const opts=options();opts.bindingDecisions.find(d=>d.binding.sourceEntityId==='obj-kitchen-sink').binding.catalogId=f('fmp-CabinetA_Sink');
 const result=c.PlanImport.previewSceneIR(source,opts);assert.ok(result.diagnostics.some(d=>d.code==='asset_semantic_type'&&d.path==='objects[3].binding'));assert.equal(result.plan.items.some(i=>i.id==='obj-kitchen-sink'),false);
});
test('four real raw source objects retain full world envelopes, fronts, colors and unknown height with explicit fresh reviews',()=>{
 const c=runtime(),before=JSON.stringify(c.DATA),opts=options(),first=c.PlanImport.previewSceneIR(source,opts);assert.deepEqual(first.diagnostics.filter(d=>d.severity==='error'),[]);assert.equal(first.canApply,false);
 const accepted={...opts,acceptedReviewGroups:first.reviewGroups.map(g=>g.id),reviewedEntities:Object.fromEntries(first.reviewGroups.map(g=>[g.entityId,g.reviewKey]))},result=c.PlanImport.previewSceneIR(source,accepted);
 assert.equal(result.canApply,true);assert.equal(result.fullReconstructionReady,false);assert.equal(result.plan.items.length,4);
 for(const item of result.plan.items){const e=source.objects.find(e=>e.id===item.id),fp=e.sourceFootprint.value,a=item.rot*Math.PI/180;assert.equal(item.x+item.w/2,fp.center.x);assert.equal(item.y+item.d/2,fp.center.y);assert.ok(Math.abs(Math.abs(item.w*Math.cos(a))+Math.abs(item.d*Math.sin(a))-fp.sizeMm.w)<1e-8);assert.ok(Math.abs(Math.abs(item.w*Math.sin(a))+Math.abs(item.d*Math.cos(a))-fp.sizeMm.d)<1e-8);assert.ok(Math.abs(-Math.sin(a)-e.frontDirection.value.x)<1e-8&&Math.abs(Math.cos(a)-e.frontDirection.value.y)<1e-8);assert.equal(item.finishColors.body,e.appearance.diagramColor.value);assert.equal(item.h,undefined);assert.equal(e.heightMm.status,'unknown');assert.ok(result.defaults.some(d=>d.path==='objects['+source.objects.indexOf(e)+'].heightMm'));}
 const stale=structuredClone(source);stale.objects[1].frontDirection.value.x=-1;assert.equal(c.PlanImport.previewSceneIR(stale,accepted).canApply,false);
 assert.equal(JSON.stringify(c.DATA),before);assert.equal(JSON.stringify(source),JSON.stringify(JSON.parse(raw)));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'c98e9213665b0527fae907a19d145d8a038db8f82bd049c57b74607add05485c');
});
test('cabinet direct/API compiler cannot bypass UI semantic type or full physical blockers',()=>{
 const c=runtime(),opts=options();opts.bindingDecisions.find(d=>d.binding.sourceEntityId==='obj-west-cabinet').binding.catalogId=f('fmp-Refrigerator01');const bad=c.PlanImport.previewSceneIR(source,opts);assert.ok(bad.diagnostics.some(d=>d.code==='asset_semantic_type'&&d.path==='objects[1].binding'));assert.equal(bad.plan.items.some(i=>i.id==='obj-west-cabinet'),false);
 const fullOpts=options();delete fullOpts.partialSelection;const full=c.PlanImport.previewSceneIR(source,fullOpts);assert.equal(full.canApply,false);for(const code of ['unsupported_opening_mechanism','unsupported_stair_reconstruction','unknown_required_geometry','wrong_adjacent_room'])assert.ok(full.diagnostics.some(d=>d.code===code));
});
