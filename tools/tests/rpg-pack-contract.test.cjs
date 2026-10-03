'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),DIR='assets/models/packs/rpg-mansion-contract/v0.1.0/';
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p))),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex');
const geometry=read(DIR+'asset-geometry.json'),seats=read(DIR+'sit-sockets.proposal.json'),surfaces=read(DIR+'placement-surfaces.proposal.json');
const manifest=read('assets/models/packs/rpg-mansion/manifest.json'),final=read(DIR+'validation-final.json');
function glb(p){
 const b=fs.readFileSync(path.join(ROOT,p)),length=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+length)),bin=b.subarray(28+length);
 const values=i=>{const a=j.accessors[i],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3}[a.type],bytes={5126:4,5125:4,5123:2}[a.componentType],method={5126:'readFloatLE',5125:'readUInt32LE',5123:'readUInt16LE'}[a.componentType];return Array.from({length:a.count},(_,row)=>Array.from({length:n},(_,col)=>bin[method]((v.byteOffset||0)+(a.byteOffset||0)+row*(v.byteStride||n*bytes)+col*bytes)));};
 // Reviewed pack bakes all transforms. Fail rather than mis-measure if a future
 // revision adds transforms; a generalized GLTF scene evaluator is then needed.
 assert.ok(j.nodes.every(n=>!n.translation&&!n.rotation&&!n.scale&&!n.matrix));
 return {j,values};
}
function findHorizontalFaces(assetId,height,channel){
 const item=manifest.items.find(i=>i.id===assetId),{j,values}=glb(item.model),faces=[];
 for(const mesh of j.meshes)for(const prim of mesh.primitives){
  if(channel&&j.materials[prim.material].extras?.finishChannel!==channel)continue;
  const positions=values(prim.attributes.POSITION),indices=values(prim.indices).flat();
  for(let i=0;i<indices.length;i+=3){
   const p=indices.slice(i,i+3).map(k=>positions[k]);if(p.every(v=>Math.abs(v[1]-height)<1e-7))faces.push(p);
  }
 }
 return faces;
}
test('14 canonical IDs, measured bounds and revisions match delivered GLB bytes',()=>{
 assert.deepEqual(geometry.items.map(i=>i.assetId),manifest.items.map(i=>i.id));
 assert.equal(geometry.manifestSha256,hash('assets/models/packs/rpg-mansion/manifest.json'));
 for(const item of geometry.items){
  assert.equal(item.assetRevision,'sha256:'+hash(item.modelPath));assert.equal(item.sourceBlendSha256,hash(item.sourceBlend));
  const {j,values}=glb(item.modelPath),vertices=j.meshes.flatMap(m=>m.primitives.flatMap(p=>values(p.attributes.POSITION)));
  for(let k=0;k<3;k++){
   assert.ok(Math.abs(Math.min(...vertices.map(v=>v[k]))-item.measuredBoundsM.min[k])<1e-7);
   assert.ok(Math.abs(Math.max(...vertices.map(v=>v[k]))-item.measuredBoundsM.max[k])<1e-7);
  }
  assert.equal(item.finalGlbBytes,fs.statSync(path.join(ROOT,item.modelPath)).size);
  assert.deepEqual(item.front,[0,0,1]);assert.deepEqual(item.up,[0,1,0]);assert.ok(Math.abs(item.measuredBoundsM.min[1])<1e-7);
 }
});
test('corrected validation records use final post-metadata bytes; originals remain traceable',()=>{
 assert.equal(final.items.length,14);
 for(const record of final.items){const item=manifest.items.find(i=>i.id===record.model),old=read(record.reviewedValidationPath);
  assert.equal(record.glb_bytes,fs.statSync(path.join(ROOT,item.model)).size);assert.equal(record.modelSha256,hash(item.model));
  assert.equal(record.previousPreMetadataGlbBytes,old.glb_bytes);assert.ok(record.glb_bytes>old.glb_bytes);
  assert.deepEqual(record.dimensions_mm,old.dimensions_mm);assert.equal(record.triangles,old.triangles);
 }
});
test('upright chair socket is on actual exported cushion surface, not foot/root height',()=>{
 assert.equal(seats.sockets.length,1);const s=seats.sockets[0];assert.equal(s.assetId,'rpg-mansion-chair-01');
 assert.ok(Math.abs(s.localSeatSurfaceCenter[1]-.5135)<1e-7);assert.deepEqual(s.localFrontDirection,[0,0,1]);
 assert.ok(Math.abs(s.actorLocalYawRadians-Math.PI)<1e-8);assert.equal(s.localApproachFloorPoint[1],0);
 const item=geometry.items.find(i=>i.assetId===s.assetId);assert.equal(s.assetRevision,item.assetRevision);
 assert.ok(s.localApproachFloorPoint[2]>item.measuredBoundsM.max[2]);
 const faces=findHorizontalFaces(s.assetId,s.localSeatSurfaceCenter[1],'fabric');assert.ok(faces.length>=2);
 for(const p of s.evidence.verticesLocalGltfM)assert.ok(faces.flat().some(v=>v.every((x,k)=>Math.abs(x-p[k])<1e-7)));
 const area=faces.reduce((sum,[a,b,c])=>sum+Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2,0);
 assert.ok(Math.abs(area-s.evidence.surfaceAreaM2)<1e-6);
 assert.equal(item.socketIds[0],s.socketId);assert.equal(geometry.items.find(i=>i.assetId.includes('fallen-chair')).socketIds.length,0);
});
test('no geometry-only proposal grants reachability or embeds a rig pelvis offset',()=>{
 function visit(value){if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){assert.notEqual(key,'reachable');assert.notEqual(key,'pelvisOffset');assert.notEqual(key,'floor');visit(v);}}
 visit(seats);visit(surfaces);
 assert.match(seats.sockets[0].status,/host-validation-required/);
 assert.equal(seats.sockets[0].evidence.pathValidation,'not-performed');
 assert.equal(geometry.items.filter(i=>i.socketIds.length).length,1);
});
test('measured tabletop planes replace arbitrary 750mm placement guesses',()=>{
 assert.equal(surfaces.surfaces.length,2);assert.equal(surfaces.placementRules.length,4);
 for(const s of surfaces.surfaces){
  const height=s.localSurfaceCenter[1],faces=findHorizontalFaces(s.assetId,height);assert.ok(faces.length>=2);
  for(const p of s.polygonLocalGltfM)assert.ok(faces.flat().some(v=>v.every((x,k)=>Math.abs(x-p[k])<1e-7)));
  assert.ok(Math.abs(height-.75)>.02);
 }
 assert.ok(Math.abs(surfaces.surfaces.find(s=>s.assetId.includes('desk')).localSurfaceCenter[1]-.786)<1e-7);
 assert.ok(Math.abs(surfaces.surfaces.find(s=>s.assetId.includes('side-table')).localSurfaceCenter[1]-.635)<1e-7);
 for(const rule of surfaces.placementRules){assert.equal(rule.placementPolicy,'host-selected-support-surface');assert.equal(rule.assetBottomOffsetM,0);}
});
