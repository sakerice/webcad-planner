'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createConverter}=require('../../assets/js/asset-pack-conversion.js');
const read=p=>JSON.parse(fs.readFileSync(p));
const rpg=read('assets/models/packs/rpg-mansion/manifest.json');
const legacy=new Map();for(const name of ['furniture_mega','interior_model_0_26_1','custom'])for(const item of read('assets/models/'+name+'/manifest.json').items)legacy.set(item.id,item);
const assets=[...legacy.values(),...rpg.items],contract=read('assets/models/packs/rpg-mansion/conversion-map.json'),converter=createConverter(contract,assets);
const item={id:'original-id',type:'fmp-Chair01',x:100,y:200,w:600,d:500,h:920,rot:37,floor:2,elev:17,flipX:true,color:'#abcabc',finishColors:{wood:'#111111',nonmatching:'#223344'},finishTextures:{nonmatching:'local-texture'},custom:{nested:[1,2]}};
const preview=(p,options={})=>converter.preview(p,{approvedIndexes:p.items.map((_,i)=>i),...options});
const plan=()=>({walls:[],rooms:[],items:[structuredClone(item),{id:'unknown',type:'not-known',x:0,y:0,w:100,d:100,h:100}],customRoot:{keep:true}});
test('clone-only exact mappings preserve identity, dimensions, pose, finishes and custom fields',()=>{
 const p=plan(),before=JSON.stringify(p),result=preview(p);assert.equal(result.changed,1);assert.equal(result.retained,1);assert.equal(JSON.stringify(p),before);
 const changed=result.plan.items[0];assert.equal(changed.type,'rpg-mansion-chair-01');for(const k of Object.keys(item))if(k!=='type')assert.deepEqual(changed[k],item[k]);
 assert.deepEqual(result.plan.items[1],p.items[1]);assert.deepEqual(result.plan.customRoot,p.customRoot);changed.custom.nested.push(3);assert.equal(p.items[0].custom.nested.length,2);
});
test('all 328 explicit proposals resolve, no legacy or reviewed 14 IDs are renamed',()=>{
 assert.equal(contract.mappings.length,328);assert.equal(rpg.items.length,50);assert.equal(legacy.size,787);
 for(const m of contract.mappings)assert.ok(rpg.items.some(i=>i.id===m.targetId));
 const old=read('assets/models/packs/rpg-mansion-contract/v0.1.0/reviewed-manifest.json');assert.deepEqual(rpg.items.slice(0,14),old.items);
});
test('unsupported, attached, excluded and extreme-scale objects remain byte-equivalent',()=>{
 for(const extra of [{wallId:'wall'},{parentId:'parent'},{supportId:'surface'},{attachment:{}},{assetPackConversion:{custom:'retained'}},{w:10000}]){const p=plan();Object.assign(p.items[0],extra);const r=preview(p);assert.equal(r.changed,0);assert.deepEqual(r.plan,p);}
 const p=plan(),r=preview(p,{excludedIndexes:[0]});assert.equal(r.changed,0);assert.deepEqual(r.plan,p);
});
test('missing height resolves from original asset, never from target; invalid dimensions keep source',()=>{
 const p=plan();delete p.items[0].h;const r=preview(p);assert.equal(r.plan.items[0].h,legacy.get('fmp-Chair01').h);
 p.items[0].h=-5;assert.equal(preview(p).plan.items[0].h,-5);assert.equal(preview(p).plan.items[0].assetPackConversion.renderHeightMm,legacy.get('fmp-Chair01').h);
 assert.equal(preview(p,{resolvedDimensions:[{h:-5}]}).changed,0);
});
test('conversion round-trips and is idempotent; preview does not change source history',()=>{
 const p=plan(),history=[JSON.stringify(p)],r=preview(p);assert.deepEqual(JSON.parse(JSON.stringify(r.plan)),r.plan);assert.deepEqual(preview(r.plan).plan,r.plan);assert.deepEqual(history,[JSON.stringify(p)]);
});
test('invalid mapping targets and duplicate source IDs fail without source mutation',()=>{
 assert.throws(()=>createConverter({...contract,mappings:[contract.mappings[0],contract.mappings[0]]},assets));assert.throws(()=>createConverter({...contract,mappings:[{sourceId:'x',targetId:'missing'}]},assets));
});

test('support/function-sensitive proposals stay unchanged until explicitly selected',()=>{const p=plan(),r=converter.preview(p);assert.equal(r.changed,0);assert.deepEqual(r.plan,p);assert.equal(r.rows[0].reviewRequired,true);assert.equal(r.rows[0].canSelect,true);assert.equal(preview(p).changed,1);});
test('ambiguous mounts/shapes and refrigeration have explicit retention reasons',()=>{const retained=new Map(contract.retained.map(r=>[r.sourceId,r.reason]));assert.match(retained.get('fmp-Refrigerator01'),/冷蔵設備/);assert.ok(contract.retained.some(r=>/L字/.test(r.reason)));assert.ok(contract.retained.some(r=>/壁付/.test(r.reason)));assert.equal(contract.mappings.some(r=>r.sourceId==='fridge'),false);});

test('v2 render height uses editor-resolved height instead of stored h or target nominal',()=>{const p=plan(),r=preview(p,{resolvedDimensions:[{h:994}]});assert.equal(r.plan.items[0].h,920);assert.equal(r.plan.items[0].assetPackConversion.sourceEffectiveHeightMm,994);const core=require('../../assets/js/asset-pack-conversion.js'),trusted=require('../../assets/js/asset-pack-conversion-contract.js');const renderHeight=i=>core.renderHeight(i,id=>assets.find(a=>a.id===id),trusted);assert.equal(renderHeight(r.plan.items[0]),994);for(const bad of [{...r.plan.items[0],type:'fmp-Chair01'},{...r.plan.items[0],assetPackConversion:{...r.plan.items[0].assetPackConversion,version:1}},{...r.plan.items[0],assetPackConversion:{...r.plan.items[0].assetPackConversion,renderHeightMm:NaN}},item])assert.equal(renderHeight(bad),null);});

test('imported v2 height requires trusted exact pair, source, revision and bounded normal value',()=>{const {renderHeight}=require('../../assets/js/asset-pack-conversion.js'),trusted=require('../../assets/js/asset-pack-conversion-contract.js'),p=preview(plan()).plan.items[0],lookup=id=>assets.find(a=>a.id===id),check=m=>renderHeight({...p,assetPackConversion:{...p.assetPackConversion,...m}},lookup,trusted);assert.ok(check({})>0);for(const h of [5e-324,0,-1,10000000,Infinity,NaN,100,'994'])assert.equal(check({renderHeightMm:h,sourceEffectiveHeightMm:h}),null);for(const m of [{sourceType:'not-an-asset'},{sourceType:'fmp-Bed02'},{targetType:'rpg-mansion-mirror-01'},{mappingVersion:'unknown'},{sourceEffectiveHeightMm:123}])assert.equal(check(m),null);assert.equal(renderHeight(p,()=>null,trusted),null);const nominal=lookup(p.type).h;for(const ratio of [.25,4])assert.equal(check({renderHeightMm:nominal*ratio,sourceEffectiveHeightMm:nominal*ratio}),nominal*ratio);assert.deepEqual(trusted.mappings,contract.mappings.map(r=>({sourceId:r.sourceId,targetId:r.targetId,native:r.kind==='native-explicit'})));assert.equal(trusted.revision,contract.revision);});
