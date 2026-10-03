const {test}=require('node:test');
const assert=require('node:assert/strict');
const TPS=require('../../assets/js/walk-tps-foundation.js');
const projection={kind:'perspective',centered:true,near:0.1,aspect:16/9,verticalFovDegrees:68};
const certified=distance=>({verification:'continuous-volume-v1',geometryRevision:'analytic-test-geometry-v1',distance});
const openBoundary=q=>certified(q.length);
function setup(){
  let pose={x:0,y:0,z:0,yaw:0,floor:1},socket={kind:'sit',signature:'chair-1:v1',
    pose:{x:0,y:0.45,z:-0.4,yaw:Math.PI,floor:1},approach:{x:0,y:0,z:0},reachable:true};
  let clears=0,restores=0,safe=true,fallback=null;
  const host={readPose:()=>pose,resolveSocket:()=>socket,isSafe:()=>safe,findSafe:()=>fallback,
    restorePose:p=>{pose=p;restores++;},clearInput:()=>clears++,castCamera:(_o,_d,l)=>l,
    sweepCameraBoundary:openBoundary,readCameraProjection:()=>projection};
  const c=TPS.create(host,{version:1,mode:'tps'});
  return {c,host,pose,setSocket:s=>socket=s,socket,setSafe:s=>safe=s,
    counts:()=>({clears,restores}),setFallback:p=>fallback=p};
}
test('missing/unknown profiles stay FPS; input object is unchanged',()=>{
  for(const p of [null,{}, {mode:'tps'},{version:2,mode:'tps'}]) assert.equal(TPS.profile(p).mode,'fps');
  const p={version:1,mode:'tps',future:'kept'};
  assert.equal(TPS.profile(p).mode,'tps');assert.equal(p.future,'kept');
});
test('actual movement drives idle/walking/turning; collision-held keys cannot fake a walk',()=>{
  const {c,pose}=setup();assert.equal(c.tick(1/60).state,'idle');
  pose.z-=0.03;assert.equal(c.tick(1/60).state,'walking');
  assert.equal(c.tick(1/60).state,'idle');pose.yaw=0.03;assert.equal(c.tick(1/60).state,'turning');
  pose.yaw+=2*Math.PI;assert.equal(c.tick(1/60).state,'idle');
});
test('nearby sockets never trigger automatically; explicit sit locks then cancel restores',()=>{
  const {c,counts}=setup();assert.equal(c.tick(0.1).locked,false);
  assert.equal(c.requestSit('chair-1'),true);assert.equal(c.tick(0.1).state,'sitting');
  for(let i=0;i<4;i++)c.tick(0.1);
  assert.equal(c.tick(0.1).state,'seated');assert.equal(c.requestSit('chair-1'),false);
  assert.equal(c.cancel(),true);assert.equal(c.tick(0.1).locked,false);assert.equal(counts().restores,1);
});
test('wrong floor, distant, occluded, unsupported sockets are refused',()=>{
  for(const change of [s=>s.pose.floor=2,s=>s.approach.z=5,s=>s.reachable=false,s=>s.kind='bath']){
    const {c,socket}=setup();change(socket);assert.equal(c.requestSit('chair-1'),false);
  }
});
test('parent-reported RPG seat anchor is a seat surface, not an inferred rig root or reachable action',()=>{
  // Numeric summary supplied by the parent; no GLB/package inspection is
  // claimed. This is a normalized HOST contract fixture, not raw asset schema.
  const local=[0,0.513499975,0.017105259],localActorYaw=Math.PI;
  const {c,host,pose,socket}=setup();
  // Mock an already-resolved host transform: +90deg around Y, translated
  // (10,2.8,20)m on floor 2. The module must not transform it a second time.
  Object.assign(pose,{x:10.9,y:2.8,z:20,yaw:0,floor:2});
  socket.pose={x:10+local[2],y:2.8+local[1],z:20-local[0],yaw:Math.PI/2+localActorYaw,floor:2};
  socket.approach={x:10.9,y:2.8,z:20}; // Proposal only; not reachability evidence.
  socket.signature='synthetic-host-revision:parent-reported-rpg-seat';
  delete socket.reachable;
  host.resolveSocket=id=>id==='explicit-rpg-seat'?socket:null;
  assert.equal(c.requestSit('chair'),false); // No name matching/discovery.
  assert.equal(c.requestSit('explicit-rpg-seat'),false);
  socket.reachable=false;assert.equal(c.requestSit('explicit-rpg-seat'),false);
  socket.reachable=true;assert.equal(c.requestSit('explicit-rpg-seat'),true);
  const s=c.tick(0.1);
  assert.deepEqual(s.avatar,socket.pose); // No -0.86m placeholder-rig adjustment.
  assert.equal(s.avatar.y,3.313499975);
  assert.equal(s.state,'sitting');assert.equal(s.motionSource,'procedural-placeholder');
});
test('moving or deleting seated furniture cancels safely',()=>{
  for(const deleted of [false,true]){
    const {c,socket,setSocket,counts}=setup();c.requestSit('chair-1');
    if(deleted)setSocket(null);else socket.signature='moved';
    assert.equal(c.tick(0.1).locked,false);assert.equal(counts().restores,1);
  }
});
test('no safe exit keeps movement locked; never restores unchecked coordinates',()=>{
  const {c,setSafe,counts}=setup();c.requestSit('chair-1');setSafe(false);
  assert.equal(c.cancel(),false);assert.equal(counts().restores,0);
  assert.equal(c.tick(0.1).state,'blocked');assert.equal(c.setMode('fps'),false);
  setSafe(true);assert.equal(c.cancel(),true);assert.equal(counts().restores,1);
});
test('reset across plans never restores a pose from the previous plan; dispose is idempotent',()=>{
  const {c,counts}=setup();c.requestSit('chair-1');c.reset();assert.equal(counts().restores,0);
  assert.equal(c.tick(0.1).locked,false);c.dispose();const before=counts();c.dispose();
  assert.deepEqual(counts(),before);assert.equal(c.tick(0.1),null);assert.equal(c.requestSit('chair-1'),false);
});
test('FPS switch safely ends the action and returns control to the host camera',()=>{
  const {c,counts}=setup();c.requestSit('chair-1');assert.equal(c.setMode('fps'),true);
  assert.equal(c.tick(0.1).camera,null);assert.equal(counts().restores,1);
});
test('expanded box cast stops a radius away from walls in both directions',()=>{
  const b={min:{x:-1,y:-1,z:1},max:{x:1,y:2,z:1.1}};
  assert.ok(Math.abs(TPS.castBoxes({x:0,y:0,z:0},{x:0,y:0,z:1},3,0.24,[b])-0.76)<1e-9);
  assert.ok(Math.abs(TPS.castBoxes({x:0,y:0,z:3},{x:0,y:0,z:-1},3,0.24,[b])-1.66)<1e-9);
  assert.equal(TPS.castBoxes({x:2,y:0,z:0},{x:0,y:0,z:1},3,0.24,[b]),3);
  assert.equal(TPS.castBoxes({x:0,y:0,z:1},{x:0,y:0,z:1},3,0.24,[b]),0);
});
test('camera retracts immediately, extends gradually, and fails closed',()=>{
  const p={x:0,y:1.2,z:0};
  const short=TPS.camera(p,0,0,2.6,1/60,()=>0.4,openBoundary,projection);
  assert.ok(short.distance<=0.36+1e-12);assert.equal(short.avatarVisible,false);
  const extend=TPS.camera(p,0,0,short.distance,1/60,()=>2.6,openBoundary,projection);
  assert.ok(extend.distance>short.distance&&extend.distance<1);
  const invalid=TPS.camera(p,0,0,2.6,0.1,()=>NaN,openBoundary,projection);
  assert.equal(invalid.distance,0);assert.equal(invalid.fallback,'host-fps');assert.equal(invalid.position,null);
});
test('18mm forbidden gap cannot be skipped: consume first continuous VOLUME contact',()=>{
  // Analytic fixture: forbidden infinite slab z=[.511,.529]. Both the origin
  // and desired endpoint are in allowed space; the connected prefix ends early.
  let query;
  const boundary=q=>{query=q;return certified((0.511-q.volume.radius-q.origin.z)/q.direction.z);};
  const v=TPS.camera({x:0,y:1,z:0},0,0,2.6,0.1,()=>2.6,boundary,projection);
  assert.equal(v.verified,true);assert.equal(query.contractVersion,2);
  assert.ok(v.position.z+query.volume.radius<0.511);
  assert.ok(v.distance<0.3); // No endpoint beyond the 18mm gap.
  // Reverse approach must stop at the opposite face, with volume clearance.
  const reverse=q=>certified((q.origin.z-0.529-q.volume.radius)/-q.direction.z);
  const r=TPS.camera({x:0,y:1,z:1},Math.PI,0,2.6,30,()=>2.6,reverse,projection);
  assert.ok(r.position.z-r.volumeRadius>0.529);
});
test('legacy point predicate and uncertified/missing geometry cannot verify camera safety',()=>{
  for(const boundary of [undefined,()=>true,()=>({distance:2.6}),()=>({...certified(2.6),geometryRevision:''}),
    ()=>certified(NaN),()=>certified(-1),()=>certified(3),()=>{throw Error('geometry missing');}]){
    const v=TPS.camera({x:0,y:1,z:0},0,0,2.6,0.1,()=>2.6,boundary,projection);
    assert.equal(v.verified,false);assert.equal(v.fallback,'host-fps');
    assert.equal(v.position,null);assert.equal(v.avatarVisible,false);
  }
});
test('a legacy host gets explicit FPS fallback instead of an unverified transform',()=>{
  const {c,host}=setup();delete host.sweepCameraBoundary;
  host.cameraAllowed=()=>true; // Deliberately cannot substitute for volume sweep.
  const v=c.tick(0.1).camera;
  assert.equal(v.reason,'boundary-unverified');assert.equal(v.position,null);
});
test('zero volume clearance never applies even an anchor transform',()=>{
  for(const [hit,limit] of [[0,2.6],[2.6,0]]){
    const v=TPS.camera({x:0,y:1,z:0},0,0,2.6,0.1,()=>hit,()=>certified(limit),projection);
    assert.equal(v.reason,'no-camera-clearance');assert.equal(v.position,null);
    assert.equal(v.verified,false);assert.equal(v.fallback,'host-fps');
  }
});
test('near-plane corners fit inside supplied volume after FOV/aspect/near changes',()=>{
  for(const p of [projection,{...projection,near:0.5,aspect:3,verticalFovDegrees:100},
    {...projection,near:0.8,aspect:0.5,verticalFovDegrees:85}]){
    let query,castRadius;
    const v=TPS.camera({x:0,y:2,z:0},0.7,0.4,2.6,0.1,(_a,_d,_l,r)=>{castRadius=r;return 2.6;},q=>{query=q;return certified(q.length);},p);
    const h=p.near*Math.tan(p.verticalFovDegrees*Math.PI/360),w=h*p.aspect;
    for(const x of [-w,w])for(const y of [-h,h])assert.ok(Math.hypot(x,y,p.near)<=query.volume.radius+1e-12);
    assert.equal(castRadius,query.volume.radius);assert.equal(v.volumeRadius,castRadius);
  }
});
test('resize expands swept volume and immediately retracts from a boundary',()=>{
  const p={x:0,y:2,z:0};
  const limit=q=>certified(Math.max(0,(2.1-q.volume.radius-q.origin.z)/q.direction.z));
  const small=TPS.camera(p,0,0,2.6,0.1,()=>2.6,limit,projection);
  const large=TPS.camera(p,0,0,small.distance,1/60,()=>2.6,limit,{...projection,near:0.5,aspect:3,verticalFovDegrees:90});
  assert.ok(large.distance<small.distance);
  assert.ok(large.position.z+large.volumeRadius<2.1);
});
test('missing/nonfinite/off-axis projection is explicitly unverified',()=>{
  for(const p of [null,{}, {...projection,near:NaN},{...projection,near:0},
    {...projection,aspect:Infinity},{...projection,verticalFovDegrees:180},{...projection,centered:false}]){
    assert.equal(TPS.cameraVolume(p),null);
    const v=TPS.camera({x:0,y:1,z:0},0,0,2.6,0.1,()=>2.6,openBoundary,p);
    assert.equal(v.reason,'projection-unverified');assert.equal(v.fallback,'host-fps');
  }
  const {c,host}=setup();host.readCameraProjection=()=>{throw Error('camera rebuilding');};
  assert.equal(c.tick(0.1).camera.reason,'projection-unverified');
});
test('low FPS/resume deltas are capped; no invalid transforms at zero or invalid delta',()=>{
  const {c,pose}=setup();c.tick(0);pose.z=-0.1;
  for(const dt of [0,-1,NaN,Infinity,30]){
    const s=c.tick(dt);assert.ok(Number.isFinite(s.phase));assert.ok(Number.isFinite(s.camera.distance));
    const v=TPS.camera({x:0,y:1,z:0},0,0,-1,dt,()=>2.6,openBoundary,projection);
    assert.ok(Number.isFinite(v.distance)&&v.distance>=0);
  }
  c.requestSit('chair-1');assert.equal(c.tick(30).state,'sitting');
});
test('seated look input rotates camera while the registered actor facing stays fixed',()=>{
  const {c,pose,socket}=setup();c.requestSit('chair-1');const a=c.tick(.1);
  pose.yaw=Math.PI/2;const b=c.tick(.1);
  assert.equal(b.avatar.yaw,socket.pose.yaw);assert.notEqual(a.camera.position.x,b.camera.position.x);
});
test('same sweep solver supports the standing-body prism without treating its height as a sphere',()=>{
  const box={min:{x:1,y:1.2,z:-1},max:{x:2,y:2,z:1}},o={x:0,y:.86,z:0},d={x:1,y:0,z:0};
  assert.equal(TPS.castBoxes(o,d,3,.28,[box]),3);
  assert.equal(TPS.castBoxes(o,d,3,{x:.28,y:.84,z:.28},[box]),.72);
});
test('explicit mirror pose shares safe cancellation but cannot enter through the sit API',()=>{
 const {c,socket,setSafe}=setup();socket.kind='mirror-pose';socket.pose.y=0;
 assert.equal(c.requestSit('mirror'),false);assert.equal(c.requestAction('mirror'),true);
 assert.equal(c.tick(.1).state,'posing');for(let i=0;i<4;i++)c.tick(.1);
 const held=c.tick(.1);assert.equal(held.state,'posed');assert.equal(held.actionKind,'mirror-pose');assert.equal(held.avatar.y,0);
 setSafe(false);assert.equal(c.cancel(),false);assert.equal(c.tick(.1).state,'blocked');setSafe(true);assert.equal(c.cancel(),true);assert.equal(c.tick(.1).actionKind,null);
});
test('removing or transforming a mirror socket cancels the shared action safely',()=>{
 for(const remove of [true,false]){const {c,socket,setSocket}=setup();socket.kind='mirror-pose';assert.equal(c.requestAction('mirror'),true);if(remove)setSocket(null);else socket.signature='moved';assert.equal(c.tick(.1).locked,false);}
});
test('unregistered actions remain rejected by the general action API',()=>{for(const kind of ['bath','dance','mirror']){const {c,socket}=setup();socket.kind=kind;assert.equal(c.requestAction('unknown'),false);}});
test('bath mock uses explicit support height and route-aware exit without moving the host into the tub',()=>{const {c,host,socket,pose}=setup();socket.kind='bath-pose';assert.equal(c.requestAction('bath'),false);socket.supportY=.14;socket.pose.y=.34;let exitReady=true;host.canExitAction=()=>exitReady;assert.equal(c.requestAction('bath'),true);for(let i=0;i<4;i++)c.tick(.1);assert.equal(c.tick(.1).state,'bathing');assert.equal(pose.y,0);exitReady=false;assert.equal(c.cancel(),false);const held=c.tick(.1);assert.equal(held.state,'blocked');assert.equal(held.avatar.y,.34);assert.equal(held.supportY,.14);assert.equal(c.setMode('fps'),false);exitReady=true;assert.equal(c.cancel(),true);assert.equal(c.tick(.1).locked,false);});
