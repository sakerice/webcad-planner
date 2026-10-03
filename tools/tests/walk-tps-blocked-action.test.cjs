const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const F=require('../../assets/js/walk-tps-foundation.js');
const three=import('../../assets/vendor/three/build/three.module.js');

function fixture(kind='bath-pose'){
  let live={x:3,y:.18,z:4.225,yaw:0,floor:2},safe=true,restores=0;
  let socket={kind,signature:'reflected-raised-v1',reachable:true,
    pose:{x:3.24,y:kind==='mirror-pose'?.18:.52,z:3,yaw:Math.PI/2,floor:2},
    supportY:.32,approach:{...live}};
  const controller=F.create({readPose:()=>live,resolveSocket:()=>socket,isSafe:()=>safe,
    findSafe:()=>null,restorePose:p=>{live=p;restores++;},clearInput(){},castCamera:(_a,_d,l)=>l,
    sweepCameraBoundary:q=>({verification:'continuous-volume-v1',geometryRevision:'fixture',distance:q.length}),
    readCameraProjection:()=>({kind:'perspective',centered:true,near:.1,aspect:1,verticalFovDegrees:68})
  },{version:1,mode:'tps'});
  assert.equal(controller.requestAction('explicit-socket'),true);
  const held=controller.tick(.1);
  return {controller,held,setUnsafe:()=>safe=false,setSafe:()=>safe=true,
    change:f=>socket=f(socket),live:()=>live,restores:()=>restores};
}

for(const kind of ['bath-pose','sit','mirror-pose']){
  test(`${kind}: deleted support and no safe exit never replace the held pose with live WALK`,async()=>{
    const q=fixture(kind),T=await three,root={};
    vm.runInNewContext(fs.readFileSync('assets/js/walk-tps-avatar.js','utf8'),{window:root});
    const actor=root.createWalkTpsPlaceholder(T);
    try{
      actor.pose(q.held,q.held.supportY);actor.group.updateMatrixWorld(true);
      const matrix=actor.group.matrixWorld.toArray(),bounds=new T.Box3().setFromObject(actor.group);
      q.setUnsafe();q.change(()=>null);
      for(const dt of [0,.016,.1,5]){
        const blocked=q.controller.tick(dt);
        assert.equal(blocked.locked,true);assert.equal(blocked.state,'blocked');
        assert.deepEqual(blocked.avatar,q.held.avatar);assert.equal(blocked.avatarHidden,true);
        assert.equal(blocked.supportY,q.held.supportY);assert.equal(q.restores(),0);
        assert.notDeepEqual(blocked.avatar,q.live());
        actor.pose(blocked,q.live().y);actor.group.updateMatrixWorld(true);
        assert.equal(actor.group.visible,false);assert.deepEqual(actor.group.matrixWorld.toArray(),matrix);
        assert.ok(new T.Box3().setFromObject(actor.group).equals(bounds));
      }
      assert.equal(q.controller.cancel(),false);assert.equal(q.controller.setMode('fps'),false);
      q.setSafe();assert.equal(q.controller.cancel(),true);assert.equal(q.restores(),1);
      const restored=q.controller.tick(.1);assert.equal(restored.locked,false);assert.equal(restored.avatarHidden,false);
      actor.pose(restored,q.live().y);assert.equal(actor.group.visible,true);
    }finally{actor.dispose();q.controller.dispose();}
  });
}

for(const [name,change] of [
  ['moved/reflected',s=>({...s,signature:'moved',pose:{...s.pose,x:9,yaw:-Math.PI/2}})],
  ['missing support height',s=>({...s,supportY:NaN})],
  ['wrong floor',s=>({...s,pose:{...s.pose,floor:1}})],
  ['invalid pose',s=>({...s,pose:{...s.pose,y:NaN}})]
])test(`blocked ${name} bath retains last action diagnostics and hides`,()=>{
  const q=fixture();q.setUnsafe();q.change(change);
  const blocked=q.controller.tick(.1);
  assert.equal(blocked.state,'blocked');assert.equal(blocked.avatarHidden,true);
  assert.deepEqual(blocked.avatar,q.held.avatar);assert.equal(blocked.supportY,.32);assert.equal(q.restores(),0);
  // Existing floor/plan/view lifecycle abandons an old context, never restores
  // an old action coordinate into a new floor. The host owns its new spawn.
  q.controller.reset();assert.equal(q.controller.tick(.1).locked,false);assert.equal(q.restores(),0);
});

test('valid socket with blocked exit also hides; explicit retry restores only once',()=>{
  const q=fixture();q.setUnsafe();assert.equal(q.controller.cancel(),false);
  const blocked=q.controller.tick(.1);assert.equal(blocked.avatarHidden,true);
  assert.deepEqual(blocked.avatar,q.held.avatar);assert.equal(blocked.supportY,.32);
  q.setSafe();assert.equal(q.controller.cancel(),true);assert.equal(q.restores(),1);
  assert.equal(q.controller.cancel(),true);assert.equal(q.restores(),1);
});
