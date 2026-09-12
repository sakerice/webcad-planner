import fs from 'node:fs';
// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const stage=process.env.REVIEW_STAGE||'after',dir=`docs/quality-review/detail-loop/${stage}`;fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage();await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE&&getFmpItem('original-sofa'));await page.evaluate(()=>init3D());
 const ids=await page.evaluate(()=>Object.values(FMP_ITEMS).filter(i=>i.provenance==='original').map(i=>i.id).concat(['im0261-Sofa-MEGA_PACK_Sofa-BOLIA_sofa_Ivory','im0261-Bed-MEGA_PACK_BED-bed-43693','ac-outdoor','water-heater','meter-box','sewer-pit','neighbor-house','neighbor-building','utility-pole','wood-fence','car','bicycle','bicycle-fold','candidate-car']));const stats=[];
 for(const id of ids.filter(id=>!process.env.MODEL_FILTER||process.env.MODEL_FILTER.split(',').includes(id))){const result=await page.evaluate(async({id,stage})=>{
  async function cached(url){if(_modelCache[url])return;const g=await new Promise((resolve,reject)=>getGltfLoader().load(url,resolve,undefined,reject));ModelQuality.prepare(g.scene,url);_modelCache[url]=g.scene;}
  const model=new THREE.Group(),item=getFmpItem(id);if(item){await cached(item.model);model.add(makeGltfBoxFitClone(item.model,item.w/1000,item.h/1000,item.d/1000,null));}
  else if(['car','bicycle','bicycle-fold','candidate-car'].includes(id)){
   const url=id==='car'?CONTEXT_CAR_GLB:id==='bicycle'?CONTEXT_BIKE_GLB:id==='bicycle-fold'?CONTEXT_FBIKE_GLB:'tools/blender/work/quality/original_hatchback_v2.glb';await cached(url);model.add(_modelCache[url].clone(true));
  }
  else if(id==='neighbor-building'){await cached(CONTEXT_GLB_SPECS[id].url);const it=mkItem(id,0,0,0,1);it.contextGhost=false;buildContextGlbStack(model,it,it.w*U,it.d*U);}
  else if(id==='utility-pole'){await cached(CONTEXT_POLE_GLB);const it=mkItem(id,0,0,0,1);build3DUtilityPole(model,it,it.w*U,it.d*U,getItemH(id)*U);}
  else if(id==='wood-fence'){const it=mkItem(id,0,0,0,1);buildWoodFence3D(model,it,it.w*U,it.d*U,getItemH(id)*U);}
  else if(id==='neighbor-house') {await cached(CONTEXT_HOUSE_KIT_GLB);if(window.EXTERIOR_MODEL_URLS)for(const url of Object.values(EXTERIOR_MODEL_URLS))await cached(url);const it=mkItem(id,0,0,0,1);it.contextGhost=false;buildNeighborHouseKit(model,it,it.w*U,it.d*U);if(stage!=='before')model.rotation.y=Math.PI;}
  else {if(window.EXTERIOR_MODEL_URLS)for(const url of Object.values(EXTERIOR_MODEL_URLS))await cached(url);const fn={'ac-outdoor':build3DAcOutdoor,'water-heater':build3DWaterHeater,'meter-box':build3DMeterBox,'sewer-pit':build3DSewerPit}[id];fn(model,{type:id},ISIZES[id].w*U,ISIZES[id].d*U,getItemH(id)*U);}
  const scene=new THREE.Scene();scene.background=new THREE.Color('#ece9e2');scene.add(model,new THREE.HemisphereLight(0xeaf3ff,0x9b8c76,2));const light=new THREE.DirectionalLight(0xfff5e9,3);light.position.set(-3,5,4);scene.add(light);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(720,720);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  let box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());model.position.sub(box.getCenter(new THREE.Vector3()));const extent=Math.max(size.x,size.y,size.z);const camera=new THREE.OrthographicCamera(-extent*.69,extent*.69,extent*.69,-extent*.69,.01,extent*25);
  const shots={};for(const [name,x,z] of [['front',2,3],['back',-2,-3]]){camera.position.set(x*extent,extent*1.3,z*extent);camera.lookAt(0,0,0);renderer.render(scene,camera);shots[name]=renderer.domElement.toDataURL();}
  ModelQuality.applyFinishes(model,{fabric:'#537e91',wood:'#71503a',body:'#455356',accent:'#9b653e'},{wood:.48,body:.48});camera.position.set(extent*2,extent*1.3,extent*3);camera.lookAt(0,0,0);renderer.render(scene,camera);shots.finish=renderer.domElement.toDataURL();
  let triangles=0;model.traverse(o=>{if(o.geometry&&o.isMesh)triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});const calls=renderer.info.render.calls;renderer.dispose();return {shots,triangles,calls,size:size.toArray()};
 },{id,stage});for(const [name,data] of Object.entries(result.shots))fs.writeFileSync(`${dir}/${id}-${name}.png`,Buffer.from(data.split(',')[1],'base64'));delete result.shots;stats.push({id,...result});}
 fs.writeFileSync(`${dir}/stats.json`,JSON.stringify(stats,null,2));console.log(stage,stats.length,'models reviewed');
}finally{await browser.close();}
