// Render catalogue previews from the same normalized GLBs/materials as the app.
// PLAYWRIGHT_MODULE points to a local Playwright installation; no production writes.
import fs from 'node:fs';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const manifests=['furniture_mega','interior_model_0_26_1','custom'].map(p=>`assets/models/${p}/manifest.json`);
const contextTypes=['washer','futon_set','lattice-screen','tree','bicycle','bicycle-fold','fence','wood-fence','neighbor-building','neighbor-house','road','utility-pole','downspout','light-ceiling','light-down','light-spot'];
const items=manifests.flatMap(p=>JSON.parse(fs.readFileSync(p)).items).concat([{id:'context-car',model:'assets/models/refined/precision_car_v1.glb'},...contextTypes.map(type=>({id:'context-'+type,type}))]).filter(i=>!process.env.MODEL_FILTER||process.env.MODEL_FILTER.split(',').includes(i.id));
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 const page=await browser.newPage();await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForFunction(()=>window.THREE);await page.evaluate(()=>init3D());
 await page.evaluate(()=>{
  window.previewRenderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  previewRenderer.setSize(512,512);previewRenderer.outputColorSpace=THREE.SRGBColorSpace;previewRenderer.toneMapping=THREE.ACESFilmicToneMapping;previewRenderer.toneMappingExposure=1;
  const studio=new THREE.Scene();studio.background=new THREE.Color(0xbcc7d2);
  for(const pos of [[-3,4,3],[3,2,1],[0,5,-3]]){const card=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));card.position.set(...pos);card.lookAt(0,0,0);studio.add(card);}
  const pmrem=new THREE.PMREMGenerator(previewRenderer);window.previewEnvironment=pmrem.fromScene(studio);pmrem.dispose();
 });
 const results=[];
 for(const [index,item] of items.entries()){
  const out=await page.evaluate(async item=>{
   let g;
   if(item.type){
    const urls=[...(GLTF_MAP[item.type]?[GLTF_MAP[item.type]]:[]),CONTEXT_BIKE_GLB,CONTEXT_FBIKE_GLB,CONTEXT_HOUSE_KIT_GLB,CONTEXT_POLE_GLB,...Object.values(CONTEXT_GLB_SPECS).map(s=>s.url),...Object.values(EXTERIOR_MODEL_URLS)];
    for(const url of urls)if(!_modelCache[url]){const loaded=await new Promise((resolve,reject)=>getGltfLoader().load(url,resolve,undefined,reject));ModelQuality.prepare(loaded.scene,url);_modelCache[url]=loaded.scene;}
    const originalScene=sc3;sc3=new THREE.Scene();const it=mkItem(item.type,0,0,0,1);it.contextGhost=false;it.elev=0;
    buildItem3D(it);g={scene:new THREE.Group()};while(sc3.children.length)g.scene.add(sc3.children[0]);sc3=originalScene;const helpers=[];g.scene.traverse(o=>{if(o.isLight||o.userData.shadowHelper)helpers.push(o);if(item.type.startsWith('light-')&&o.isMesh){o.material=o.material.clone();o.material.emissiveIntensity=.05;}});helpers.forEach(o=>o.removeFromParent());
   }else{g=await new Promise((resolve,reject)=>getGltfLoader().load(item.model,resolve,undefined,reject));ModelQuality.prepare(g.scene,item.model);}
   const box=new THREE.Box3().setFromObject(g.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());g.scene.position.sub(center);
   const scene=new THREE.Scene();scene.environment=previewEnvironment.texture;scene.environmentIntensity=.5;scene.add(g.scene,new THREE.HemisphereLight(0xf0f5ff,0x8d857d,1.5));
   const light=new THREE.DirectionalLight(0xfff4e7,2.5);light.position.set(-3,5,4);scene.add(light);
   const extent=Math.max(size.x,size.y,size.z,.01);const camera=new THREE.OrthographicCamera(-extent*.72,extent*.72,extent*.72,-extent*.72,.001,extent*20+100);
   const frontView=['カーテン','ミラー','絵画','窓','ドア','壁装飾'].includes(item.category);
   camera.position.set(extent*(frontView?.65:2),extent*(item.type?.startsWith('light-')?-2:item.category==='カーペット'?5:frontView?.65:1.5),extent*3);camera.lookAt(0,0,0);// Fit projected bounds, not the longest world axis: narrow/tall assets remain readable.
   camera.updateMatrixWorld(true);const projected=[];
   for(const x of [-size.x/2,size.x/2])for(const y of [-size.y/2,size.y/2])for(const z of [-size.z/2,size.z/2])projected.push(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
   const minX=Math.min(...projected.map(p=>p.x)),maxX=Math.max(...projected.map(p=>p.x)),minY=Math.min(...projected.map(p=>p.y)),maxY=Math.max(...projected.map(p=>p.y));
   const half=Math.max(maxX-minX,maxY-minY)*.57;
   camera.left=(maxX+minX)/2-half;camera.right=(maxX+minX)/2+half;camera.bottom=(maxY+minY)/2-half;camera.top=(maxY+minY)/2+half;camera.updateProjectionMatrix();
   previewRenderer.render(scene,camera);const thumb=previewRenderer.domElement.toDataURL('image/png');
   const footprint=Math.max(size.x,size.z,.01)*.56;camera.left=-footprint;camera.right=footprint;camera.top=footprint;camera.bottom=-footprint;camera.position.set(0,extent*4+1,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateProjectionMatrix();previewRenderer.render(scene,camera);const top=previewRenderer.domElement.toDataURL('image/png');
   const geometries=new Set(),materials=new Set(),textures=new Set();g.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).forEach(m=>materials.add(m));});for(const m of materials){for(const v of Object.values(m))if(v&&v.isTexture)textures.add(v);if(!item.type)m.dispose();}if(!item.type){for(const t of textures)t.dispose();for(const g of geometries)g.dispose();}
   return {thumb,top};
  },item);
  const dir='assets/models/previews-v2';fs.mkdirSync(dir,{recursive:true});
  for(const kind of ['thumb','top'])fs.writeFileSync(`${dir}/${item.id}-${kind}.png`,Buffer.from(out[kind].split(',')[1],'base64'));
  results.push({id:item.id,thumb:`${dir}/${item.id}-thumb.png`,top:`${dir}/${item.id}-top.png`,previewVersion:2});
  if(index%25===0)console.log('rendered',index+1,'/',items.length);
 }
 const manifestPath='assets/models/previews-v2/manifest.json';
 const previous=process.env.MODEL_FILTER&&fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)).filter(i=>!results.some(r=>r.id===i.id)):[];
 fs.writeFileSync(manifestPath,JSON.stringify(previous.concat(results),null,2));
}finally{await browser.close();}
