/* Offline evidence inventory; never calls extraction or authorizes a binding. */
const fs=require('node:fs'),crypto=require('node:crypto');
const {runtime}=require('./tests/scene-fixtures.cjs');
const Scene=require('../assets/js/scene-ir-v3.js');
const file=process.argv[2];if(!file)throw Error('Usage: node tools/audit_scene_source.cjs source.json');
const raw=fs.readFileSync(file),source=JSON.parse(raw),c=runtime(),registry=c.PlanImport.sceneCatalogue();
const compilation=c.PlanImport.previewSceneIR(source,{materialization:'bounded-v3',registry});
const counts={};for(const d of compilation.diagnostics){const key=d.severity+':'+d.code;counts[key]=(counts[key]||0)+1;}
const groups=compilation.reviewGroups.filter(g=>g.diagnostics.some(d=>d.severity==='error')).map(g=>{
 const sourceEntity=source[g.collection]?.find(e=>e.id===g.entityId);
 const candidates=g.collection==='objects'?c.PlanImport.sceneMappingCandidates(sourceEntity,registry):null;
 return {id:g.entityId,collection:g.collection,path:g.path,errors:g.diagnostics.filter(d=>d.severity==='error'),
  offeredCatalogueIds:candidates?.candidates.map(m=>m.id)||[],candidateAbsenceReason:candidates&&!candidates.candidates.length?candidates.reason:null,
  evidence:g.evidence,source:sourceEntity};
});
console.log(JSON.stringify({sourceFile:file,rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),sourceHash:Scene.sourceHash(source),
 context:'Unmodified source, no user bindings or approvals; existing Node runtime catalogue and explicit test target datum. Not actual renderer QA.',
 target:c.DATA,canApply:compilation.canApply,fullReconstructionReady:compilation.fullReconstructionReady,
 errorCount:compilation.diagnostics.filter(d=>d.severity==='error').length,unresolvedEntityCount:compilation.unresolvedEntities.length,
 counts,groups,unresolved:compilation.unresolvedEntities,paidCalls:0},null,2));
