'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
fs.mkdirSync('tools/assets/rpg-pack-contract/expansion-evidence',{recursive:true});
const out='tools/assets/rpg-pack-contract/expansion-evidence/height-regression.json';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader']});try{
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(process.env.APP_URL||'http://127.0.0.1:8947/').origin?r.continue():r.abort());const page=await context.newPage();page.on('dialog',d=>d.accept());
 await page.goto((process.env.APP_URL||'http://127.0.0.1:8947/')+'?preset=blank');await page.waitForFunction(()=>AssetPackPicker?.getRegistry()?.listPacks().some(p=>p.count===50));
 const setup=await page.evaluate(async()=>{const contract=await(await fetch('assets/models/packs/rpg-mansion/conversion-map.json')).json(),rpg=await(await fetch('assets/models/packs/rpg-mansion/manifest.json')).json();const rows=contract.mappings.filter(m=>!m.reviewRequired);const source={walls:[],rooms:[],items:rows.map((m,i)=>{const a=getFmpItem(m.sourceId);return {id:'height-'+i,type:a.id,x:i*3000,y:0,w:a.w,d:a.d,h:123,rot:37,floor:1,elev:127};}),startMode:'blank'};const assets=[...rows.map(m=>getFmpItem(m.sourceId)),...rpg.items],resolved=source.items.map(i=>({h:getItemHeightValue(i)}));const p=AssetPackConversion.createConverter(contract,assets).preview(source,{resolvedDimensions:resolved});window.__heightSource=source;window.__heightConverted=p.plan;return {source,converted:p.plan,heights:resolved.map(d=>d.h),changed:p.changed,rows:p.rows};});assert.equal(setup.changed,20,JSON.stringify(setup.rows.filter(r=>!r.changed)));
 const measure=async(frame,plan)=>{await frame.evaluate(p=>applyJsonImport(stageJsonImport(JSON.stringify(p))),plan);return frame.evaluate(async()=>{
  init3D();const previous=sc3,selected=ST.selected;const results=[];
  try{for(const it of DATA.items){const f=getFmpItem(it.type);if(!_modelCache[f.model]){const g=await new Promise((r,j)=>getGltfLoader().load(f.model,r,undefined,j));ModelQuality.prepare(g.scene,f.model);_modelCache[f.model]=g.scene;}
   const row={id:it.id,type:it.type,effective:getItemHeightValue(it),stored:it.h};
   for(const mode of ['clone','instance']){sc3=new THREE.Scene();_fmpInstancePools={};ST.selected=mode==='clone'?it:null;buildItem3D(it);finalizeFmpInstancePools();sc3.updateMatrixWorld(true);const box=new THREE.Box3();let count=0;
    sc3.traverse(o=>{if(o.isInstancedMesh){const refs=o.userData.instanceRefs||[];refs.forEach((ref,i)=>{if(ref!==it)return;const m=new THREE.Matrix4();o.getMatrixAt(i,m);m.premultiply(o.matrixWorld);o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox.clone().applyMatrix4(m));count++;});}else if(o.userData.selectRef===it&&o.parent?.userData.selectRef!==it){box.union(new THREE.Box3().setFromObject(o));}});
    row[mode]={height:(box.max.y-box.min.y)*1000,minY:box.min.y*1000,instanceParts:count};
   }results.push(row);
  }}finally{sc3=previous;ST.selected=selected;_fmpInstancePools={};}return results;
 });};
 const result={before:await measure(page,setup.source),after:await measure(page,setup.converted)};
 for(let i=0;i<20;i++){assert.equal(result.before[i].effective,setup.heights[i]);assert.equal(result.after[i].effective,setup.heights[i]);for(const mode of ['clone','instance']){assert.ok(Math.abs(result.after[i][mode].height-setup.heights[i])<.02,JSON.stringify(result.after[i]));assert.equal(result.after[i].clone.instanceParts,0);assert.ok(result.after[i].instance.instanceParts>0);}}
 result.legacy=await page.evaluate(()=>{const plain={type:'rpg-mansion-mirror-01',h:123};return [getItemHeightValue(plain),getItemHeightValue({...plain,assetPackConversion:{version:1}}),getItemHeightValue({...plain,assetPackConversion:{version:2,targetType:plain.type,sourceType:'x',heightPolicy:'preserve-effective-height-v1',renderHeightMm:-1}})];});assert.deepEqual(result.legacy,[1520,1520,1520]);
 result.invalidImports=[];
 const validMirror=setup.converted.items.find(i=>i.type==='rpg-mansion-mirror-01');
 for(const change of [{renderHeightMm:5e-324,sourceEffectiveHeightMm:5e-324},{renderHeightMm:10000000,sourceEffectiveHeightMm:10000000},{sourceType:'not-an-asset'},{sourceType:'fmp-Chair01'},{mappingVersion:'unknown'},{renderHeightMm:100,sourceEffectiveHeightMm:100}]){
  const bad={walls:[],rooms:[],items:[{...validMirror,assetPackConversion:{...validMirror.assetPackConversion,...change}}],startMode:'blank'};
  assert.equal(await page.evaluate(p=>PlanSchema.validatePlan(p).ok,bad),true);
  const [r]=await measure(page,bad);assert.equal(r.effective,1520);for(const mode of ['clone','instance'])assert.ok(Math.abs(r[mode].height-1520)<.02);
  assert.deepEqual(await page.evaluate(()=>DATA.items[0].assetPackConversion),bad.items[0].assetPackConversion);result.invalidImports.push({change,...r});
 }
 await page.evaluate(async({source,converted})=>{applyJsonImport(stageJsonImport(JSON.stringify(source)));await ParallelEditors.openPlan(converted,'height regression');await ParallelEditors.saveWorkspace();},setup);
 await page.reload();await page.waitForFunction(()=>AssetPackPicker?.getRegistry()?.listPacks().some(p=>p.count===50));await page.evaluate(()=>ParallelEditors.open());await page.waitForFunction(()=>ParallelEditors.plans.size===2&&[...ParallelEditors.panes.values()].every(p=>p.ready));await page.evaluate(()=>ParallelEditors.loadWorkspace());await page.waitForFunction(()=>ParallelEditors.panes.size===2&&[...ParallelEditors.panes.values()].every(p=>p.ready));
 const frames=page.frames().filter(f=>f.url().includes('editorPane='));result.reloaded=[];for(const f of frames){const p=await f.evaluate(()=>JSON.parse(serializeDataSnapshot()));const measured=await measure(f,p);result.reloaded.push(measured);for(let i=0;i<20;i++){assert.equal(measured[i].effective,setup.heights[i]);const base=p.items[i].assetPackConversion?result.after[i]:result.before[i];assert.ok(Math.abs(measured[i].clone.height-base.clone.height)<.02,JSON.stringify(measured[i]));assert.ok(Math.abs(measured[i].instance.height-base.instance.height)<.02,JSON.stringify(measured[i]));}}
 result.status='passed';fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log('20 default mappings: real clone + instance bounding boxes, effective getter, legacy compatibility, saved fresh document and both panes passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
