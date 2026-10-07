'use strict';
// Use repository Three/OrbitControls and the real capture transaction helpers.
// The renderer/canvas boundary is inert: no browser, GPU or network is needed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ROOT}=require('./app-source.cjs');
let modules;
function nativeCaptureModules(){
 if(!modules)modules=(async()=>{
  const url='data:text/javascript;base64,'+fs.readFileSync(path.join(ROOT,'assets/vendor/three/build/three.module.js')).toString('base64');
  const THREE=await import(url);
  const source=fs.readFileSync(path.join(ROOT,'assets/vendor/three/examples/jsm/controls/OrbitControls.js'),'utf8').replace("from 'three'",'from '+JSON.stringify(url));
  const {OrbitControls}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  return {THREE,OrbitControls};
 })();
 return modules;
}
function installNativeCaptureRuntime(c,{THREE,OrbitControls}){
 const previousCamera=c.camExt,previousOrbit=c.orbit;
 const camera=new THREE.PerspectiveCamera(previousCamera?.fov||45,4/3,.1,100);
 if(previousCamera?.position)camera.position.copy(previousCamera.position);else camera.position.set(0,5,10);
 const controls=new OrbitControls(camera);
 if(previousOrbit?.target)controls.target.copy(previousOrbit.target);
 controls.enableDamping=previousOrbit?.enableDamping??true;
 controls.autoRotate=previousOrbit?.autoRotate??false;
 camera.updateMatrixWorld(true);
 let ratio=1,width=800,height=600;
 Object.assign(c,{THREE,camExt:camera,orbit:controls,sc3:new THREE.Scene(),composer:null,
  ren:{getPixelRatio:()=>ratio,setPixelRatio:value=>{ratio=value;},getSize:out=>out.set(width,height),setSize:(w,h)=>{width=w;height=h;}},
  getComputedStyle:()=>({display:'block'}),updateInteriorCutawayWalls:()=>{},
  init3D:()=>{throw Error('test must not create a GPU renderer');}});
 if(!c.document)c.document={getElementById:()=>null};
 // Package tests retain their existing pixel/codec doubles. They must still run
 // inside the actual synchronous transaction, including camera/source ownership.
 for(const name of ['captureCurrent3DDataUrl','captureInstance3DData','captureSegmentation3DDataUrl','captureAiOverrideGuideDataUrl']){
  const capture=c[name];if(!capture)continue;
  c[name]=function(...args){
   assert.ok(c.AI_CAPTURE_TRANSACTION,name+' must use the actual capture transaction');
   assert.equal(c.AI_CAPTURE_TRANSACTION.camera,c.camExt,name+' captures the owned camera');
   c.assertNativeOutputRequest(c.AI_CAPTURE_TRANSACTION.context);
   return capture.apply(this,args);
  };
 }
}
module.exports={nativeCaptureModules,installNativeCaptureRuntime};
