const test=require('node:test'),assert=require('node:assert/strict'),{links}=require('../../assets/js/utility-wires.js');
const p=(x,z=0,angle=0)=>({x,z,angle,y:0,h:6.5});
test('aligned poles connect once and only outside ends extend',()=>{const a=links([p(0),p(20),p(40)]);assert.equal(a.filter(x=>x.to!=null).length,2);assert.equal(a.filter(x=>x.extension).length,2);});
test('sideways poles do not attract cables; rotation changes direction',()=>{assert.equal(links([p(0),p(0,20)]).filter(x=>x.to!=null).length,0);assert.equal(links([p(0,0,Math.PI/2),p(0,20,Math.PI/2)]).filter(x=>x.to!=null).length,1);});
test('isolated poles continue 250 metres in both directions',()=>{const a=links([p(0)]);assert.equal(a.length,2);assert.equal(a[0].end.x,-250);assert.equal(a[1].end.x,250);});
