'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {topLevelFunction}=require('./height-runtime.cjs'),source=require('./app-source.cjs').appSource();
const three=import('../../assets/vendor/three/build/three.module.js');
function load(c,names){vm.createContext(c);for(const name of names)if(source.includes('\nfunction '+name+'('))vm.runInContext(topLevelFunction(name),c);return c;}
const disposal=['disposeObj','disposeMat','retained3DResources','isRetained3DResource','collectGltfResources'];
async function fixture(){
 const T=await three,geometry=new T.BoxGeometry(1,1,1),map=new T.Texture(),normal=new T.Texture(),material=new T.MeshStandardMaterial({map,normalMap:normal});
 material.userData.tintMap=true;
 const template=new T.Group();template.add(new T.Mesh(geometry,material));
 const counts={geometry:0,material:0,map:0,normal:0};for(const [name,resource]of Object.entries({geometry,material,map,normal}))resource.addEventListener('dispose',()=>counts[name]++);
 const c=load({THREE:T,Set,EDITOR_PANE:false,NATIVE_PLAN_EDITOR:true,window:{},_modelCache:{'anonymous.glb':template},_texCache:{},LIGHT_SETTINGS:{env:.3},sc3:new T.Scene()},disposal.concat(['makeGltfNativeClone','applySelectableColor','tameMaterialBrightness','collectGltfSubmeshes','finalizeFmpInstancePools']));
 return {T,c,template,geometry,map,normal,material,counts};
}
test('two actual native cached clones retain template geometry, materials and every shared map on rebuild',async()=>{
 const h=await fixture(),a=h.c.makeGltfNativeClone('anonymous.glb'),b=h.c.makeGltfNativeClone('anonymous.glb');
 assert.equal(a.children[0].geometry,h.geometry);assert.equal(a.children[0].material,h.material);assert.equal(b.children[0].material.map,h.map);
 h.c.disposeObj(a);h.c.disposeObj(b);assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('native material and geometry snapshots are released exactly once while their borrowed maps survive',async()=>{
 const h=await fixture(),ownedGeometry=h.geometry.clone(),ownedMaterial=h.material.clone(),ownedMap=h.map.clone(),ownedNormal=h.normal.clone();
 const counts={geometry:0,material:0,map:0,normal:0};for(const [name,resource]of Object.entries({geometry:ownedGeometry,material:ownedMaterial,map:ownedMap,normal:ownedNormal}))resource.addEventListener('dispose',()=>counts[name]++);
 ownedMaterial.map=ownedMap;ownedMaterial.normalMap=ownedNormal;ownedMaterial.userData.ownedAuxiliaryTextures=[ownedNormal,ownedNormal];
 const group=new h.T.Group();group.add(new h.T.Mesh(ownedGeometry,ownedMaterial),new h.T.Mesh(ownedGeometry,ownedMaterial));
 const tinted=h.c.makeGltfNativeClone('anonymous.glb','#123456');let tintedDisposed=0;tinted.children[0].material.addEventListener('dispose',()=>tintedDisposed++);group.add(tinted);
 h.c.disposeObj(group);assert.deepEqual(counts,{geometry:1,material:1,map:1,normal:1});assert.equal(tintedDisposed,1);assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('actual instanced snapshots are released but their cached template textures remain retained',async()=>{
 const h=await fixture(),item={id:'anonymous-item',floor:1};h.c._fmpInstancePools={'anonymous.glb':[{matrix:new h.T.Matrix4(),it:item},{matrix:new h.T.Matrix4().makeTranslation(2,0,0),it:item}]};
 h.c.finalizeFmpInstancePools();const instance=h.c.sc3.children[0];assert.equal(instance.isInstancedMesh,true);assert.notEqual(instance.geometry,h.geometry);assert.notEqual(instance.material,h.material);
 const counts={geometry:0,material:0};instance.geometry.addEventListener('dispose',()=>counts.geometry++);instance.material.addEventListener('dispose',()=>counts.material++);
 h.c.disposeObj(instance);assert.deepEqual(counts,{geometry:1,material:1});assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('closing editor releases its local cached resources once instead of retaining a dead cache',async()=>{
 const h=await fixture(),a=h.c.makeGltfNativeClone('anonymous.glb'),b=h.c.makeGltfNativeClone('anonymous.glb');h.material.userData.ownedAuxiliaryTextures=[h.normal];h.c.sc3.add(a,b);h.c.window._editorPaneDisposed=true;
 const seenGeometry=new Set(),seenMaterial=new Set(),seenTexture=new Set();h.c.disposeObj(h.c.sc3,seenGeometry,seenMaterial,seenTexture);h.c.disposeObj(h.template,seenGeometry,seenMaterial,seenTexture);
 assert.deepEqual(h.counts,{geometry:1,material:1,map:1,normal:1});
});
test('existing host model-pool ownership protects its materials as well as geometry and textures',async()=>{
 const h=await fixture(),resources=new Set([h.geometry,h.map,h.normal]);h.c.EDITOR_PANE='anonymous-pane';h.c.window.parent={ParallelEditors:{modelPool:{resources,owns:r=>resources.has(r)||r===h.material}}};h.c.window._editorPaneDisposed=true;
 h.c.disposeObj(h.template);assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('separate materials sharing an owned map release it once per scene teardown',async()=>{
 const h=await fixture(),map=new h.T.Texture(),a=new h.T.MeshStandardMaterial({map}),b=new h.T.MeshStandardMaterial({map});let count=0;map.addEventListener('dispose',()=>count++);
 const group=new h.T.Group();group.add(new h.T.Mesh(new h.T.BoxGeometry(),a),new h.T.Mesh(new h.T.BoxGeometry(),b));h.c.disposeObj(group);assert.equal(count,1);
});
test('actual setback cuts replace cloned solids without releasing retained template geometry',async()=>{
 const h=await fixture(),clone=h.c.makeGltfNativeClone('anonymous.glb'),item={id:'anonymous-opening',type:'door-open',floor:1};
 clone.traverse(o=>{o.userData={b:true,selectRef:item,selectKind:'item'};});h.c.sc3.add(clone);h.c.sc3.updateMatrixWorld(true);
 Object.assign(h.c,{U:.001,SETBACK_CUT_EPS_M:.0005,setbackPlanes:()=>[{slope:0,nx:0,ny:0,baseMm:500,d0:0}],isContextExteriorItemType:()=>false,isGroundLevelItemType:()=>false});
 for(const name of ['setbackPlaneWorldCoef','setbackTriSide','splitTriangleBySetbackPlane','setbackLerpVert','isSetbackSubjectMesh','setbackSubjectMeshes','setbackLiveCoefsForMesh','setbackCutGeometry','applySetbackCut'])vm.runInContext(topLevelFunction(name),h.c);
 const result=h.c.applySetbackCut();assert.equal(result.cut,1);assert.notEqual(clone.children[0].geometry,h.geometry);assert.equal(h.counts.geometry,0);
 let ownedDisposed=0;clone.children[0].geometry.addEventListener('dispose',()=>ownedDisposed++);h.c.disposeObj(clone);assert.equal(ownedDisposed,1);assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('the actual rebuild cleanup shares disposal sets across separate owned roots',async()=>{
 const h=await fixture(),geometry=new h.T.BoxGeometry(),map=new h.T.Texture(),a=new h.T.MeshStandardMaterial({map}),b=new h.T.MeshStandardMaterial({map}),counts={geometry:0,map:0,a:0,b:0};
 for(const [name,resource]of Object.entries({geometry,map,a,b}))resource.addEventListener('dispose',()=>counts[name]++);
 for(const material of [a,b]){const mesh=new h.T.Mesh(geometry,material);mesh.userData.b=true;h.c.sc3.add(mesh);}
 const build=topLevelFunction('build3DScene');vm.runInContext(build.slice(build.indexOf('  var toRemove='),build.indexOf('  _activeInteriorShadowLightCount=')),h.c);
 assert.equal(h.c.sc3.children.length,0);assert.deepEqual(counts,{geometry:1,map:1,a:1,b:1});assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
});
test('the existing parser resource owner still releases orphan resources and preserves borrowed templates',async()=>{
 const h=await fixture();vm.runInContext(topLevelFunction('createGltfResourceOwner'),h.c);
 const borrowed=h.c.createGltfResourceOwner({scene:h.template});borrowed.release();borrowed.release();assert.deepEqual(h.counts,{geometry:0,material:0,map:0,normal:0});
 const geometry=new h.T.BoxGeometry(),map=new h.T.Texture(),normal=new h.T.Texture(),material=new h.T.MeshStandardMaterial({map,normalMap:normal}),scene=new h.T.Group(),counts={geometry:0,material:0,map:0,normal:0};scene.add(new h.T.Mesh(geometry,material));
 for(const [name,resource]of Object.entries({geometry,material,map,normal}))resource.addEventListener('dispose',()=>counts[name]++);
 const owner=h.c.createGltfResourceOwner({scene});owner.release(scene);assert.deepEqual(counts,{geometry:0,material:0,map:0,normal:0});owner.release();owner.release();assert.deepEqual(counts,{geometry:1,material:1,map:1,normal:1});
});
