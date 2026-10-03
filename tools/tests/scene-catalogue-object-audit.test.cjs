const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const C=require('../../assets/js/scene-catalogue.js');
const items={};for(const dir of ['furniture_mega','custom'])for(const item of JSON.parse(fs.readFileSync('assets/models/'+dir+'/manifest.json')).items)items[item.id]=item;
test('audited exact object IDs preserve real manifest dimensions, semantic extent and known front without family guesses',()=>{
 const c=C.create({items});
 for(const [id,type] of Object.entries({'fmp-Sofa01':'sofa','original-table':'dining-table','fmp-CabinetA_Sink':'kitchen-sink','fmp-Refrigerator01':'refrigerator','original-bathtub':'bathtub'})){
  const got=c.get(id),raw=items[id];assert.equal(got.sourceObjectType,type);assert.deepEqual([got.w,got.d,got.h],[raw.w,raw.d,raw.h]);assert.equal(got.front,raw.front||null);assert.equal(got.frontProvenance,raw.front?'manifest':'unknown');assert.equal(got.semanticExtent,['fmp-CabinetA_Sink','original-bathtub'].includes(id)?'individual-fixture':'asset');
 }
 for(const id of ['fmp-Sofa02','fmp-Refrigerator02'])if(c.get(id))assert.equal(c.get(id).sourceObjectType,undefined);
});
test('catalogue preserves only supplied valid head metadata and never guesses a bed axis',()=>{
 const input={a:{w:100,d:200,head:'-Z'},b:{w:100,d:200},c:{w:100,d:200,head:'made-up'}},before=JSON.stringify(input),r=C.create({items:input});
 assert.equal(r.get('a').head,'-Z');assert.equal(r.get('a').headProvenance,'manifest');assert.equal(r.get('b').head,undefined);assert.equal(r.get('c').head,undefined);assert.equal(JSON.stringify(input),before);
});
test('stable builtin kind audit is exact and respects aliases without inventing front/head metadata',()=>{
 const r=C.create({builtins:{'bed-s':{w:970,d:1950},desk:{w:1200,d:600},random:{w:1,d:1},sofa:{w:2100,d:850}},aliases:{sofa:'fmp-Sofa01'}});
 assert.equal(r.get('bed-s').kind,'bed');assert.equal(r.get('desk').kind,'desk');assert.equal(r.get('random').kind,null);assert.equal(r.get('sofa'),null);assert.equal(r.get('bed-s').front,null);assert.equal(r.get('bed-s').head,undefined);
});
