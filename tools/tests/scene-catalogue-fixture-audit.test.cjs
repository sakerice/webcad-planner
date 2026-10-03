// Only represented units independently checked in the exact-ID audit are widened.
const test=require('node:test'),assert=require('node:assert/strict');
const {registry}=require('./scene-fixtures.cjs');
test('four audited individual fixtures expose exact source semantic compatibility without guessing axes',()=>{
 const r=registry();
 for(const [id,type] of Object.entries({'fmp-WashBasin01':'washbasin','fmp-ShowerSystem01':'shower-fixture','fmp-Toilet01':'toilet','original-toilet':'toilet'})){
  const model=r.get(id);assert.equal(model.semanticExtent,'individual-fixture');assert.equal(model.sourceObjectType,type);assert.equal(model.semanticExtentProvenance,'exact-id-manifest-and-thumbnail-audit');assert.equal(model.head,undefined);
 }
 assert.equal(r.get('fmp-WashBasin01').front,'+Z');assert.equal(r.get('original-toilet').front,'+Z');
 assert.equal(r.get('fmp-Toilet01').front,null);assert.equal(r.get('fmp-ShowerSystem01').front,null);
 for(const id of ['fmp-WashBasin02','fmp-ShowerSystem02','fmp-Toilet02','fmp-BathroomVanity01']){
  assert.equal(r.get(id).semanticExtent,'asset');assert.equal(r.get(id).sourceObjectType,undefined);
 }
 assert.equal(r.get('original-bathtub').semanticExtent,'individual-fixture');
});
