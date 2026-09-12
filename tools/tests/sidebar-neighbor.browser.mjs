import assert from 'node:assert/strict';
import fs from 'node:fs';
// Playwright は CommonJS なので、名前付きで取れる環境と default 越しの環境がある。
const _pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const chromium=_pw.chromium||(_pw.default&&_pw.default.chromium);
const browser=await chromium.launch({args:['--use-angle=metal']});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.APP_URL||'http://localhost:8932/');await page.waitForSelector('.sidebar-credits');
  assert.equal(await page.locator('.sidebar-settings .sidebar-credits').count(),0);
  const icons=page.locator('.opening-model-default-tile img');assert.equal(await icons.count(),5);
  await icons.evaluateAll(images=>Promise.all(images.map(i=>{i.loading='eager';return i.decode();})));
  assert.equal(new Set(await icons.evaluateAll(is=>is.map(i=>i.src))).size,5);
  const result=await page.evaluate(async()=>{
   init3D();const gltf=await new Promise(r=>getGltfLoader().load(CONTEXT_HOUSE_KIT_GLB,r));_modelCache[CONTEXT_HOUSE_KIT_GLB]=gltf.scene;_nhKitMats=null;
   const it=mkItem('neighbor-house',0,0,0,1);it.contextGhost=false;
   const base=nhKitMaterials(gltf.scene,it),g=new THREE.Group();buildNeighborHouseKit(g,it,it.w/1000,it.d/1000);
   let glass=0,curtain=0;g.traverse(o=>{if(o.material?.name==='NhGlass')glass++;if(o.material?.name==='NhCurtain')curtain++;});
   finalizeContextGroup(g,it,true);let meshes=0;g.traverse(o=>{if(o.isMesh)meshes++;});if(meshes>45)throw Error('Unexpected unmerged detail meshes '+meshes);
   const ghost=nhKitMaterials(gltf.scene,{...it,contextGhost:true});ghost.NhWall.map=null;
   return{glass,curtain,transparent:base.NhGlass.transparent,alpha:base.NhGlass.opacity,wallMap:!!base.NhWall.map,bump:!!base.NhWall.bumpMap};
  });assert.ok(result.glass>0&&result.curtain>0);assert.ok(result.transparent&&result.alpha<.5);assert.ok(result.wallMap&&result.bump);
  if(width===390){await page.locator('#bnav-tools').click();await page.waitForTimeout(650);}
  await page.evaluate(()=>{document.getElementById('opening-window-model-tools').closest('.cat-body').classList.add('open');document.querySelector('#opening-window-model-tools .asset-grid').style.display='grid';});
  await page.locator('#opening-window-model-tools .asset-tile').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  fs.mkdirSync('docs/quality-review/sidebar-neighbor',{recursive:true});await page.screenshot({path:`docs/quality-review/sidebar-neighbor/windows-${width}.png`});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS desktop/mobile: five unique loaded opening previews, credits outside settings, transparent glazing and recessed curtains, independent ghost materials.');
}finally{await browser.close();}
