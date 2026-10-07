/* Continuous per-part clearance for a compact mock bath pose.
 * The host supplies certified external solids and the registered tub surface.
 * This proves a route for the mock volumes, not a human climbing animation. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WalkTpsBathSafety=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create(T,createActor,F){var actor=null;
  function check(q){
   if(!q||!q.pose||!q.origin||![q.pose.x,q.pose.y,q.pose.z,q.pose.yaw,q.origin.x,q.origin.y,q.origin.z].every(Number.isFinite)||!Array.isArray(q.obstacles)||typeof q.boundary!=='function'||typeof q.approachClear!=='function'||!Array.isArray(q.surfaces)||!q.surfaces.length||q.surfaces.length>16384||!Number.isFinite(q.supportY)||!Number.isFinite(q.rimY)||q.pose.y-q.supportY<.12||q.pose.y-q.supportY>.4)return false;
   if(!actor)actor=createActor(T);
   actor.pose({mode:'tps',locked:true,state:'bathing',actionKind:'bath-pose',phase:1,avatar:q.pose,camera:{verified:true,avatarVisible:true}},q.supportY);actor.group.updateMatrixWorld(true);
   var parts=[];actor.group.traverse(function(m){if(m.isMesh)parts.push(new T.Box3().setFromObject(m));});
   if(!parts.length)return false;
   var bottom=Math.min.apply(null,parts.map(function(b){return b.min.y;}));
   var lift=Math.max(.12,q.rimY-bottom+.12),top=Math.max.apply(null,parts.map(function(b){return b.max.y;}))+lift;
   if(!q.approachClear(top-q.origin.y+.03))return false;
   var shifts=[new T.Vector3(q.origin.x-q.pose.x,lift,q.origin.z-q.pose.z),new T.Vector3(0,lift,0),new T.Vector3()];
   var solids=q.obstacles.concat(q.surfaces);
   return parts.every(function(b){var center=b.getCenter(new T.Vector3()),half=b.getSize(new T.Vector3()).multiplyScalar(.5);
    return shifts.slice(1).every(function(to,i){var from=shifts[i],a=center.clone().add(from),d=to.clone().sub(from),length=d.length();if(length<1e-9)return false;d.divideScalar(length);
     var edge=q.boundary({contractVersion:2,origin:a,direction:d,length:length,volume:{kind:'sphere',radius:Math.max(half.x,half.z)+.002}});
     return !!edge&&edge.verification==='continuous-volume-v1'&&edge.distance>=length-1e-8&&F.castBoxes(a,d,length,half,solids)>=length-1e-8;
    });
   });
  }
  return {check:check,dispose:function(){if(actor){actor.dispose();actor=null;}}};
 }
 return {create:create};
});
