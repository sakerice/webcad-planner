const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {applyFinishes,sourceYaw}=require('../../assets/js/model-quality.js');
function material(channel){return {userData:{finishChannel:channel},color:{value:'original',set(v){this.value=v;}},clone(){const own=material(channel);own.map=this.map;return own;},map:{texture:'grain'}};}
test('finish changes only the requested material and never mutate cached materials',()=>{
 const fabric=material('fabric'),wood=material('wood'),metal=material();const mesh={isMesh:true,material:[fabric,wood,metal]};
 applyFinishes({traverse:f=>f(mesh)},{fabric:'#aa6655'});
 assert.equal(mesh.material[0].color.value,'#aa6655');assert.equal(fabric.color.value,'original');assert.equal(mesh.material[1],wood);assert.equal(mesh.material[2],metal);assert.equal(mesh.material[0].map,fabric.map);
});
test('invalid finish values leave source materials intact',()=>{
 const m=material('wood'),mesh={isMesh:true,material:m};applyFinishes({traverse:f=>f(mesh)},{wood:'url(bad)'});assert.equal(mesh.material,m);
});
test('original collection has independent IDs, editable sources and canonical front metadata',()=>{
 const items=JSON.parse(fs.readFileSync('assets/models/custom/manifest.json')).items.filter(i=>i.provenance==='original');assert.equal(items.length,22);
 for(const i of items){
  assert.ok(i.id.startsWith('original-'));assert.ok(fs.existsSync('tools/blender/work/original/'+i.id+'.blend'));
  const b=fs.readFileSync(i.model),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
  assert.equal(j.asset.extras.front,'+Z');assert.equal(sourceYaw(i.model),0);
  for(const c of i.finishChannels)assert.ok(j.materials.some(m=>m.extras?.finishChannel===c.key));
  assert.ok(fs.existsSync(i.thumb));assert.ok(fs.existsSync(i.top));
 }
});
