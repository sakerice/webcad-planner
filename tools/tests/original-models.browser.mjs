import fs from 'node:fs';
import assert from 'node:assert/strict';
// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const browser=await chromium.launch({args:['--use-angle=metal']});
const dir='docs/quality-review/original-collection';fs.mkdirSync(dir,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE&&getFmpItem('original-sofa'));await page.evaluate(()=>init3D());
 const results=await page.evaluate(async()=>{
  const items=Object.values(FMP_ITEMS).filter(i=>i.provenance==='original').concat(['fmp-Sofa01','fmp-Chair01','fmp-Bed01','fmp-Table01','fmp-Drawer01','fmp-Closet01'].map(id=>FMP_ITEMS[id]));const results=[];
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(640,640);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  for(const item of items){
   const gltf=await new Promise((resolve,reject)=>getGltfLoader().load(item.model,resolve,undefined,reject));ModelQuality.prepare(gltf.scene,item.model);
   const scene=new THREE.Scene();scene.background=new THREE.Color('#eeeae3');const model=gltf.scene;scene.add(model,new THREE.HemisphereLight(0xecf3ff,0x84725f,2));const sun=new THREE.DirectionalLight(0xfff2df,3);sun.position.set(-3,5,4);scene.add(sun);
   let box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());const center=box.getCenter(new THREE.Vector3());model.position.sub(center);
   const extent=Math.max(size.x,size.y,size.z),camera=new THREE.OrthographicCamera(-extent*.7,extent*.7,extent*.7,-extent*.7,.01,30);
   function shot(x,z){camera.position.set(x*extent,extent*1.3,z*extent);camera.lookAt(0,0,0);renderer.render(scene,camera);return renderer.domElement.toDataURL();}
   const front=shot(2,3),back=shot(-2,-3);ModelQuality.applyFinishes(model,{fabric:'#a75842',wood:'#533828'});const custom=shot(2,3);
   let triangles=0;model.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});
   const heading=[];model.updateMatrixWorld(true);model.traverse(o=>{if(o.isMesh&&/Upholstered.back|Door.panel|Upholstered.headboard/.test(o.name))heading.push({name:o.name,z:new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z});});
   results.push({id:item.id,size:size.toArray(),triangles,drawCalls:renderer.info.render.calls,heading,front,back,custom});
   const geos=new Set(),mats=new Set();model.traverse(o=>{if(o.geometry)geos.add(o.geometry);for(const m of [].concat(o.material||[]))mats.add(m);});for(const g of geos)g.dispose();for(const m of mats)m.dispose();
  }
  renderer.dispose();return results;
 });
 for(const r of results){for(const kind of ['front','back','custom']){fs.writeFileSync(`${dir}/${r.id}-${kind}.png`,Buffer.from(r[kind].split(',')[1],'base64'));delete r[kind];}if(['original-sofa','original-chair','original-bed','original-sideboard','original-wardrobe'].includes(r.id))assert.ok(r.heading.length,r.id+' missing direction checks');for(const h of r.heading.filter(()=>r.id.startsWith('original-')))assert.ok(/Door.panel/.test(h.name)?h.z>0:h.z<0,JSON.stringify(h));}
 const runtime=await page.evaluate(async()=>{
  const source=getFmpItem('original-sofa');await new Promise((res,rej)=>getGltfLoader().load(source.model,g=>{ModelQuality.prepare(g.scene,source.model);_modelCache[source.model]=g.scene;res();},undefined,rej));
  const item=mkItem('original-sofa',0,0,0,1);DATA.items.push(item);ST.selected=item;updateProps();
  const originalMaterial=[];_modelCache[source.model].traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material||[]))if(m.userData.finishChannel==='fabric')originalMaterial.push(m.color.getHexString());});
  updateSelectedModelFinish('fabric','#a75842');const serialized=JSON.parse(serializeDataSnapshot());
  const clone=makeGltfBoxFitClone(source.model,2.1,.82,.9,null);ModelQuality.applyFinishes(clone,item.finishColors);const changed=[];clone.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material||[]))if(m.userData.finishChannel==='fabric')changed.push(m.color.getHexString());});
  ST.selected=null;const queued=queueFmpInstance(source.model,item,new THREE.Group());
  const saved=serialized.items.find(i=>i.id===item.id);
  ST.selected=item;updateProps();const beforeReset=selectedModelFinishesHtml(item);updateSelectedProp('finishColors',null);
  return {saved:saved.finishColors,changed,queued,originalMaterial,beforeReset,reset:item.finishColors,channels:source.finishChannels};
 });
 assert.equal(runtime.saved.fabric,'#a75842');assert.ok(runtime.changed.every(c=>c==='a75842'));assert.equal(runtime.queued,false);assert.ok(runtime.originalMaterial.every(c=>c!=='a75842'));assert.equal(runtime.reset,null);assert.match(runtime.beforeReset,/素材・カラー/);
 await page.screenshot({path:`${dir}/app-properties-desktop.png`});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.getElementById('props').classList.add('show','prop-expanded');updateProps();document.getElementById('finish-fabric').scrollIntoView({block:'center'});});await page.screenshot({path:`${dir}/app-properties-mobile.png`});
 const picker=page.locator('#finish-fabric');await picker.fill('#52768a');
 assert.equal(await page.evaluate(()=>ST.selected.finishColors.fabric),'#52768a');
 assert.equal(await picker.inputValue(),'#52768a');
 await page.getByRole('button',{name:'素材の色を元に戻す',exact:true}).click();
 assert.equal(await page.evaluate(()=>ST.selected.finishColors),null);
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(async()=>{
  const types=['original-sofa','fmp-Sofa01','original-chair','original-table','original-bed','original-wardrobe','original-sideboard'];
  DATA.items=types.map((type,k)=>mkItem(type,(k%3)*3000,Math.floor(k/3)*3000,0,1));DATA.rooms=[];DATA.walls=[];
  DATA.items[0].finishColors={fabric:'#a75842',wood:'#533828'};ST.selected=null;
  for(const type of types){const item=getFmpItem(type);if(!_modelCache[item.model])await new Promise((resolve,reject)=>getGltfLoader().load(item.model,g=>{ModelQuality.prepare(g.scene,item.model);_modelCache[item.model]=g.scene;resolve();},undefined,reject));}
  setView('3d-ext');applyLightPreset('day');camExt.position.set(12,11,16);orbit.target.set(4,0,3.5);orbit.update();invalidate3D();
 });
 await page.waitForFunction(()=>!hasPendingGltfModels());await page.screenshot({path:`${dir}/app-coexistence.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/checks.json`,JSON.stringify({models:results,runtime,errors},null,2));console.log('PASS: six front/back checks, independent finish colors, cache isolation, persistence, reset, and deselected rendering.');
}finally{await browser.close();}
