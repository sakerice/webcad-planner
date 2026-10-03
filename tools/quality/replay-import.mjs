// Replay a frozen v1 reading through an explicitly selected local checkout.
// Calls only pure finalization/conversion helpers. Never calls an AI route or Apply.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const argv=process.argv.slice(2),arg=name=>argv[argv.indexOf(name)+1];
if(!argv.includes('--repo')||!argv.includes('--input'))throw Error('Usage: node tools/quality/replay-import.mjs --repo CHECKOUT --input READING.json');
const repo=path.resolve(arg('--repo')),input=path.resolve(arg('--input'));
const bytes=fs.readFileSync(input),raw=JSON.parse(bytes),clone=v=>JSON.parse(JSON.stringify(v));
const {mergeReadPages}=await import(pathToFileURL(path.join(repo,'worker/plan-pages.mjs')));
const {finishImportedPlan}=await import(pathToFileURL(path.join(repo,'worker/routes-ai.mjs')));
let reading;
if(Array.isArray(raw.pages)){
 if(!raw.pages.length||raw.pages.some(p=>!p.reading||!Array.isArray(p.reading.floors)))throw Error('Expected pages[].reading in the declared frozen packet format');
 reading=mergeReadPages(raw.pages.map(p=>clone(p.reading)));
 // Preserve supplied wrapper page IDs as wrapper provenance only, never image hashes.
 reading.floors=reading.floors.map(f=>{const page=raw.pages.find(p=>p.reading.floors.some(v=>v.floor===f.floor));return page.sourcePageId?{...f,sourcePageId:page.sourcePageId}:f;});
 if(raw.buildingRegistration)reading.buildingRegistration=clone(raw.buildingRegistration);
}else if(Array.isArray(raw.floors)){reading=clone(raw);}
else throw Error('Unsupported input envelope. Supply the untouched declared v1 reading; no implicit repair.');
const response=finishImportedPlan(reading,null,{}),body=await response.json();
const result={kind:'offline-conversion-replay',checkout:repo,inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),status:response.status,providerCalls:0,applied:false,sourceAccuracyVerified:false,workerResult:body};
if(response.status===200){
 const require=createRequire(path.join(repo,'package.json'));
 const {runtime}=require(path.join(repo,'tools/tests/scene-fixtures.cjs'));
 const {topLevelFunction}=require(path.join(repo,'tools/tests/height-runtime.cjs'));
 const Registration=require(path.join(repo,'assets/js/plan-registration.js'));
 const c=runtime();
 result.workerObjects=c.PlanImport.toAppObjects(clone(body.plan));
 if(body.sourceLocal){
  const compiled=Registration.compile(clone(body.sourceLocal),{proposals:body.buildingRegistration});
  result.registrationCandidate={canApply:compiled.canApply,diagnostics:compiled.diagnostics,poses:compiled.poses,deferredItems:compiled.deferredItems,objects:c.PlanImport.toAppObjects(clone(compiled.plan))};
 }
 // Exercise the actual material decision function with texture/GPU construction mocked.
 // This captures selected asset names, not a claim about real WebGL appearance.
 Object.assign(c,{texTileM:()=>.9,cloneTextureWithRepeat:t=>t,pbrTex:s=>({asset:s}),pbrTexLinear:s=>({asset:s}),THREE:{Vector2:function(x,y){this.x=x;this.y=y;},MeshStandardMaterial:function(params){Object.assign(this,params);}},FLOOR_PBR_STEM:{wood_floor:'floor_wood',wood_oak:'floor_oak',tile_floor:'floor_tile'}});
 for(const name of ['roomFloorMaterialKey','defaultRoomFloorMaterialKey','makeRoomFloorMaterial']){
  try{vm.runInContext(topLevelFunction(name),c);}catch(e){if(name!=='defaultRoomFloorMaterialKey')throw e;}
 }
 const rooms=result.registrationCandidate?result.registrationCandidate.objects.rooms:result.workerObjects.rooms;
 result.floorDisplayDefaults=rooms.map(r=>{
  const material=c.makeRoomFloorMaterial(r);
  return {name:r.n,use:r.use,floor:r.floor,floorRaiseMm:r.floorRaiseMm,skipLevelMm:r.skipLevelMm??null,diffuseAsset:material.map?.asset??null,sourceMeasuredFinish:false,note:'既存描画の表示選択をCPUで評価。図面で測定した素材/段差ではなく、実画面検証も別途必要。'};
 });
}
if(JSON.stringify(raw)!==JSON.stringify(JSON.parse(bytes)))throw Error('Raw input changed');
console.log(JSON.stringify(result,null,2));
