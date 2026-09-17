const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=require('./app-source.cjs').appSource();
function fn(name,s){const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);vm.createContext(s);vm.runInContext(html.slice(a,b),s);return s[name];}
test('legacy neighbour migration preserves placement and runs only once',()=>{
 const old={type:'neighbor-house',rot:37,x:10,y:20,w:7280,d:6370,flipX:true};const current={type:'neighbor-house',rot:0,neighborFacingVersion:1};const s={DATA:{items:[old,current]},snapCeilingFixturesToCeiling:()=>{},snapOutdoorCeilingFixturesToRoof:()=>{},ST:{},getFmpItem:()=>null,bestFmpType:t=>t};const normalize=fn('normalizeLegacyFurnitureItems',s);normalize();assert.equal(old.rot,217);assert.equal(current.rot,0);normalize();assert.equal(old.rot,217);assert.equal(old.x,10);assert.equal(old.flipX,true);
});
test('new exterior fixtures sit at ground datum, independently of indoor floor elevation',()=>{
 const s={getFmpItem:t=>t==='original-mailbox'?{groundLevel:true}:null};const ground=fn('isGroundLevelItemType',s);assert.equal(ground('original-mailbox'),true);assert.equal(ground('original-sofa'),false);
 const base=fn('item3DBaseY',{itemIsUnderPlatform:()=>false,stairGroupIsLevel:()=>false,isGroundLevelItemType:ground,isContextExteriorItemType:()=>false,isFloorAwareGroundItemType:()=>false,groundYForItem:()=>0,itemOnFoundation:()=>true,roomFloorAt:()=>.15});assert.equal(base({type:'original-mailbox',floor:1}),0);assert.equal(base({type:'original-sofa',floor:1}),.15);
});
test('roughness-only finish clones the requested surface and preserves map and cache',()=>{
 const {applyFinishes}=require('../../assets/js/model-quality.js');const map={};const m={userData:{finishChannel:'wood'},roughness:.62,map,clone(){return {...this};}};const fixed={userData:{},roughness:.4,clone(){return {...this};}};const mesh={isMesh:true,material:[m,fixed]};applyFinishes({traverse:f=>f(mesh)},null,{wood:.22});assert.equal(mesh.material[0].roughness,.22);assert.equal(m.roughness,.62);assert.equal(mesh.material[0].map,map);assert.equal(mesh.material[1],fixed);
});
test('external finish works on compressed maps without copying or modifying source images',()=>{
 const {prepare,applyFinishes}=require('../../assets/js/model-quality.js');const map={isCompressedTexture:true};const m={name:'43693',userData:{},map,color:{set(){}},clone(){return {...this,userData:{...this.userData}};}};const mesh={isMesh:true,material:m},scene={traverse:f=>f(mesh)};prepare(scene,'assets/models/interior_model_0_26_1/glb/Bed/MEGA_PACK_BED__bed-43693.glb');applyFinishes(scene,{wood:'#997755'});assert.equal(mesh.material.map,map);assert.equal(m.onBeforeCompile,undefined);const shader={uniforms:{},fragmentShader:'#include <map_fragment>'};mesh.material.onBeforeCompile(shader);assert.ok(shader.fragmentShader.includes('sampledDiffuseColor'));assert.equal(shader.uniforms.finishReference.value,.08);
});
