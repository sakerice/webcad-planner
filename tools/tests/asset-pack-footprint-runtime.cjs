'use strict';
// Bounded native geometry fixture: actual uncompressed RPG POSITION buffers and
// node transforms, vendored Three, and the editor's existing fit/pose functions.
// Materials are inert; this does not exercise a browser, GPU or GLTFLoader.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {topLevelFunction}=require('./height-runtime.cjs');
const ROOT=path.resolve(__dirname,'../..'),read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p)));
function geometryScene(THREE,file){
 const b=fs.readFileSync(file);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
 const n=b.readUInt32LE(12),j=JSON.parse(b.subarray(20,20+n));assert.equal(b.readUInt32LE(16),0x4e4f534a);assert.equal(b.readUInt32LE(24+n),0x004e4942);const bin=b.subarray(28+n);
 const nodes=j.nodes.map(node=>{
  const group=new THREE.Group();if(node.matrix)group.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));else{if(node.translation)group.position.fromArray(node.translation);if(node.rotation)group.quaternion.fromArray(node.rotation);if(node.scale)group.scale.fromArray(node.scale);}
  if(node.mesh!=null)for(const primitive of j.meshes[node.mesh].primitives){
   assert.ok(!primitive.extensions?.KHR_draco_mesh_compression);const a=j.accessors[primitive.attributes.POSITION],v=j.bufferViews[a.bufferView];assert.equal(a.componentType,5126);assert.equal(a.type,'VEC3');assert.ok(v&&!a.sparse);
   const values=new Float32Array(a.count*3);for(let k=0;k<a.count;k++)for(let axis=0;axis<3;axis++)values[k*3+axis]=bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+k*(v.byteStride||12)+axis*4);
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,3));group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
  }return group;
 });
 j.nodes.forEach((node,i)=>(node.children||[]).forEach(child=>nodes[i].add(nodes[child])));const scene=new THREE.Group();for(const i of j.scenes[j.scene||0].nodes)scene.add(nodes[i]);scene.updateMatrixWorld(true);return scene;
}
let pending;
function runtime(){return pending||=build();}
async function build(){
 const THREE=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(ROOT,'assets/vendor/three/build/three.module.js')).toString('base64'));
 const assets=new Map();for(const folder of ['furniture_mega','interior_model_0_26_1','custom','packs/rpg-mansion'])for(const asset of read('assets/models/'+folder+'/manifest.json').items)assets.set(asset.id,asset);
 const core=require('../../assets/js/asset-pack-conversion.js'),contract=read('assets/models/packs/rpg-mansion/conversion-map.json'),trusted=require('../../assets/js/asset-pack-conversion-contract.js'),models={};
 for(const id of new Set(contract.mappings.map(row=>row.targetId))){const asset=assets.get(id);models[asset.model]=geometryScene(THREE,path.join(ROOT,asset.model));}
 const ctx=vm.createContext({THREE,U:.001,FMP_ITEMS:Object.fromEntries(assets),AssetPackConversion:core,AssetPackConversionContract:trusted,LEGACY_FMP_TYPE_MAP:{},ISIZES:{},_modelCache:models,_gltfNativeBoxCache:{},applySelectableColor:m=>m,tameMaterialBrightness(){},isContextExteriorItemType:()=>false,isCustomBlockType:()=>false,isLightItemType:()=>false,isColumnType:()=>false,isOpeningItemType:()=>false,balconySlabHeightMm:()=>120});
 for(const name of ['getFmpItem','isFmpItemType','bestFmpType','getItemDefaultSize','getItemH','getItemHeightValue','normalizeGltfClone','makeGltfBoxFitClone','getGltfNativeBox','computeBoxFitLocalMatrix','getItemDisplayPose'])vm.runInContext(topLevelFunction(name),ctx);
 const dimensions=item=>({...ctx.getItemDefaultSize(item.type),h:ctx.getItemHeightValue(item)}),converter=core.createConverter(contract,[...assets.values()]);
 function measure(item){
  const asset=assets.get(item.type),h=ctx.getItemHeightValue(item),clone=ctx.makeGltfBoxFitClone(asset.model,item.w*.001,h*.001,item.d*.001,null),matrix=ctx.computeBoxFitLocalMatrix(asset.model,item.w*.001,h*.001,item.d*.001);
  const bounds=box=>{const size=box.getSize(new THREE.Vector3());return {w:size.x*1000,d:size.z*1000,h:size.y*1000};};
  return {clone:bounds(new THREE.Box3().setFromObject(clone)),instance:bounds(ctx.getGltfNativeBox(asset.model).clone().applyMatrix4(matrix)),pose:JSON.parse(JSON.stringify(ctx.getItemDisplayPose(item))),effectiveHeight:h};
 }
 return {THREE,assets,core,contract,converter,ctx,dimensions,measure,ROOT,read};
}
module.exports={runtime};
