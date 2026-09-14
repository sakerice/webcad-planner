import fs from 'node:fs';
import assert from 'node:assert/strict';
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await (pw.chromium||pw.default.chromium).launch({args:['--use-angle=metal']});
const dir='docs/quality-review/detail-loop/kitchen-system';fs.mkdirSync(dir,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.APP_URL||'http://localhost:8932/');
 await page.waitForFunction(()=>window.THREE&&getFmpItem('original-kitchen-i2550'));
 const result=await page.evaluate(async()=>{
  const ids=Object.values(FMP_ITEMS).filter(m=>m.kitchenModules).map(m=>m.id);
  const checks={count:ids.length};
  const it=mkItem('original-kitchen-box-drawer450',1400,2200,90,1);it.elev=150;it.finishColors={wood:'#314e62'};it.finishRoughness={wood:.48};DATA.items.push(it);ST.selected=it;
  const stable=JSON.stringify([it.id,it.x,it.y,it.rot,it.floor,it.elev,it.finishColors,it.finishRoughness]);
  updateProps();checks.boxOptions=document.querySelectorAll('#kitchen-size option').length;
  document.querySelector('#kitchen-size').value='original-kitchen-box-drawer900';document.querySelector('#kitchen-size').dispatchEvent(new Event('change'));
  checks.width=it.w;checks.preserved=stable===JSON.stringify([it.id,it.x,it.y,it.rot,it.floor,it.elev,it.finishColors,it.finishRoughness]);
  undoAction();checks.undo=DATA.items.find(a=>a.id===it.id).type;
  redoAction();const restored=DATA.items.find(a=>a.id===it.id);checks.redo=restored.type;
  ST.selected=restored;restored.locked=true;updateSelectedKitchenVariant('original-kitchen-box-drawer600');checks.locked=restored.type;restored.locked=false;
  updateSelectedKitchenVariant('original-kitchen-i2550');checks.invalid=restored.type;
  const sample=mkItem('original-kitchen-i2550',0,0,0,1);DATA.items.push(sample);ST.selected=sample;updateProps();checks.planOptions=document.querySelectorAll('#kitchen-size option').length;
  checks.serialized=JSON.parse(serializeDataSnapshot()).items.find(a=>a.id===restored.id).finishColors.wood;
  init3D();checks.models=[];
  for(const id of ids){
   const m=getFmpItem(id);const gltf=await new Promise((resolve,reject)=>getGltfLoader().load(m.model,resolve,undefined,reject));
   ModelQuality.prepare(gltf.scene,m.model);_modelCache[m.model]=gltf.scene;
   const size=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());let triangles=0;gltf.scene.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});
   checks.models.push({id,size:size.toArray(),declared:[m.w,m.h,m.d].map(a=>a/1000),triangles});
  }
  checks.dishwasher=[];
  for(const m of Object.values(FMP_ITEMS).filter(m=>m.kitchenDishwasherVariant)){
   const it=mkItem(m.id,1000,2000,90,1);it.finishColors={wood:'#314e62'};it.elev=150;DATA.items.push(it);ST.selected=it;updateProps();
   const before=JSON.stringify([it.id,it.w,it.d,it.x,it.y,it.rot,it.elev,it.finishColors]);
   const control=document.querySelector('#kitchen-dishwasher');control.value=m.kitchenDishwasher?'no':'yes';control.dispatchEvent(new Event('change'));
   const changed=it.type===m.kitchenDishwasherVariant;
   const preserved=before===JSON.stringify([it.id,it.w,it.d,it.x,it.y,it.rot,it.elev,it.finishColors]);
   undoAction();const undone=DATA.items.find(a=>a.id===it.id).type===m.id;
   redoAction();const restored=DATA.items.find(a=>a.id===it.id);const redone=restored.type===m.kitchenDishwasherVariant;
   ST.selected=restored;restored.locked=true;updateSelectedKitchenDishwasher(m.kitchenDishwasher?'yes':'no');const locked=restored.type===m.kitchenDishwasherVariant;
   checks.dishwasher.push({id:m.id,changed,preserved,undone,redone,locked});
  }
  checks.sizePreservesDishwasher=[];
  for(const state of [true,false]){
   const m=Object.values(FMP_ITEMS).find(m=>m.kitchenFamily==='wall-ih'&&m.w===2100&&m.kitchenDishwasher===state);
   const it=mkItem(m.id,0,0,0,1);DATA.items.push(it);ST.selected=it;updateProps();
   const select=document.querySelector('#kitchen-size');select.selectedIndex=select.options.length-1;select.dispatchEvent(new Event('change'));
   checks.sizePreservesDishwasher.push(getFmpItem(it.type).kitchenDishwasher===state&&it.w===2700);
  }
  ST.selected=sample;updateProps();
  // Real app assembly, not just raw GLB rendering.
  const original=sc3;sc3=new THREE.Scene();buildItem3D(sample);const model=sc3;sc3=original;
  const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3());model.position.sub(center);model.background=new THREE.Color('#f0eee9');model.add(new THREE.HemisphereLight(0xf0f5ff,0x938371,2));const light=new THREE.DirectionalLight(0xfff6e9,3);light.position.set(-3,5,4);model.add(light);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1100,700);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const camera=new THREE.PerspectiveCamera(32,1100/700,.01,100);camera.position.set(3,2.2,4.8);camera.lookAt(0,0,0);renderer.render(model,camera);checks.runtime=renderer.domElement.toDataURL();checks.calls=renderer.info.render.calls;renderer.dispose();return checks;
 });
 assert.equal(result.count,21);assert.equal(result.boxOptions,4);assert.equal(result.planOptions,4);assert.equal(result.width,900);assert.equal(result.preserved,true);
 assert.equal(result.undo,'original-kitchen-box-drawer450');for(const k of ['redo','locked','invalid'])assert.equal(result[k],'original-kitchen-box-drawer900');assert.equal(result.serialized,'#314e62');
 for(const m of result.models){assert.ok(m.triangles>500);for(let i=0;i<3;i++)assert.ok(Math.abs(m.size[i]-m.declared[i])<.001,`${m.id} dimension ${i}: ${m.size[i]} vs ${m.declared[i]}`);}
 assert.deepEqual(result.sizePreservesDishwasher,[true,true]);
 for(const r of result.dishwasher)for(const k of ['changed','preserved','undone','redone','locked'])assert.equal(r[k],true,`${r.id}: ${k}`);
 fs.writeFileSync(`${dir}/runtime.png`,Buffer.from(result.runtime.split(',')[1],'base64'));delete result.runtime;
 await page.locator('#kitchen-dishwasher').screenshot({path:`${dir}/dishwasher-control.png`});
 await page.locator('#kitchen-size').screenshot({path:`${dir}/size-control.png`});assert.deepEqual(errors,[]);
 fs.writeFileSync(`${dir}/integration.json`,JSON.stringify(result,null,2));console.log('Kitchen catalogue, dimensions, dropdown, preservation, undo/redo, lock, serialization and app renderer passed.');
} finally {await browser.close();}
