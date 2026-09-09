// Visual evidence from the real app; run with PLAYWRIGHT_MODULE and APP_URL.
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.REVIEW_DIR || 'docs/quality-review/default-plans-2026-09';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',args:['--use-angle=metal']});
 const errors=[];
 try {
  for(const preset of (process.env.PRESET ? [process.env.PRESET] : ['2f','3f'])) {
   const page=await browser.newPage({viewport:{width:1440,height:1000}});
   page.on('pageerror',e=>errors.push(`${preset}: ${e.message}`));
   await page.goto(`${process.env.APP_URL||'http://localhost:8937/'}?preset=${preset}`);
   await page.waitForFunction(key=>typeof PRESET_CURRENT!=='undefined'&&PRESET_CURRENT===key&&DATA.rooms.length>0,preset);
   async function settled(){await page.waitForFunction(()=>typeof hasPendingGltfModels==='function'&&!hasPendingGltfModels()&&!_gltfRebuildTimer,{},{timeout:90000});await page.waitForTimeout(350);}
   async function shot(name){await settled();await page.screenshot({path:`${out}/${preset}-${name}.png`});console.log(`${preset}-${name}`);}
   for(let floor=1;floor<=Number(preset[0]);floor++) {
    await page.evaluate(f=>{onFloorChange(f);document.getElementById("floor-sel").value=f;setView('2d');resetView();},floor);
    await shot(`plan-${floor}`);
    await page.evaluate(()=>setView('3d-int'));await settled();
    await page.evaluate(f=>{const h=floorTopY(f);applyStashedCamera({pos:[presetWidth()+5,h+12,15],target:[presetWidth()/2,h,4]});function presetWidth(){return PRESET_CURRENT==='2f'?8.19:5.46;}invalidate3D();},floor);
    await shot(`interior-${floor}`);
   }
   await page.evaluate(()=>{onFloorChange(1);document.getElementById("floor-sel").value=1;setView('3d-ext');});await settled();
   const exterior=preset==='2f'?{pos:[15,7,20],target:[4.1,2.8,4]}:{pos:[12,8,20],target:[2.73,4,4]};
   await page.evaluate(s=>{applyStashedCamera(s);invalidate3D();},exterior);await shot('exterior');
   const views=preset==='2f' ? [
    ['entry',1,7.7,6.8,6.8,4.5],['kitchen',1,5.95,4.5,4.8,2.2],['living',1,3.3,6.5,1.2,3.8],['dining',1,3.3,5.7,5.1,1.7],['utility',1,3.2,3.1,2.1,2.3],['washroom',1,3,1.5,2.5,.2],
    ['bedroom',2,6,4.7,4.8,5.8],['void',1,3.3,6.8,1.7,4.5,.35],['gallery',2,2,3.15,1.7,6,-.35]
   ] : [
    ['entry',1,4.9,7.7,3.9,6.1],['washroom',1,2.8,1.5,3.1,.3],['living',2,3.1,7.2,.3,5.6],['dining',2,3,5.3,1.3,1.8],['bedroom',1,2.1,6.7,1.2,4.1],
    ['child-a',3,2.1,2.2,1.8,.7],['child-b',3,2.1,4.9,1.8,3.4],['void',2,4.1,4.6,2,7.5,.3],['void-ceiling',2,4.1,7.5,2,5.8,.35],['gallery',3,4.1,5.35,3,7.4,-.65],['study',2,4.1,7.3,5.1,6.2]
   ];
   for(const [name,floor,x,z,tx,tz,pitch=-.04] of views){
    await page.evaluate(f=>{onFloorChange(f);document.getElementById("floor-sel").value=f;setView('3d-walk');},floor);await settled();
    await page.evaluate(v=>{WALK.floor=v.floor;WALK.x=v.x;WALK.z=v.z;WALK.pitch=v.pitch;WALK.yaw=Math.atan2(-(v.tx-v.x),-(v.tz-v.z));WALK.groundOff=0;walkApplyCamera();invalidate3D();},{floor,x,z:z+(preset==='2f'?-.6:0),tx,tz:tz+(preset==='2f'?-.6:0),pitch});
    await shot(name);
   }
   const stats=await page.evaluate(()=>({failed:Object.keys(_modelFailed).filter(k=>_modelFailed[k]),cached:Object.keys(_modelCache).length,rooms:DATA.rooms.length,items:DATA.items.length}));
   fs.writeFileSync(`${out}/${preset}-runtime.json`,JSON.stringify(stats,null,2));
   if(stats.failed.length)errors.push(`${preset}: model failures ${stats.failed.join(',')}`);
   await page.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(`${out}/browser-errors.json`,JSON.stringify(errors,null,2));
 if(errors.length)throw new Error(errors.join('\n'));
})();
