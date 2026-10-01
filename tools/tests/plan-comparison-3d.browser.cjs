// Real renderer QA. Uses a frozen repository sample; never a personal plan.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1200},acceptDownloads:true});
    const errors=[],previewRequests=[],databaseOpens=[];
    page.on('pageerror',e=>errors.push(e.stack));
    await page.exposeFunction('recordPreviewDatabase',name=>databaseOpens.push(name));
    await page.addInitScript(()=>{if(window.parent!==window){const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(name,...args){window.recordPreviewDatabase(name);return open(name,...args);};}});
    page.on('request',r=>{if(r.frame().url().includes('comparisonPreview=1')&&new URL(r.url()).pathname.startsWith('/api/'))previewRequests.push(r.url());});
    await page.goto('http://localhost:8931');
    await page.waitForFunction(()=>window.THREE&&typeof setView==='function');
    const fixture=JSON.parse(fs.readFileSync(__dirname+'/fixtures/house-2f.json','utf8'));
    await page.evaluate(plan=>{
      _defaultPlanPending=false;DATA=plan;document.querySelectorAll('[id*=preset-choice]').forEach(e=>e.style.display='none');
      // Freeze only the test editor animation to keep camera assertions deterministic
      // and avoid software-GPU contention with the real comparison renderer.
      loop3D=function(){};ST.floor=1;setView('3d-int');orbit.enableDamping=false;orbit.autoRotate=false;orbit.update();
    },fixture);
    await page.waitForFunction(()=>!Object.values(_modelLoading).some(Boolean)&&!_textureRefreshPending,{},{timeout:60000});
    await page.waitForTimeout(1000);console.log('Live renderer initialized');
    await page.evaluate(()=>{saveState();ST.selected=DATA.rooms[0];});
    const signature=()=>page.evaluate(()=>JSON.stringify({DATA,ST,HISTORY,REDO_HISTORY,SHARED,pos:camExt.position.toArray(),target:orbit.target.toArray(),fov:camExt.fov}));
    const before=await signature();
    await page.locator('#compare-launch').click();
    await page.locator('#compare-name').fill('サンプル A / 既存仕上げ');await page.locator('#compare-save').click();
    await page.waitForFunction(()=>document.getElementById('compare-a').options.length===1);
    const variant=await page.evaluate(()=>JSON.parse(JSON.stringify(DATA)));
    variant.interiorWallSettings={whole:{linked:true,color:'#9CAD9F',texture:'plaster_white'},floors:{},faces:{}};
    await page.locator('#compare-name').fill('サンプル B / セージの塗り壁');
    await page.locator('#compare-import').setInputFiles({name:'sample-sage.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(variant))});
    await page.waitForFunction(()=>document.getElementById('compare-a').options.length===2);
    await page.evaluate(()=>{const el=document.getElementById('compare-room');const option=[...el.options].find(o=>o.textContent==='1F / LDK');if(option)el.value=option.value;});
    await page.locator('#compare-mode').selectOption('3d');
    const done=async()=>{await page.waitForFunction(()=>/失敗|内観3D ·/.test(document.getElementById('compare-status').textContent),{},{timeout:100000});const status=await page.locator('#compare-status').textContent();console.log(status);assert.match(status,/^内観3D ·/);};
    await done();console.log('First material pair captured');
    const capture=await page.evaluate(()=>PlanComparison.lastCapture);
    assert.deepEqual(capture[0].actual,capture[1].actual,'camera, FOV, dimensions and lighting match exactly');
    assert.notEqual(await page.locator('#compare-a-image').getAttribute('src'),await page.locator('#compare-b-image').getAttribute('src'),'material change produces different images');
    assert.equal(await signature(),before,'live editor and camera must remain intact');
    await page.locator('#compare-camera-name').fill('LDK / 共通カメラ');await page.locator('#compare-save-camera').click();
    await page.waitForFunction(()=>document.getElementById('compare-cameras').options.length===1);
    fs.mkdirSync('/tmp/webcad-comparison',{recursive:true});
    fs.writeFileSync('/tmp/webcad-comparison/3d-capture-spec.json',JSON.stringify(capture,null,2));
    await page.screenshot({path:'/tmp/webcad-comparison/3d-desktop.png'});
    const download=page.waitForEvent('download');await page.locator('#compare-images').click();await (await download).saveAs('/tmp/webcad-comparison/3d-comparison.png');
    // Cancel and repeated requests remove the preview runtime without stale results.
    await page.evaluate(()=>{document.getElementById('compare-recapture').click();document.getElementById('compare-recapture').click();document.getElementById('compare-cancel-capture').click();});
    await page.waitForTimeout(200);
    assert.equal(await page.locator('iframe[src*="comparisonPreview"]').count(),0);
    assert.equal(await signature(),before);
    await page.locator('#compare-recapture').click();await page.keyboard.press('Escape');await page.waitForTimeout(200);
    assert.equal(await page.locator('iframe[src*="comparisonPreview"]').count(),0);assert.equal(await signature(),before);
    // Reopen restores the saved common camera, then verify mobile image layout.
    await page.evaluate(()=>PlanComparison.open());await done();
    await page.setViewportSize({width:390,height:844});
    await page.locator('#compare-dialog').evaluate(el=>el.scrollTop=420);
    await page.screenshot({path:'/tmp/webcad-comparison/3d-mobile.png'});
    assert.ok(await page.locator('#compare-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.reload();await page.waitForFunction(()=>window.PlanComparison);await page.evaluate(()=>PlanComparison.open());
    await page.waitForFunction(()=>document.getElementById('compare-cameras').options.length===1);
    assert.deepEqual(previewRequests,[]);assert.deepEqual(databaseOpens,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:'3D material difference; exact shared camera/FOV/lighting/size; live plan/history/camera intact; cancellation; repeated captures; close/reopen; PNG; mobile; camera persistence; no preview API/database access',errors,previewRequests,databaseOpens}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
