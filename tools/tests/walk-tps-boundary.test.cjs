const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../../assets/js/walk-tps-boundary.js'),F=require('../../assets/js/walk-tps-foundation.js');
const room=(x,y,w,d)=>({x,y,w,d,floor:1});
function sweep(rooms,o,d,r=.24,length=2.6){const query=B.compile(rooms,'test-revision');assert.ok(query);return query({contractVersion:2,origin:o,direction:d,length,volume:{kind:'sphere',radius:r}}).distance;}
test('production boundary stops before the reported 18mm gap in both directions',()=>{
  const rs=[room(-1000,-2000,2000,2511),room(-1000,529,2000,4000)];
  assert.ok(Math.abs(sweep(rs,{x:0,y:1,z:0},{x:0,y:0,z:1})-.271)<1e-10);
  assert.ok(Math.abs(sweep(rs,{x:0,y:1,z:1},{x:0,y:0,z:-1})-.231)<1e-10);
});
test('adjacent rooms have no artificial seam; a camera volume already in a void has zero clearance',()=>{
  const rs=[room(0,0,3000,6000),room(3000,0,3000,6000)];
  assert.equal(sweep(rs,{x:2.8,y:1,z:3},{x:1,y:0,z:0}),2.6);
  assert.equal(sweep([room(0,0,6000,6000)],{x:-1,y:1,z:3},{x:1,y:0,z:0}),0);
});
test('orthogonal concavity uses RoomGeometry cells, not cached AABB',()=>{
  const r=room(0,0,6000,6000);r.shape={kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:6000,y:0},{x:6000,y:2000},{x:2000,y:2000},{x:2000,y:6000},{x:0,y:6000}]};
  assert.ok(Math.abs(sweep([r],{x:1,y:1,z:3},{x:1,y:0,z:0})-.76)<1e-10);
});
test('unsupported holes/non-orthogonal or nonfinite shapes explicitly decline certification',()=>{
  for(const shape of [{kind:'orthogonalPolygon',holes:[],outer:[]},{kind:'unknown'},
    {kind:'orthogonalPolygon',outer:[{x:0,y:0},{x:1000,y:0},{x:2000,y:1000},{x:0,y:1000}]}])assert.equal(B.compile([{...room(0,0,6000,6000),shape}],'r'),null);
  assert.equal(B.compile([room(NaN,0,2,2)],'r'),null);
});
test('near-plane radius from wide/near projection limits the real boundary adapter',()=>{
  const proj={kind:'perspective',centered:true,near:.5,aspect:3,verticalFovDegrees:90};
  const b=B.compile([room(-3000,-3000,6000,5100)],'r');
  const v=F.camera({x:0,y:2,z:0},0,0,2.6,.1,()=>2.6,b,proj);
  assert.equal(v.verified,true);assert.ok(v.position.z+v.volumeRadius<2.1);
});
