'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runtime}=require('./asset-pack-footprint-runtime.cjs');
const sourceId='fmp-Chair07',equalId='im0261-Chair-MEGA_PACK_Chair-chair-230409_frame_walnut';
const plan=(type=sourceId,raw={})=>({walls:[],rooms:[],items:[{id:'nullable-footprint',type,x:100,y:200,rot:37,floor:2,finishColors:{unknown:'#123456'},opaque:{nested:[1,2]},...raw}],opaqueRoot:{keep:true}});
const plain=value=>JSON.parse(JSON.stringify(value));
function preview(r,p,extra={}){return r.converter.preview(p,{approvedIndexes:[0],resolvedDimensions:p.items.map(r.dimensions),...extra});}
function fitted(r,result){assert.equal(result.changed,1);const measurement=r.measure(result.plan.items[0]);for(const mode of ['clone','instance'])for(const key of ['w','d','h'])assert.ok(Math.abs(measurement[mode][key]-result.rows[0].dimensions[key])<.001,JSON.stringify({mode,key,measurement,approved:result.rows[0].dimensions}));return measurement;}

test('all 22 exact conversion targets have geometry-checked native RPG manifest bounds and unchanged identities',async()=>{
 const r=await runtime(),ids=[...new Set(r.contract.mappings.map(row=>row.targetId))];assert.equal(r.THREE.REVISION,'169');assert.equal(r.contract.mappings.length,328);assert.equal(ids.length,22);
 const archived=new Map(r.read('assets/models/packs/rpg-mansion-contract/v0.1.0/asset-geometry.json').items.map(row=>[row.assetId,row]));
 for(const id of ids){
  const asset=r.assets.get(id);assert.equal(asset.packId,'rpg-mansion');assert.equal(asset.model,'assets/models/packs/rpg-mansion/models/'+id+'.glb');
  const bytes=fs.readFileSync(path.join(r.ROOT,asset.model)),sha=crypto.createHash('sha256').update(bytes).digest('hex'),validation=r.read(asset.validation);
  if(archived.has(id))assert.equal(archived.get(id).assetRevision,'sha256:'+sha);else assert.equal(validation.glb_sha256,sha);
  const native=r.ctx.getGltfNativeBox(asset.model).getSize(new r.THREE.Vector3());for(const [key,axis] of [['w','x'],['d','z'],['h','y']])assert.ok(Math.abs(native[axis]*1000-asset[key])<.001,id+' '+key);
 }
});
test('both and asymmetric explicit null width/depth mismatches are held with an explanatory reason and identical raw JSON',async()=>{
 const r=await runtime();for(const raw of [{w:null,d:null,h:null},{w:null,d:507,h:null},{w:392,d:null,h:null}]){
  const p=plan(sourceId,raw),before=JSON.stringify(p),result=preview(r,p);assert.equal(result.changed,0);assert.equal(result.rows[0].canSelect,false);assert.match(result.rows[0].reason,/幅・奥行.*一致しない/);assert.equal(JSON.stringify(result.plan),before);assert.equal(JSON.stringify(p),before);
  // Sensitivity: the unchanged native fitters leave null axes at target-native
  // size. The converter must reject that proposed footprint, not rewrite it.
  const rejected={...p.items[0],type:'rpg-mansion-chair-01',assetPackConversion:{version:2,mappingVersion:r.contract.revision,sourceType:sourceId,targetType:'rpg-mansion-chair-01',heightPolicy:'preserve-effective-height-v1',sourceEffectiveHeightMm:703,renderHeightMm:703}},measured=r.measure(rejected);
  for(const mode of ['clone','instance']){if(raw.w===null)assert.ok(Math.abs(measured[mode].w-520)<.001);if(raw.d===null)assert.ok(Math.abs(measured[mode].d-550)<.001);assert.ok(Math.abs(measured[mode].h-703)<.001);}
  assert.deepEqual(measured.pose,{x:100+(raw.w||0)/2,y:200+(raw.d||0)/2,rot:37,wallInfo:null});
 }
});
test('numeric and absent footprint dimensions fit both native paths while null height and display pose preserve established semantics',async()=>{
 const r=await runtime();for(const raw of [{w:392,d:507,h:null},{h:null},{w:undefined,d:undefined,h:null}]){
  const p=plan(sourceId,raw),before=JSON.stringify(p),result=preview(r,p),measured=fitted(r,result),item=result.plan.items[0];assert.equal(JSON.stringify(p),before);assert.equal(item.w,392);assert.equal(item.d,507);assert.equal(item.h,null);assert.equal(measured.effectiveHeight,703);assert.deepEqual(measured.pose,{x:296,y:453.5,rot:37,wallInfo:null});assert.deepEqual(item.opaque,p.items[0].opaque);assert.deepEqual(item.finishColors,p.items[0].finishColors);
 }
});
test('equal nullable target fallback passes Float32 bounds tolerance without rewriting raw axes or nullable height',async()=>{
 const r=await runtime(),p=plan(equalId,{w:null,d:430,h:null}),before=JSON.stringify(p),result=preview(r,p),measured=fitted(r,result),item=result.plan.items[0];assert.equal(JSON.stringify(p),before);assert.equal(item.w,null);assert.equal(item.d,430);assert.equal(item.h,null);assert.equal(measured.effectiveHeight,730);assert.deepEqual(result.rows[0].dimensions,{w:520,d:430,h:730});assert.deepEqual(measured.pose,{x:100,y:415,rot:37,wallInfo:null});
 const restored=plain(result.plan);assert.deepEqual(restored,result.plan);fitted(r,preview(r,p));assert.deepEqual(preview(r,restored).plan,restored);
 assert.equal(preview(r,p,{resolvedDimensions:[{w:520.0005,d:430,h:730}]}).changed,1);assert.equal(preview(r,p,{resolvedDimensions:[{w:520.002,d:430,h:730}]}).changed,0);
});
test('equal nullable depth is also allowed while the numeric width is fitted independently',async()=>{
 const r=await runtime(),id='im0261-Table-MEGA_PACK_Table-table-86358_frame_travertino_a600',p=plan(id,{w:600,d:null,h:null}),before=JSON.stringify(p),result=preview(r,p),measurement=fitted(r,result);assert.equal(JSON.stringify(p),before);assert.equal(result.plan.items[0].d,null);assert.equal(result.plan.items[0].w,600);assert.equal(result.plan.items[0].h,null);assert.equal(measurement.effectiveHeight,360);assert.deepEqual(measurement.pose,{x:400,y:200,rot:37,wallInfo:null});
});
test('nullable original/native return fallbacks are held unless established; numeric return and null-height provenance remain unchanged',async()=>{
 const r=await runtime(),nullable=preview(r,plan(equalId,{w:null,d:430,h:null})).plan;
 const options={targetPack:'japanese-standard',approvedIndexes:[0],resolvedDimensions:[{w:520,d:430,h:730}],resolvedTargetHeights:[730]};
 const held=r.converter.preview(nullable,options);assert.equal(held.changed,0);assert.equal(held.rows[0].canSelect,false);assert.match(held.rows[0].reason,/標準寸法を確認できない/);assert.deepEqual(held.plan,nullable);
 const numeric=preview(r,plan(equalId,{w:520,d:430,h:null})).plan,back=r.converter.preview(plain(numeric),options);assert.equal(back.changed,1);assert.equal(back.plan.items[0].type,equalId);assert.equal(back.plan.items[0].h,null);assert.deepEqual(back.plan.items[0].assetPackConversion,numeric.items[0].assetPackConversion);fitted(r,preview(r,back.plan));
 const native={...nullable.items[0],assetPackConversion:{...nullable.items[0].assetPackConversion,sourceType:'chair',sourceEffectiveHeightMm:703,renderHeightMm:703}},nativePlan={walls:[],rooms:[],items:[native]};
 const nativeOptions={...options,resolvedDimensions:[{w:520,d:430,h:703}],resolvedTargetHeights:[703],resolvedTargets:[{id:'chair',w:520,d:430,h:703}]};const retained=r.converter.preview(nativePlan,nativeOptions);assert.equal(retained.changed,0);assert.match(retained.rows[0].reason,/標準寸法を確認できない/);assert.deepEqual(retained.plan,nativePlan);
});
test('invalid nonnumeric axes and unverifiable target descriptors fail closed without mutation',async()=>{
 const r=await runtime();for(const value of ['392',false,true,[],{},0,-1]){const p=plan(sourceId,{w:value,d:507,h:null}),before=JSON.stringify(p),result=preview(r,p);assert.equal(result.changed,0);assert.equal(result.rows[0].canSelect,false);assert.equal(JSON.stringify(result.plan),before);assert.equal(JSON.stringify(p),before);}
 const assets=[...r.assets.values()].map(a=>a.id==='rpg-mansion-chair-01'?{...a,packId:'unverified'}:a),converter=r.core.createConverter(r.contract,assets),p=plan(equalId,{w:null,d:430,h:null}),result=converter.preview(p,{approvedIndexes:[0],resolvedDimensions:[{w:520,d:430,h:730}]});assert.equal(result.changed,0);assert.match(result.rows[0].reason,/標準寸法を確認できない/);assert.deepEqual(result.plan,p);
});
