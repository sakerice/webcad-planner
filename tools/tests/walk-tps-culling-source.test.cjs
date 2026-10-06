'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {topLevelFunction}=require('./height-runtime.cjs');
const root=path.join(__dirname,'../..'),three=import('../../assets/vendor/three/build/three.module.js');
function finiteNumbers(value){
 if(typeof value==='number')assert.ok(Number.isFinite(value),'runtime values stay finite');
 else if(value&&typeof value==='object')for(const child of Object.values(value))finiteNumbers(child);
}
async function host(activate=true){
 const T=await three,noop=()=>{},upstairs={id:'anonymous-upstairs',type:'fmp-chair',floor:2,x:8000,y:8000,w:500,d:500};
 const c={console,THREE:T,WalkTpsFoundation:require('../../assets/js/walk-tps-foundation.js'),WalkTpsBoundary:require('../../assets/js/walk-tps-boundary.js'),WalkTpsMeshVolumes:require('../../assets/js/walk-tps-mesh-volumes.js'),RoomGeometry:require('../../assets/js/room-geometry.js'),U:.001,
  DATA:{walls:[],items:[upstairs],rooms:[{id:'anonymous-room',floor:1,x:0,y:0,w:10000,d:10000}]},ST:{floor:1,view:'3d-walk'},WALK:{active:true,floor:1,x:5,z:5,yaw:0,pitch:0,groundOff:0,keys:{}},iMov:{},
  sc3:new T.Scene(),camExt:new T.PerspectiveCamera(68,1,.1,100),_tablet3DRebuildQueued:false,_walkCullApplied:false,
  floorTopY:()=>0,roomFloorTopY:()=>0,floorBaseY:()=>0,roomCeilingHeightM:()=>3,roomFloorAt:()=>0,roomIsVoidCeiling:()=>false,roomCeilingProfile:()=>null,
  hasPendingGltfModels:()=>false,isWalkView:()=>true,walkStairSampleAt:()=>null,walkLevelStairGroundAt:()=>null,walkSpawnObstructed:()=>false,walkSpawnClearNear:()=>null,isStairPartType:()=>false,
  walkUpdateGround:noop,walkApplyFpsCamera:noop,invalidate3D:noop,updateWalkEyePresetButton:noop,addEventListener:noop,removeEventListener:noop,isOpeningItemType:()=>false,isContextExteriorItemType:()=>false,
  document:{getElementById:()=>({setAttribute:noop,style:{}})}};
 const instance=new T.InstancedMesh(new T.BoxGeometry(.5,.5,.5),new T.MeshStandardMaterial(),1),source=new T.Matrix4().makeTranslation(8,4,8);
 instance.setMatrixAt(0,source);instance.userData={b:true,selectKind:'item',instanceRefs:[upstairs],instanceBaseMatrices:[source]};c.sc3.add(instance);
 c.window=c;vm.createContext(c);
 for(const file of ['walk-tps-avatar.js','walk-tps.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),c);
 vm.runInContext(['walkCullSkipType','applyWalkCulling','clearWalkCulling'].map(topLevelFunction).join('\n'),c);
 function collect(){c.WalkTps.invalidate();c.WalkTps.update(.016);const result=c.WalkTps.debug();finiteNumbers(result.output);return result;}
 if(activate)c.WalkTps.setMode('tps');return {T,c,instance,source,collect};
}
test('actual multi-floor render culling preserves the verified physical TPS scene and restores rendering',async()=>{
 const h=await host(),before=h.c.WalkTps.debug();assert.equal(before.sceneReady,true);assert.equal(before.output.camera.verified,true);
 h.c.applyWalkCulling();const rendered=new h.T.Matrix4();h.instance.getMatrixAt(0,rendered);assert.equal(rendered.determinant(),0);
 assert.equal(h.instance.userData.instanceWalkVisible[0],false);const culled=h.collect();
 assert.equal(culled.sceneReady,true);assert.equal(culled.output.camera.verified,true);assert.equal(culled.boxes,before.boxes,'culled furniture remains a physical solid');
 assert.deepEqual(h.source.elements,new h.T.Matrix4().makeTranslation(8,4,8).elements,'collection never changes the immutable source matrix');
 h.c.clearWalkCulling();h.instance.getMatrixAt(0,rendered);assert.ok(rendered.equals(h.source));assert.equal(h.collect().sceneReady,true);
});
test('FPS culling before selecting TPS follows the same verified source path',async()=>{
 const h=await host(false);h.c.applyWalkCulling();h.c.WalkTps.setMode('tps');
 assert.equal(h.c.WalkTps.debug().sceneReady,true);assert.equal(h.c.WalkTps.debug().output.camera.verified,true);
});
test('zero scale without the actual culling state fails closed',async()=>{
 const h=await host();h.instance.setMatrixAt(0,new h.T.Matrix4().makeScale(0,0,0));const result=h.collect();
 assert.equal(result.sceneReady,false);assert.equal(result.output.camera.verified,false);
});
test('culled instances with missing, singular or non-finite physical source transforms fail closed',async()=>{
 for(const kind of ['missing','singular','non-finite']){
  const h=await host();h.c.applyWalkCulling();
  if(kind==='missing')h.instance.userData.instanceBaseMatrices=[];
  else if(kind==='singular')h.source.makeScale(0,1,1);
  else h.source.elements[12]=NaN;
  const result=h.collect();assert.equal(result.sceneReady,false,kind);assert.equal(result.output.camera.verified,false,kind);
 }
});
test('a malformed live matrix cannot borrow a valid source merely by claiming it was culled',async()=>{
 const h=await host();h.c.applyWalkCulling();const broken=new h.T.Matrix4();broken.elements[0]=NaN;h.instance.setMatrixAt(0,broken);
 assert.equal(h.collect().sceneReady,false);
});
test('non-finite parent transforms and source geometry remain fail closed under normal culling',async()=>{
 for(const kind of ['parent','geometry']){
  const h=await host();h.c.applyWalkCulling();
  if(kind==='parent'){h.instance.matrixAutoUpdate=false;h.instance.matrix.elements[12]=Infinity;}
  else {h.instance.geometry.boundingBox=null;h.instance.geometry.attributes.position.array[0]=NaN;}
  assert.equal(h.collect().sceneReady,false,kind);
 }
});
