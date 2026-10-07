'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../../assets/js/walk-tps-occlusion.js'),three=import('../../assets/vendor/three/build/three.module.js');
async function setup(shared){const T=await three,scene=new T.Scene(),camera=new T.PerspectiveCamera(68,1,.1,100);camera.position.set(0,1.7,2.56);camera.lookAt(0,1.25,0);const avatar=new T.Group();avatar.userData.walkTpsAvatar=true;const body=new T.Mesh(new T.BoxGeometry(.6,1.7,.25),new T.MeshStandardMaterial());body.position.y=.85;avatar.add(body);scene.add(avatar);const source=shared||new T.MeshStandardMaterial({color:0xffffff}),wall=new T.Mesh(new T.BoxGeometry(3,3,.1),source);wall.position.set(0,1.5,1);wall.userData={b:true,selectKind:'wall'};scene.add(wall);scene.updateMatrixWorld(true);const effect=api.create(T);return {T,scene,camera,avatar,wall,source,effect,update:()=>effect.update(scene,camera,avatar)};}
test('only actual camera-to-body occluders fade; nearby nonoccluding room and physical state stay unchanged',async()=>{const h=await setup(),remote=new h.T.Mesh(new h.T.BoxGeometry(3,3,.1),h.source);remote.position.set(8,1.5,1);remote.userData.b=true;h.scene.add(remote);const g=h.wall.geometry,matrix=h.wall.matrix.clone(),data=h.wall.userData;assert.equal(h.update(),true);assert.notEqual(h.wall.material,h.source);assert.equal(remote.material,h.source);assert.equal(h.wall.visible,true);assert.equal(h.wall.geometry,g);assert.equal(h.wall.userData,data);assert.ok(h.wall.matrix.equals(matrix));assert.equal(h.wall.material.opacity,.18);assert.equal(h.source.opacity,1);h.effect.reset();assert.equal(h.wall.material,h.source);});
test('front/back sided meshes use real triangle holes instead of a whole sloped or hollow AABB',async()=>{const h=await setup();h.scene.remove(h.wall);const shape=new h.T.Shape();shape.moveTo(-2,-2);shape.lineTo(2,-2);shape.lineTo(2,2);shape.lineTo(-2,2);shape.closePath();const hole=new h.T.Path();hole.moveTo(-.8,-1);hole.lineTo(.8,-1);hole.lineTo(.8,1);hole.lineTo(-.8,1);hole.closePath();shape.holes.push(hole);const opening=new h.T.Mesh(new h.T.ShapeGeometry(shape),h.source);opening.position.set(0,1,1);opening.rotation.y=Math.PI;opening.userData.b=true;h.scene.add(opening);h.update();assert.equal(opening.material,h.source,'clear doorway remains opaque around its opening');opening.position.x=.7;h.update();assert.notEqual(opening.material,h.source,'back-facing solid jamb still fades');h.effect.reset();assert.equal(opening.material,h.source);});
test('transparent textured material arrays preserve original baselines, alpha cutoff, depth flags and source textures',async()=>{const h=await setup(),texture=new h.T.Texture(),a=new h.T.MeshStandardMaterial({map:texture,transparent:true,opacity:.6,alphaTest:.4,depthWrite:true,depthTest:false,side:h.T.FrontSide}),b=new h.T.MeshStandardMaterial({color:0x123456,opacity:.9});const array=[a,b];h.wall.material=array;h.wall.geometry.groups.forEach(g=>g.materialIndex%=2);let sourceDisposed=0,textureDisposed=0,cloneDisposed=0;a.addEventListener('dispose',()=>sourceDisposed++);b.addEventListener('dispose',()=>sourceDisposed++);texture.addEventListener('dispose',()=>textureDisposed++);h.update();const clones=h.wall.material;assert.ok(Array.isArray(clones));assert.notEqual(clones,array);assert.equal(clones[0].opacity,.6*.18);assert.equal(clones[0].alphaTest,.4*.18);assert.equal(clones[0].depthWrite,false);assert.equal(clones[0].depthTest,false);assert.equal(clones[0].map,texture);assert.equal(a.opacity,.6);assert.equal(a.depthWrite,true);clones.forEach(m=>m.addEventListener('dispose',()=>cloneDisposed++));h.effect.dispose();h.effect.dispose();assert.equal(h.wall.material,array);assert.equal(cloneDisposed,2);assert.equal(sourceDisposed,0);assert.equal(textureDisposed,0);});
test('owners sharing a source material never leak fade to another editor',async()=>{const first=await setup(),second=await setup(first.source);first.update();assert.notEqual(first.wall.material,first.source);assert.equal(second.wall.material,first.source);second.update();assert.notEqual(second.wall.material,first.wall.material);first.effect.dispose();assert.equal(first.wall.material,first.source);assert.notEqual(second.wall.material,first.source);second.effect.reset();assert.equal(second.wall.material,first.source);});
test('occluder movement, scene replacement and removed meshes restore and dispose every owned clone',async()=>{const h=await setup();h.update();const clone=h.wall.material;let disposals=0;clone.addEventListener('dispose',()=>disposals++);h.wall.position.x=8;h.update();assert.equal(h.wall.material,h.source);h.wall.position.x=0;h.update();assert.equal(h.wall.material,clone);h.scene.remove(h.wall);h.update();assert.equal(disposals,1);assert.equal(h.effect.debug().ownedRecords,0);h.scene.add(h.wall);h.update();const c=h.wall.material;c.addEventListener('dispose',()=>disposals++);h.effect.update(new h.T.Scene(),h.camera,h.avatar);assert.equal(h.wall.material,h.source);assert.equal(disposals,2);h.effect.dispose();});
test('per-instance fade keeps nonoccluding instance alpha, original geometry/matrices/colors/culling exact',async()=>{const h=await setup();h.scene.remove(h.wall);const geometry=new h.T.BoxGeometry(1,3,.1),m=new h.T.InstancedMesh(geometry,h.source,3);const visible=new h.T.Matrix4().makeTranslation(0,1.5,1),remote=new h.T.Matrix4().makeTranslation(8,1.5,1),culled=new h.T.Matrix4().makeScale(0,0,0);m.setMatrixAt(0,visible);m.setMatrixAt(1,remote);m.setMatrixAt(2,culled);m.setColorAt(0,new h.T.Color(0x123456));m.userData={b:true,instanceWalkVisible:[true,true,false],instanceBaseMatrices:[visible,remote,visible.clone()]};h.scene.add(m);const matrices=Array.from(m.instanceMatrix.array),colors=Array.from(m.instanceColor.array);h.update();assert.notEqual(m.geometry,geometry);assert.equal(geometry.getAttribute('walkTpsFade'),undefined);assert.deepEqual(Array.from(m.geometry.getAttribute('walkTpsFade').array),[1,0,0]);assert.deepEqual(Array.from(m.instanceMatrix.array),matrices);assert.deepEqual(Array.from(m.instanceColor.array),colors);assert.equal(m.visible,true);assert.deepEqual(m.userData.instanceWalkVisible,[true,true,false]);assert.equal(m.material.opacity,h.source.opacity);const shader={vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>\n#include <alphatest_fragment>'};m.material.onBeforeCompile(shader,{});assert.match(shader.vertexShader,/attribute float walkTpsFade/);assert.match(shader.fragmentShader,/diffuseColor.a \*= 1.0 - 0.82/);let gd=0,md=0;m.geometry.addEventListener('dispose',()=>gd++);m.material.addEventListener('dispose',()=>md++);h.effect.reset();assert.equal(m.geometry,geometry);assert.equal(m.material,h.source);assert.equal(gd,1);assert.equal(md,1);assert.deepEqual(Array.from(m.instanceMatrix.array),matrices);assert.equal(h.source.opacity,1);});
test('shader materials and invalid physical geometry are reported without guessing mutations',async()=>{const h=await setup();h.wall.material=new h.T.ShaderMaterial();const material=h.wall.material;h.update();assert.equal(h.wall.material,material);assert.ok(h.effect.debug().invalid>0);h.wall.material=h.source;h.wall.scale.x=0;h.update();assert.equal(h.wall.material,h.source);assert.ok(h.effect.debug().invalid>0);h.effect.dispose();});
test('another owner material edit is not overwritten by restoration',async()=>{const h=await setup();h.update();const replacement=new h.T.MeshStandardMaterial({color:0xff0000});h.wall.material=replacement;h.effect.reset();assert.equal(h.wall.material,replacement);});

test('external edits to a faded material-array slot are retained and never disposed as owned clones',async()=>{const h=await setup(),a=new h.T.MeshStandardMaterial(),b=new h.T.MeshStandardMaterial(),replacement=new h.T.MeshStandardMaterial();h.wall.geometry.groups.forEach(g=>g.materialIndex%=2);h.wall.material=[a,b];let disposed=0;replacement.addEventListener('dispose',()=>disposed++);h.update();h.wall.material[1]=replacement;h.effect.reset();assert.equal(h.wall.material[0],a);assert.equal(h.wall.material[1],replacement);assert.equal(disposed,0);});
test('100 repeated updates reuse bounded resources; 30 reset/re-entry cycles dispose every private clone',async()=>{const h=await setup();h.update();const first=h.wall.material;for(let i=0;i<100;i++){h.update();assert.equal(h.wall.material,first);assert.equal(h.effect.debug().ownedRecords,1);}h.effect.reset();let made=0,disposed=0;for(let i=0;i<30;i++){h.update();made++;h.wall.material.addEventListener('dispose',()=>disposed++);h.effect.reset();assert.equal(h.wall.material,h.source);assert.equal(h.effect.debug().ownedRecords,0);}assert.equal(made,disposed);h.effect.dispose();});
test('source opacity/color/compile-hook changes refresh private clones without changing source state',async()=>{const h=await setup();h.update();const first=h.wall.material;let disposed=0;first.addEventListener('dispose',()=>disposed++);h.source.opacity=.5;h.source.color.set(0x112233);h.update();assert.notEqual(h.wall.material,first);assert.equal(h.wall.material.opacity,.5*.18);assert.equal(h.wall.material.color.getHex(),0x112233);assert.equal(h.source.opacity,.5);assert.equal(disposed,1);h.effect.reset();assert.equal(h.wall.material,h.source);});
test('instance hook composes with original hooks/cache key on actual Three shader-library templates',async()=>{const h=await setup();h.scene.remove(h.wall);let called=0;h.source.onBeforeCompile=function(s){called++;s.uniforms.custom={value:123};s.vertexShader+='\n// source hook';};h.source.customProgramCacheKey=()=> 'source-v3';const mesh=new h.T.InstancedMesh(new h.T.BoxGeometry(1,3,.1),h.source,1);mesh.userData.b=true;mesh.setMatrixAt(0,new h.T.Matrix4().makeTranslation(0,1.5,1));h.scene.add(mesh);h.update();const material=mesh.material;assert.equal(material.customProgramCacheKey(),'source-v3|walk-tps-instance-fade-v2');for(const name of ['standard','physical','basic','phong','lambert','toon']){const lib=h.T.ShaderLib[name],s={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:{}};material.onBeforeCompile(s,{});assert.match(s.vertexShader,/vWalkTpsFade=walkTpsFade/);assert.match(s.fragmentShader,/diffuseColor.a \*= 1.0 - 0.82/);assert.ok(s.fragmentShader.includes(h.T.ShaderChunk.alphatest_fragment));assert.equal(s.uniforms.custom.value,123);}assert.equal(called,6);assert.equal(h.source.customProgramCacheKey(),'source-v3');h.effect.dispose();});
async function instanceSetup(){
 const h=await setup();h.scene.remove(h.wall);h.geometry=new h.T.BoxGeometry(1,3,.1);
 h.mesh=new h.T.InstancedMesh(h.geometry,h.source,2);h.mesh.setMatrixAt(0,new h.T.Matrix4().makeTranslation(0,1.5,1));
 h.mesh.setMatrixAt(1,new h.T.Matrix4().makeTranslation(8,1.5,1));h.mesh.userData.b=true;h.scene.add(h.mesh);h.update();return h;
}
test('all source instance attributes and morph/index contracts refresh private geometry after edits or replacement',async()=>{
 const h=await instanceSetup();let previous=h.mesh.geometry,disposals=0;previous.addEventListener('dispose',()=>disposals++);
 h.geometry.attributes.uv.setXY(0,.123,.456);h.geometry.attributes.uv.needsUpdate=true;
 h.geometry.attributes.normal.setXYZ(0,.1,.2,.3);h.geometry.attributes.normal.needsUpdate=true;h.update();
 assert.notEqual(h.mesh.geometry,previous);assert.equal(disposals,1);
 for(const name of ['uv','normal'])assert.deepEqual(Array.from(h.mesh.geometry.attributes[name].array),Array.from(h.geometry.attributes[name].array));
 previous=h.mesh.geometry;const position=h.geometry.attributes.position.clone();for(let i=0;i<position.count;i++)position.setX(i,position.getX(i)*1.5);
 assert.equal(position.version,h.geometry.attributes.position.version);h.geometry.setAttribute('position',position);h.update();
 assert.notEqual(h.mesh.geometry,previous);assert.deepEqual(Array.from(h.mesh.geometry.attributes.position.array),Array.from(position.array));
 previous=h.mesh.geometry;h.geometry.setIndex(h.geometry.index.clone());h.update();assert.notEqual(h.mesh.geometry,previous);
 const morph=position.clone();h.geometry.morphAttributes.position=[morph];h.update();previous=h.mesh.geometry;
 morph.setY(0,morph.getY(0)+.2);morph.needsUpdate=true;h.update();assert.notEqual(h.mesh.geometry,previous);
 assert.deepEqual(Array.from(h.mesh.geometry.morphAttributes.position[0].array),Array.from(morph.array));
 h.effect.dispose();assert.equal(h.mesh.geometry,h.geometry);assert.equal(h.geometry.getAttribute('walkTpsFade'),undefined);
});
test('roughness/metalness, vector, texture, clipping and physical material baseline edits are reflected without needsUpdate',async()=>{
 const h=await setup();h.source.roughness=.8;h.source.metalness=.2;h.update();const version=h.source.version;
 h.source.roughness=.15;h.source.metalness=.9;h.source.envMapIntensity=.33;h.source.normalScale.set(.2,.7);
 h.source.clippingPlanes=[new h.T.Plane(new h.T.Vector3(1,0,0),2)];h.source.map=new h.T.Texture();h.update();
 assert.equal(h.source.version,version);assert.equal(h.wall.material.roughness,.15);assert.equal(h.wall.material.metalness,.9);
 assert.equal(h.wall.material.envMapIntensity,.33);assert.deepEqual(h.wall.material.normalScale.toArray(),[.2,.7]);
 assert.equal(h.wall.material.map,h.source.map);assert.equal(h.wall.material.clippingPlanes[0].constant,2);
 h.source.clippingPlanes[0].constant=3;h.update();assert.equal(h.wall.material.clippingPlanes[0].constant,3);h.effect.dispose();
});
test('native alpha-test coverage branch is intact and instance opacity is applied only after its cutout/coverage result',async()=>{
 const h=await instanceSetup();h.source.alphaTest=.4;h.source.alphaToCoverage=true;h.update();
 const shader={vertexShader:h.T.ShaderLib.standard.vertexShader,fragmentShader:h.T.ShaderLib.standard.fragmentShader,uniforms:{}};
 h.mesh.material.onBeforeCompile(shader,{});const native=h.T.ShaderChunk.alphatest_fragment;
 assert.ok(shader.fragmentShader.includes(native));assert.ok(shader.fragmentShader.indexOf(native)<shader.fragmentShader.indexOf('diffuseColor.a *= 1.0 - 0.82'));
 assert.equal(h.mesh.material.alphaTest,.4);assert.equal(h.mesh.material.alphaToCoverage,true);assert.equal(h.mesh.material.opacity,h.source.opacity);
 assert.deepEqual(Array.from(h.mesh.geometry.getAttribute('walkTpsFade').array),[1,0]);h.effect.dispose();
});
test('ordinary alpha-to-coverage fading keeps the native branch and applies opacity after its coverage result',async()=>{
 const h=await setup();h.source.alphaTest=.4;h.source.alphaToCoverage=true;h.update();
 const shader={vertexShader:h.T.ShaderLib.standard.vertexShader,fragmentShader:h.T.ShaderLib.standard.fragmentShader,uniforms:{}};
 h.wall.material.onBeforeCompile(shader,{});assert.ok(shader.fragmentShader.includes(h.T.ShaderChunk.alphatest_fragment));
 assert.match(shader.fragmentShader,/#if defined\(USE_ALPHATEST\) && defined\(ALPHA_TO_COVERAGE\)\ndiffuseColor.a \*= 0.18/);
 assert.equal(h.wall.material.alphaToCoverage,true);h.effect.dispose();assert.equal(h.wall.material,h.source);assert.equal(h.source.alphaTest,.4);
});
test('source hook consuming color_fragment still composes with the later native alpha-stage fade',async()=>{
 const h=await instanceSetup();h.source.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',h.T.ShaderChunk.color_fragment);};h.update();
 const shader={vertexShader:h.T.ShaderLib.standard.vertexShader,fragmentShader:h.T.ShaderLib.standard.fragmentShader,uniforms:{}};
 h.mesh.material.onBeforeCompile(shader,{});assert.match(shader.fragmentShader,/diffuseColor.a \*= 1.0 - 0.82/);assert.equal(h.effect.debug().invalid,0);h.effect.dispose();
});
test('missing required shader anchors explicitly decline fading with no partial injection and restore source geometry/material',async()=>{
 for(const [field,name] of [['vertexShader','common'],['vertexShader','begin_vertex'],['fragmentShader','common'],['fragmentShader','alphatest_fragment']]){
  const h=await instanceSetup();h.source.onBeforeCompile=s=>{s[field]=s[field].replace('#include <'+name+'>',h.T.ShaderChunk[name]);};h.update();
  const clone=h.mesh.material,shader={vertexShader:h.T.ShaderLib.standard.vertexShader,fragmentShader:h.T.ShaderLib.standard.fragmentShader,uniforms:{}};
  clone.onBeforeCompile(shader,{});assert.ok(h.effect.debug().invalid>0);assert.deepEqual(h.effect.debug().shaderIssues,['shader-hook-incompatible']);
  assert.ok(!shader.vertexShader.includes('vWalkTpsFade'));assert.ok(!shader.fragmentShader.includes('vWalkTpsFade'));
  assert.equal(h.mesh.material,h.source);assert.equal(h.mesh.geometry,h.geometry);h.update();assert.ok(h.effect.debug().invalid>0);assert.equal(h.mesh.material,h.source);
  h.source.onBeforeCompile=function(){};h.update();assert.notEqual(h.mesh.material,h.source);h.effect.dispose();
 }
});
test('every supported material family retains private custom defines and composed source-hook semantics',async()=>{
 const names=['MeshStandardMaterial','MeshPhysicalMaterial','MeshBasicMaterial','MeshPhongMaterial','MeshLambertMaterial','MeshToonMaterial'];
 for(const name of names){
  const h=await instanceSetup();h.effect.reset();const source=new h.T[name]();source.defines=Object.assign({},source.defines,{CUSTOM:1});
  let observed;source.onBeforeCompile=function(s){observed=this.defines.CUSTOM;s.uniforms.customDefine={value:observed};};
  source.customProgramCacheKey=()=>name+'-custom-source';h.mesh.material=source;h.source=source;h.update();
  const clone=h.mesh.material;assert.notEqual(clone.defines,source.defines);assert.deepEqual(clone.defines,source.defines);
  const shader={vertexShader:h.T.ShaderLib.standard.vertexShader,fragmentShader:h.T.ShaderLib.standard.fragmentShader,uniforms:{}};
  clone.onBeforeCompile(shader,{});assert.equal(observed,1);assert.equal(shader.uniforms.customDefine.value,1);
  assert.match(shader.fragmentShader,/diffuseColor.a \*= 1.0 - 0.82/);assert.equal(clone.customProgramCacheKey(),name+'-custom-source|walk-tps-instance-fade-v2');
  clone.defines.CUSTOM=9;assert.equal(source.defines.CUSTOM,1);h.effect.reset();assert.equal(h.mesh.material,source);
  let sourceDisposals=0,ownedDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);h.update();h.mesh.material.addEventListener('dispose',()=>ownedDisposals++);
  for(let i=0;i<20;i++)h.update();assert.equal(h.effect.debug().ownedRecords,1);source.defines.CUSTOM=2;h.update();
  assert.equal(h.mesh.material.defines.CUSTOM,2);assert.equal(ownedDisposals,1);assert.equal(sourceDisposals,0);h.effect.dispose();
  assert.equal(h.mesh.material,source);assert.equal(source.defines.CUSTOM,2);assert.equal(sourceDisposals,0);
 }
});
test('ordinary fade clones retain custom defines without sharing nested definition containers',async()=>{
 const h=await setup();h.source.defines=Object.assign({},h.source.defines,{CUSTOM:1,OPTIONS:{enabled:true,weights:[1,2]}});h.update();
 assert.notEqual(h.wall.material.defines,h.source.defines);assert.notEqual(h.wall.material.defines.OPTIONS,h.source.defines.OPTIONS);
 assert.notEqual(h.wall.material.defines.OPTIONS.weights,h.source.defines.OPTIONS.weights);assert.deepEqual(h.wall.material.defines,h.source.defines);
 h.wall.material.defines.OPTIONS.weights[0]=9;assert.equal(h.source.defines.OPTIONS.weights[0],1);h.effect.reset();assert.equal(h.wall.material,h.source);
});
test('null-prototype defines retain live edits and private ownership without source needsUpdate',async()=>{
 const h=await instanceSetup();h.effect.reset();h.source.defines=Object.assign(Object.create(null),h.source.defines,{CUSTOM:1});h.update();
 const prior=h.mesh.material,version=h.source.version;assert.equal(Object.getPrototypeOf(prior.defines),null);assert.notEqual(prior.defines,h.source.defines);
 h.source.defines.CUSTOM=2;h.update();assert.equal(h.source.version,version);assert.notEqual(h.mesh.material,prior);assert.equal(h.mesh.material.defines.CUSTOM,2);
 h.mesh.material.defines.CUSTOM=9;assert.equal(h.source.defines.CUSTOM,2);h.effect.dispose();assert.equal(h.mesh.material,h.source);assert.equal(h.source.defines.CUSTOM,2);
});
