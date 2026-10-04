/* Replay only: public retained three-page native reading, no model calls. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const R=require('../assets/js/plan-registration.js'),{runtime}=require('./tests/scene-fixtures.cjs');
const rawPath=path.join(__dirname,'tests/fixtures/registration/native-astra-three-floor.raw.json');
async function audit(){
 const bytes=fs.readFileSync(rawPath),raw=JSON.parse(bytes),snapshot=JSON.stringify(raw);
 const {mergeReadPages}=await import('../worker/plan-pages.mjs'),{finishImportedPlan}=await import('../worker/routes-ai.mjs');
 const merged=mergeReadPages(raw.pages.map(p=>p.reading));merged.floors=merged.floors.map(f=>({...f,sourcePageId:raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor)).sourcePageId}));
 const response=finishImportedPlan({...merged,buildingRegistration:raw.buildingRegistration},null,{});assert.equal(response.status,200);const body=await response.json();
 const preview=JSON.parse(fs.readFileSync(path.join(__dirname,'../local-preview/sample.json')));assert.deepEqual(preview.sourceLocal,body.sourceLocal);assert.deepEqual(preview.buildingRegistration,body.buildingRegistration);
 const rawItems=raw.pages.flatMap(p=>p.reading.floors.flatMap(f=>f.items.map(it=>({...it,floor:f.floor}))));assert.deepEqual(body.sourceLocal.items,rawItems);
 const unreviewed=R.compile(body.sourceLocal,{proposals:body.buildingRegistration});assert.equal(unreviewed.canApply,false);
 const sourceGeometryFindings=[];
 for(const item of body.sourceLocal.items.filter(i=>!/^door-|^window|^stair/.test(i.type))){
  const floor=body.sourceLocal.floors.find(f=>f.floor===item.floor),angle=(item.rot||0)*Math.PI/180,halfW=(Math.abs(Math.cos(angle))*item.w+Math.abs(Math.sin(angle))*item.d)/2,halfD=(Math.abs(Math.sin(angle))*item.w+Math.abs(Math.cos(angle))*item.d)/2;
  const overflow={westMm:Math.max(0,halfW-item.x),northMm:Math.max(0,halfD-item.y),eastMm:Math.max(0,item.x+halfW-floor.width),southMm:Math.max(0,item.y+halfD-floor.depth)};
  if(Object.values(overflow).some(v=>v>1e-7))sourceGeometryFindings.push({code:'retained_item_exceeds_source_frame',floor:item.floor,type:item.type,source:item,overflow,action:'Retain contradiction; use independently retained symbol and existing explicit replacement review if appropriate. Do not clamp or rewrite raw.'});
 }
 const decisions={sourceSnapshot:R.snapshot(body.sourceLocal),proposalSnapshot:R.snapshot(body.buildingRegistration),proposals:body.buildingRegistration,partialAcknowledged:true,floors:body.buildingRegistration.floors.map(f=>({...f,reviewed:true,identityConfirmed:true,identityEvidence:'Test-only printed-title review; not a user approval'}))};
 const reg=R.compile(body.sourceLocal,decisions);assert.equal(reg.canApply,true,JSON.stringify(reg.diagnostics));
 const c=runtime(),native=c.PlanImport.toAppObjects(reg.plan),rows=[];
 reg.plan.items.forEach((item,i)=>{
  const source=body.sourceLocal.items.filter(s=>!/^stair/.test(s.type))[i],made=native.items[i],pose=reg.poses[source.floor];
  assert.equal(pose.quarterTurns,0,'Current frozen alignment');
  const errors={centerXmm:made.x+made.w/2-source.x-pose.dx,centerYmm:made.y+made.d/2-source.y-pose.dy,widthMm:made.w-source.w,depthMm:made.d-source.d,rotationDeg:made.rot-source.rot};
  Object.values(errors).forEach(v=>assert.ok(Math.abs(v)<1e-8));rows.push({floor:source.floor,type:source.type,sourceCenter:{x:source.x,y:source.y},registeredCenter:{x:made.x+made.w/2,y:made.y+made.d/2},errors});
 });
 const floors=body.sourceLocal.floors.map(f=>{const sourceArea=f.rooms.reduce((sum,r)=>sum+r.parts.reduce((n,p)=>n+(p.x1-p.x0)*(p.y1-p.y0),0),0),renderRooms=reg.plan.rooms.filter(r=>r.floor===f.floor),area=renderRooms.reduce((n,r)=>n+r.w*r.d,0);assert.equal(area,sourceArea);return {floor:f.floor,sourcePageId:f.sourcePageId,pose:reg.poses[f.floor],sourceLogicalRooms:f.rooms.length,registeredRectangles:renderRooms.length,sourceAreaMm2:sourceArea,registeredAreaMm2:area,roomUses:renderRooms.map(r=>r.use),marks:body.sourceLocal.marks.filter(m=>m.floor===f.floor).length};});
 assert.equal(JSON.stringify(raw),snapshot);assert.equal(rows.length,35);assert.equal(reg.deferredItems.length,4);assert.deepEqual(reg.poses[3],{quarterTurns:0,dx:0,dy:455});
 const restored=R.compile(JSON.parse(JSON.stringify(body.sourceLocal)),JSON.parse(JSON.stringify(decisions)));assert.deepEqual(restored.plan,reg.plan);assert.deepEqual(restored.poses,reg.poses);
 const quarterTurnReplays=[];
 for(const q of [0,1,2,3]){
  const rotate=p=>q===0?{x:p.x,y:p.y}:q===1?{x:-p.y,y:p.x}:q===2?{x:-p.x,y:-p.y}:{x:p.y,y:-p.x};
  const global=p=>{const v=rotate(p);return {x:v.x+20000,y:v.y+30000};};
  const proposals=structuredClone(body.buildingRegistration);for(const f of proposals.floors){for(const a of f.anchors)a.building=global(a.building);for(const d of f.directions||[])d.building=rotate(d.building);}
  const opts={...decisions,proposals,proposalSnapshot:R.snapshot(proposals),floors:proposals.floors.map(f=>({...f,reviewed:true,identityConfirmed:true,identityEvidence:'Test-only globally rotated registration replay'}))};
  const replay=R.compile(body.sourceLocal,opts);assert.equal(replay.canApply,true,JSON.stringify(replay.diagnostics));const nativeReplay=c.PlanImport.toAppObjects(replay.plan);
  for(let i=0;i<reg.plan.items.length;i++){const expected=global(reg.plan.items[i]),item=nativeReplay.items[i];assert.ok(Math.abs(item.x+item.w/2-expected.x)<1e-8&&Math.abs(item.y+item.d/2-expected.y)<1e-8);assert.equal(item.w,reg.plan.items[i].w);assert.equal(item.d,reg.plan.items[i].d);assert.equal(item.rot,(reg.plan.items[i].rot+q*90)%360);}
  for(let i=0;i<reg.plan.marks.length;i++){const expected=global(reg.plan.marks[i]),mark=replay.plan.marks[i];assert.deepEqual([mark.x,mark.y,mark.w,mark.d],[expected.x,expected.y,q%2?reg.plan.marks[i].d:reg.plan.marks[i].w,q%2?reg.plan.marks[i].w:reg.plan.marks[i].d]);}
  quarterTurnReplays.push({quarterTurns:q,itemsChecked:nativeReplay.items.length,marksChecked:replay.plan.marks.length,poses:replay.poses});
 }
 assert.equal(JSON.stringify(raw),snapshot);
 return {rawSha256:crypto.createHash('sha256').update(bytes).digest('hex'),sourceUnchanged:true,previewSampleMatches:true,paidCalls:0,simulationOnly:true,notUserApproval:true,fullReconstructionReady:false,rawItems:rawItems.length,registeredItems:rows.length,deferredStairs:reg.deferredItems.length,unreviewedDiagnostics:unreviewed.diagnostics,registeredDiagnostics:reg.diagnostics,floors,quarterTurnReplays,sourceGeometryFindings,items:rows,sourceOnlyMarks:body.sourceLocal.marks,limits:['Exact transform/area preservation of retained reading, not proof of extraction accuracy','Moving-door direction absent from raw; existing display defaults are not source-verified','Room areas preserve the union but legacy route splits 19 logical rooms into 22 rectangles','Entry drop/tile module, furniture colors, floor heights and stair void not established by this raw; no inferred measurements added']};
}
module.exports={audit};if(require.main===module)audit().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
