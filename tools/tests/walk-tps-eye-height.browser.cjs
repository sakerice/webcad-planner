// Actual production UI, JSON FileReader import, verified TPS and FPS fallback.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=process.env.EVIDENCE_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'webcad-tps-eye-height-'));fs.mkdirSync(out,{recursive:true});
const base=process.env.APP_URL||'http://127.0.0.1:8950';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
 const ctx=await browser.newContext({viewport:{width:900,height:720}}),page=await ctx.newPage(),result={checks:[],errors:[]};page.setDefaultTimeout(120000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('dialog',d=>d.accept());
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());
 const check=s=>{result.checks.push(s);console.log('PASS '+s);};
 try{
  await page.goto(base+'/?preset=blank');await page.evaluate(async()=>{await comparisonCatalogueReady;document.getElementById('preset-choice-modal')?.remove();_defaultPlanPending=false;});
  const fixture={walls:[],items:[],rooms:[{id:'eye-room',x:0,y:0,w:6000,d:6000,floor:1,n:'Eye height regression'}]};
  await page.locator('#import-file').setInputFiles({name:'eye-height.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>DATA.rooms.some(r=>r.id==='eye-room'));
  await page.evaluate(()=>setView('3d-walk'));await page.waitForFunction(()=>threeModulesReady&&WALK.active);
  await page.evaluate(()=>{WALK.x=3;WALK.z=3;WALK.yaw=0;walkUpdateGround(true);walkApplyCamera();});
  const eye=page.locator('#walk-height-toggle');await eye.dispatchEvent('click');
  const fpsSit=await page.evaluate(()=>({preset:WALK.eyePreset,y:camExt.position.y,expected:walkEyeY()}));assert.equal(fpsSit.preset,'sit');assert.equal(fpsSit.y,fpsSit.expected);check('actual FPS eye-height control changes the real camera');
  await page.locator('#walk-tps-mode').dispatchEvent('click');await page.waitForFunction(()=>WalkTps.cameraVerified());
  assert.equal(await eye.isDisabled(),true);assert.match(await eye.innerText(),/TPS/);await eye.dispatchEvent('click');assert.equal(await page.evaluate(()=>WALK.eyePreset),'sit');check('verified TPS disables eye-height and ignores direct activation');
  await page.screenshot({path:path.join(out,'eye-verified-tps.png')});
  await page.evaluate(()=>{DATA.rooms[0].ceiling={type:'void',toFloor:2};WalkTps.invalidate();WalkTps.update(.1);});
  assert.equal(await eye.isDisabled(),false);assert.equal(await page.evaluate(()=>camExt.position.y),fpsSit.y);
  await eye.dispatchEvent('click');assert.equal(await page.evaluate(()=>WALK.eyePreset),'stand');assert.equal(await page.evaluate(()=>camExt.position.y===walkEyeY()),true);check('FPS fallback enables eye-height with the stored preset and updates camera');
  await page.evaluate(()=>{delete DATA.rooms[0].ceiling;WalkTps.invalidate();WalkTps.update(.1);});await page.waitForFunction(()=>WalkTps.cameraVerified());assert.equal(await eye.isDisabled(),true);
  await page.locator('#walk-tps-mode').dispatchEvent('click');assert.equal(await eye.isDisabled(),false);assert.equal(await page.evaluate(()=>WALK.eyePreset),'stand');assert.equal(await page.evaluate(()=>camExt.position.y===walkEyeY()),true);check('FPS return re-enables the correct saved height');
  await page.setViewportSize({width:390,height:844});await page.locator('#walk-tps-mode').dispatchEvent('click');await page.waitForFunction(()=>WalkTps.cameraVerified());assert.equal(await eye.isDisabled(),true);await page.screenshot({path:path.join(out,'eye-mobile-tps.png')});check('mobile verified TPS exposes the disabled follow control');
  assert.deepEqual(result.errors,[]);result.status='passed';
 }catch(e){result.status='failed';result.failure=e.stack;throw e;}finally{fs.writeFileSync(path.join(out,'eye-height-browser.json'),JSON.stringify(result,null,2));await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
