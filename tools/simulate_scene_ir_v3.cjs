// Local verification harness only. Simulated decisions are never product/user approvals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {runtime}=require('./tests/scene-fixtures.cjs'),{makeCtx}=require('./tests/height-runtime.cjs');
const Geometry=require('../assets/js/room-geometry.js'),Schema=require('../assets/js/plan-schema.js');
const [rawPath,decisionPath,outDir]=process.argv.slice(2);
if(!rawPath||!decisionPath||!outDir)throw Error('Usage: node tools/simulate_scene_ir_v3.cjs raw.json test-decisions.json output-directory');
const raw=fs.readFileSync(rawPath),scene=JSON.parse(raw),packet=JSON.parse(fs.readFileSync(decisionPath));
assert.equal(packet.simulationOnly,true);assert.equal(packet.notUserApproval,true);
const hash=crypto.createHash('sha256').update(raw).digest('hex');assert.equal(hash,packet.sourceSha256);
const c=runtime();c.RoomGeometry=Geometry;c.CONTEXT_CAR_GLB='assets/models/refined/precision_car_v1.glb';
const options=packet.options,initial=c.PlanImport.previewSceneIR(scene,options);
// This assertion step deliberately simulates accepting all review groups in an isolated VM.
options.acceptedReviewGroups=initial.reviewGroups.map(g=>g.id);options.reviewedEntities=Object.fromEntries(initial.reviewGroups.map(g=>[g.entityId,g.reviewKey]));
const compiled=c.PlanImport.stageSceneIR(scene,options);assert.equal(compiled.canApply,true,JSON.stringify(compiled.diagnostics.filter(d=>d.severity==='error')));
assert.equal(c.DATA.rooms.length,0);c.applyPlanImport();assert.equal(c.HISTORY.length,1);
const loaded=Schema.normalizePlan(JSON.parse(JSON.stringify(c.DATA))),validation=Schema.validatePlan(loaded);
assert.equal(validation.ok,true,JSON.stringify(validation));
const report=loaded.sceneReconstructionReports[0];assert.deepEqual(report.originalIR,scene);
const h=makeCtx(loaded);h.RoomGeometry=Geometry;
const result={simulationOnly:true,notUserApproval:true,sourceSha256:hash,canApply:compiled.canApply,status:compiled.reconstructionStatus,validation,counts:{rooms:loaded.rooms.length,walls:loaded.walls.length,items:loaded.items.length,undoEntries:c.HISTORY.length},sourceIdMap:report.sourceIdMap,rooms:loaded.rooms.map(r=>({id:r.id,name:r.n,shape:r.shape,areaMm2:Geometry.area(r),floorRaiseMm:r.floorRaiseMm,actualFloorTopM:h.roomFloorTopY(r),floorModuleMm:r.floorModuleMm,floorColor:r.floorColor,floorDiagramPattern:r.floorDiagramPattern})),items:loaded.items.map(i=>({id:i.id,type:i.type,x:i.x,y:i.y,w:i.w,d:i.d,rot:i.rot,color:i.color,finishColors:i.finishColors,openingSourceGeometry:i.openingSourceGeometry})),unmatchedSourceRegions:compiled.unmatchedSourceRegions||[],sourceOnlySites:scene.siteRegions.map(e=>({id:e.id,role:e.role.value,representation:'read-only-2d-overlay'})),sourceRawUnchanged:true,sharedRelease:'local-only; mixed-version shared-client negotiation absent',browserVisualQA:'not performed; verified environment access block'};
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex'),hash);
fs.mkdirSync(outDir,{recursive:true});
for(const [name,value] of [['full-fixture-test-lifecycle.json',result],['full-fixture-test-applied-plan.json',loaded],['full-fixture-test-mapped-compiler.json',compiled],['full-fixture-test-decisions.json',{...packet,options}]])fs.writeFileSync(path.join(outDir,name),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({canApply:result.canApply,status:result.status,counts:result.counts,sourceRawUnchanged:true,unmatchedSourceRegions:result.unmatchedSourceRegions},null,2));
