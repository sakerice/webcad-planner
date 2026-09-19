const test=require('node:test');
const assert=require('node:assert/strict');
const {repairMaterial,prepare}=require('../../assets/js/model-quality.js');
const url='assets/models/furniture_mega/glb/Bed01.glb';
test('bedding stays matte even with a black roughness/metallic atlas',()=>{
 const m={name:'mat_Blanket',roughness:0,roughnessMap:{},metalness:1,metalnessMap:{},clearcoat:1};
 repairMaterial(m,url);assert.equal(m.roughness,.94);assert.equal(m.roughnessMap,null);assert.equal(m.metalness,0);assert.equal(m.metalnessMap,null);assert.equal(m.clearcoat,0);
});
test('mixed atlases retain texture channels and restore the zero roughness multiplier',()=>{
 const map={};const m={name:'mat_Kitchen',roughness:0,roughnessMap:map,metalness:1,metalnessMap:map};
 repairMaterial(m,url);assert.equal(m.roughness,1);assert.equal(m.roughnessMap,map);assert.equal(m.metalnessMap,map);assert.equal(m.metalness,1);
});
test('authored glass, custom models and cars are preserved',()=>{
 for(const [name,path] of [['mat_Glass',url],['mat_Blanket','assets/models/custom/a.glb'],['CarBody','assets/models/context/car_sedan.glb']]){
  const m={name,roughness:.15,metalness:.5};const original={...m};repairMaterial(m,path);delete m.needsUpdate;assert.deepEqual(m,original);
 }
});
test('source meshes are shadow enabled before they become instances; arrays are repaired',()=>{
 const mesh={isMesh:true,material:[{name:'mat_Mattress',roughness:0},{name:'mat_Blanket',roughness:0}]};
 prepare({traverse:fn=>fn(mesh)},url);assert.equal(mesh.castShadow,true);assert.equal(mesh.receiveShadow,true);assert.ok(mesh.material.every(m=>m.roughness===.94));
});
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
function loadFunction(name,sandbox){
 const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);
 vm.createContext(sandbox);vm.runInContext(html.slice(start,end),sandbox);return sandbox[name];
}
test('configured furniture cannot bypass facing/material correction when deselected',()=>{
 const sandbox={ren:{},snapCeilingFixturesToCeiling:()=>{},snapOutdoorCeilingFixturesToRoof:()=>{},ST:{selected:null},GLTF_MODEL_CONFIG:{bed:{rotY:Math.PI}}};
 const queue=loadFunction('queueFmpInstance',sandbox);
 assert.equal(queue('bed.glb',{type:'bed'},{}),false);
});
test('loading quality can return to full detail after success or failure',()=>{
 const sandbox={_modelLoading:{bed:true,car:false}};const pending=loadFunction('hasPendingGltfModels',sandbox);
 assert.equal(pending(),true);sandbox._modelLoading.bed=false;assert.equal(pending(),false);
});
test('source facing normalization is applied once before clones and instances',()=>{
 const {sourceYaw}=require('../../assets/js/model-quality.js');
 const scene={rotation:{y:0},userData:{},updateMatrixWorld(){},traverse(){}};
 prepare(scene,url);prepare(scene,url);assert.equal(scene.rotation.y,Math.PI);
 assert.equal(sourceYaw('assets/models/interior_model_0_26_1/glb/Chair/a.glb'),0);
});
test('coated refrigerator shell is not treated as bare metal',()=>{
 const m={name:'mat_Kitchen',roughness:0,roughnessMap:{},metalness:1};
 repairMaterial(m,'assets/models/furniture_mega/glb/Refrigerator01.glb');assert.equal(m.metalness,.04);assert.equal(m.roughness,1);
});
test('existing furniture preserves physical facing and migration is idempotent',()=>{
 const item={type:'fmp-Sofa01',rot:90};
 const sandbox={DATA:{items:[item]},snapCeilingFixturesToCeiling:()=>{},snapOutdoorCeilingFixturesToRoof:()=>{},ST:{selected:null},getFmpItem:()=>({category:'ソファ'}),bestFmpType:t=>t};
 const normalize=loadFunction('normalizeLegacyFurnitureItems',sandbox);
 normalize();assert.equal(item.rot,270);assert.equal(item.modelFacingVersion,1);normalize();assert.equal(item.rot,270);
});
test('car migration preserves old placement while new car assets use +Z front',()=>{
 const {sourceYaw}=require('../../assets/js/model-quality.js');assert.equal(sourceYaw('assets/models/refined/car_sedan_v3.glb'),Math.PI);
 const item={type:'car',rot:0};const s={DATA:{items:[item]},snapCeilingFixturesToCeiling:()=>{},snapOutdoorCeilingFixturesToRoof:()=>{},ST:{selected:null},getFmpItem:()=>null,bestFmpType:t=>t};
 const normalize=loadFunction('normalizeLegacyFurnitureItems',s);normalize();assert.equal(item.rot,180);normalize();assert.equal(item.rot,180);
});
test('every catalogue entry references existing 3D, thumbnail and plan assets',()=>{
 const ids=new Set();
 for(const pack of ['furniture_mega','interior_model_0_26_1','custom']){
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,`../../assets/models/${pack}/manifest.json`)));
  for(const item of data.items){assert.equal(ids.has(item.id),false);ids.add(item.id);for(const key of ['model','thumb','top'])assert.ok(fs.existsSync(path.join(__dirname,'../..',item[key])),item[key]);assert.equal(item.previewVersion,2);}
 }
 assert.ok(ids.size>=687);
});
test('precision car keeps its source attribution and native +Z front',()=>{
 const b=fs.readFileSync(path.join(__dirname,'../../assets/models/refined/precision_car_v1.glb'));const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());assert.equal(j.asset.extras.license,'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)');assert.ok(j.asset.extras.author);assert.ok(j.extensionsRequired.includes('KHR_draco_mesh_compression'));assert.equal(require('../../assets/js/model-quality.js').sourceYaw('assets/models/refined/precision_car_v1.glb'),0);assert.ok(b.length<4000000);
});
