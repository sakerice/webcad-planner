'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'../..');
const {createRegistry,DEFAULT_PACK_ID}=require('../../assets/js/asset-pack-registry.js');
const {matches}=require('../../assets/js/asset-catalogue.js');
const rpg=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/models/packs/rpg-mansion/manifest.json')));
const legacy=()=>[{id:'chair',name:'日本の椅子',w:450,d:450,h:800,nested:{tags:['wood']}},{id:'fmp-Table01',name:'既存机',w:900,d:600,h:700}];

test('default and RPG packs keep canonical IDs, labels, order and dimensions',()=>{
 const input=legacy(),before=JSON.stringify(input),r=createRegistry(input,[rpg]);
 assert.deepEqual(r.listPacks().map(p=>[p.id,p.name,p.count]),[[DEFAULT_PACK_ID,'日本建築標準',2],['rpg-mansion','RPGアセット',14]]);
 assert.deepEqual(r.listCandidates().map(i=>i.id),input.map(i=>i.id));
 assert.deepEqual(r.getAsset('chair'),input[0]);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(r.listCandidates('rpg-mansion').map(i=>i.id),rpg.items.map(i=>i.id));
 assert.equal(r.listAssets().length,16);assert.equal(r.getAsset('rpg-mansion-chair-01').w,520);
});
test('unselected, malformed or unknown pack falls back, empty known pack stays empty',()=>{
 const r=createRegistry(legacy(),[rpg,{id:'empty',name:'Empty',items:[]}]);
 for(const id of [undefined,null,'','gone',0,false,{},'constructor','__proto__']){
  assert.equal(r.resolvePackId(id),DEFAULT_PACK_ID);assert.equal(r.listCandidates(id),r.listCandidates());
  assert.equal(r.hasCandidate('chair',id),true);assert.equal(r.hasCandidate('rpg-mansion-chair-01',id),false);
 }
 assert.equal(r.listCandidates('empty').length,0);assert.equal(r.resolvePackId('empty'),'empty');
 assert.equal(createRegistry(legacy()).resolvePackId('rpg-mansion'),DEFAULT_PACK_ID);
 assert.deepEqual(createRegistry([]).listCandidates(),[]);
});
test('registry snapshots neither freeze nor retain mutable caller data',()=>{
 const input=legacy(),pack=structuredClone(rpg),r=createRegistry(input,[pack]);
 assert.equal(Object.isFrozen(input[0]),false);input[0].nested.tags.push('changed');input.push({id:'later'});
 pack.items[0].w=123;pack.name='Changed';
 assert.deepEqual(r.getAsset('chair').nested.tags,['wood']);assert.equal(r.getAsset('later'),null);
 assert.equal(r.getAsset('rpg-mansion-chair-01').w,520);assert.equal(r.listPacks()[1].name,'RPGアセット');
 assert.throws(()=>r.getAsset('chair').nested.tags.push('bad'),TypeError);
 assert.throws(()=>r.listCandidates().pop(),TypeError);assert.throws(()=>r.listPacks()[0].assetIds.push('bad'),TypeError);
});
test('mixed and repeated placements resolve across 1000 pane-local selections without mutation',()=>{
 const r=createRegistry(legacy(),[rpg]);
 const plan={items:[{id:'item-1',type:'chair',x:0,y:0,rotation:30},{id:'item-2',type:'rpg-mansion-chair-01',x:700,y:500},{id:'item-3',type:'rpg-mansion-chair-01',x:900,y:500,finishColors:{fabric:'#abcdef'}},{id:'item-4',type:'missing-original-id',x:0,y:100}]};
 const json=JSON.stringify(plan),history=[json],paneA={pack:'rpg-mansion'},paneB={pack:DEFAULT_PACK_ID};
 const resolved=()=>plan.items.map(p=>r.getAsset(p.type));const initial=resolved();
 for(let i=0;i<1000;i++){
  paneA.pack=i%2?'rpg-mansion':DEFAULT_PACK_ID;r.listCandidates(paneA.pack);
  assert.equal(r.hasCandidate('chair',paneB.pack),true);assert.deepEqual(resolved(),initial);
 }
 assert.equal(initial[1],initial[2]);assert.equal(initial[3],null);
 assert.equal(plan.items.length,4);assert.equal(JSON.stringify(plan),json);assert.deepEqual(history,[json]);
 assert.deepEqual(JSON.parse(json),plan);assert.equal(paneB.pack,DEFAULT_PACK_ID);
});
test('one definition may belong to several packs; shared membership never remaps an ID',()=>{
 const r=createRegistry(legacy(),[{id:'favorites',name:'Shared',assetIds:['chair','rpg-mansion-key-01','chair']},rpg]);
 assert.deepEqual(r.listCandidates('favorites').map(i=>i.id),['chair','rpg-mansion-key-01']);
 assert.equal(r.listCandidates('favorites')[0],r.getAsset('chair'));
 assert.equal(r.listAssets().length,16);assert.equal(r.hasCandidate('chair','rpg-mansion'),false);
});
test('invalid registrations fail atomically, without modifying inputs or existing registry',()=>{
 const old=createRegistry(legacy(),[rpg]),before=JSON.stringify(old.listAssets());
 const bad=[
  [{id:DEFAULT_PACK_ID,name:'Replacement'}],
  [{id:'x',name:'X',namespace:'chair',items:[{id:'chair'}]}],
  [{id:'x',name:'X',namespace:'new-',items:[{id:'outside'}]}],
  [{id:'x',name:'X',assetIds:['unknown']}],
  [{id:'x',name:'X',items:[{id:'new-a'}]}],
  [{id:'x',name:'X',namespace:'new-',items:[{id:'new-a'},{id:'new-a'}]}],
  [{id:'x',name:'X',namespace:'n-',items:[{id:'n-a'}]},{id:'y',name:'Y',namespace:'n-',items:[{id:'n-b'}]}]
 ];
 for(const packs of bad){const snapshot=JSON.stringify(packs);assert.throws(()=>createRegistry(legacy(),packs));assert.equal(JSON.stringify(packs),snapshot);}
 assert.throws(()=>createRegistry([{id:'a'},{id:'a'}]));assert.throws(()=>createRegistry([{id:'x',n:NaN}]));
 const cyclic={id:'x'};cyclic.self=cyclic;assert.throws(()=>createRegistry([cyclic]));
 assert.equal(JSON.stringify(old.listAssets()),before);
});
test('prototype-like legacy IDs are ordinary keys; absent IDs do not turn into defaults',()=>{
 const r=createRegistry([{id:'__proto__'},{id:'constructor'},{id:'toString'}]);
 for(const id of ['__proto__','constructor','toString'])assert.equal(r.getAsset(id).id,id);
 for(const id of ['missing',undefined,null,{}])assert.equal(r.getAsset(id),null);
});
test('missing thumbnail stays missing for existing picker fallback; registry does not fetch',()=>{
 const r=createRegistry([{id:'no-thumb',name:'No image'},{id:'broken-thumb',thumb:'missing.png'}]);
 assert.equal(r.listCandidates().length,2);assert.equal(r.getAsset('no-thumb').thumb,undefined);
 assert.equal(r.getAsset('broken-thumb').thumb,'missing.png');
});
test('existing search matcher filters only selected candidates',()=>{
 const r=createRegistry(legacy(),[rpg]);
 const search=pack=>r.listCandidates(pack).filter(item=>matches(item.name+' '+item.id,'椅子'));
 assert.deepEqual(search(DEFAULT_PACK_ID).map(i=>i.id),['chair']);
 assert.deepEqual(search('rpg-mansion').map(i=>i.id),['rpg-mansion-chair-01','rpg-mansion-fallen-chair-01']);
});
test('browser-style load works with no DOM, storage or network capabilities',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(ROOT,'assets/js/asset-pack-registry.js'),'utf8'),context);
 assert.equal(vm.runInContext("AssetPackRegistry.createRegistry([{id:'native-wall'}]).getAsset('native-wall').id",context),'native-wall');
});
test('actual resolved PR72 catalogue preserves every existing ID and record',()=>{
 const map=new Map();
 for(const dir of ['furniture_mega','interior_model_0_26_1','custom'])for(const item of JSON.parse(fs.readFileSync(path.join(ROOT,'assets/models',dir,'manifest.json'))).items)map.set(item.id,item);
 const input=Array.from(map.values()),before=JSON.stringify(input),r=createRegistry(input,[rpg]);
 assert.deepEqual(r.listCandidates().map(i=>i.id),input.map(i=>i.id));
 for(const item of input)assert.deepEqual(r.getAsset(item.id),item);
 assert.equal(r.listAssets().length,input.length+14);assert.equal(JSON.stringify(input),before);
});
