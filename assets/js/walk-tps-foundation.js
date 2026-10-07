/* Experimental, opt-in TPS foundation. Production host lives in walk-tps.js.
 * Coordinates: metres, +Y up; yaw matches WALK (forward is -Z).
 * The host owns movement, collisions, floor sampling, input, renderer and scheduling.
 * No imported character or Mixamo clips: pose names are placeholder contracts only.
 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.WalkTpsFoundation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var VERSION=1;
  function point(p){ return {x:p.x,y:p.y,z:p.z}; }
  function finite(p){return p&&['x','y','z'].every(function(k){return Number.isFinite(p[k]);});}
  function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
  function angle(a){return Math.atan2(Math.sin(a),Math.cos(a));}
  function profile(value){
    // Unknown or older data must keep FPS. Never modify a plan to store this preference.
    return {version:VERSION,mode:value&&value.version===VERSION&&value.mode==='tps'?'tps':'fps'};
  }
  function poseCopy(p){return Object.assign(point(p),{yaw:p.yaw,floor:p.floor});}
  function validPose(p){return finite(p)&&Number.isFinite(p.yaw)&&Number.isFinite(p.floor);}

  // Conservative swept sphere against expanded boxes. Boxes must describe actual
  // wall/door/ceiling solids, not an entire room/building. Includes hidden solids.
  function castBoxes(origin,direction,length,radius,boxes){
    var nearest=length;
    boxes.forEach(function(box){
      var lo=0,hi=nearest;
      for(var i=0;i<3;i++){
        var key=['x','y','z'][i],pad=typeof radius==='number'?radius:radius[key];
        var a=box.min[key]-pad, b=box.max[key]+pad;
        if(Math.abs(direction[key])<1e-10){
          if(origin[key]<a||origin[key]>b) return;
        }else{
          var t1=(a-origin[key])/direction[key],t2=(b-origin[key])/direction[key];
          lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));
          if(lo>hi) return;
        }
      }
      nearest=Math.min(nearest,Math.max(0,lo));
    });
    return nearest;
  }

  function cameraVolume(projection){
    // A sphere at the optical centre encloses all four near-plane corners in
    // every orientation. Use the effective vertical FOV (including zoom).
    // Off-axis/orthographic cameras need a host-specific contract, not this one.
    if(!projection||projection.kind!=='perspective'||projection.centered!==true||
      !Number.isFinite(projection.near)||projection.near<=0||
      !Number.isFinite(projection.aspect)||projection.aspect<=0||
      !Number.isFinite(projection.verticalFovDegrees)||projection.verticalFovDegrees<=0||projection.verticalFovDegrees>=180)return null;
    var h=projection.near*Math.tan(projection.verticalFovDegrees*Math.PI/360),w=h*projection.aspect;
    var radius=Math.max(0.24,Math.hypot(projection.near,w,h));
    return Number.isFinite(radius)?{kind:'sphere',radius:radius,
      near:projection.near,nearHalfWidth:w,nearHalfHeight:h}:null;
  }

  function camera(anchor,yaw,pitch,previousDistance,dt,cast,boundary,projection){
    function unverified(reason){
      // DO NOT apply a guessed camera transform. The owner retains its existing
      // FPS path; even the anchor itself may have unverified volume clearance.
      return {contractVersion:2,verified:false,reason:reason,fallback:'host-fps',
        position:null,target:null,distance:0,avatarVisible:false};
    }
    if(!finite(anchor)||!Number.isFinite(yaw))return unverified('pose-unverified');
    var volume=cameraVolume(projection);
    if(!volume)return unverified('projection-unverified');
    if(typeof boundary!=='function')return unverified('boundary-unverified');
    // Bound pitch/boom to avoid a camera that goes through ceilings or far outside.
    pitch=Math.max(-0.35,Math.min(0.55,Number.isFinite(pitch)?pitch:0));
    var direction={x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch)+0.18,z:Math.cos(yaw)*Math.cos(pitch)};
    var norm=Math.hypot(direction.x,direction.y,direction.z);
    Object.keys(direction).forEach(function(k){direction[k]/=norm;});
    var desired=2.6;
    var hit,limit;
    try{
      hit=cast(anchor,direction,desired,volume.radius);
      // The host must certify the WHOLE swept volume's connected safe prefix
      // from distance 0. Endpoint tests and point sampling are not this contract.
      limit=boundary({contractVersion:2,origin:point(anchor),direction:point(direction),
        length:desired,volume:volume});
    }catch(e){return unverified('host-query-failed');}
    if(!Number.isFinite(hit)||hit<0)return unverified('collision-unverified');
    if(!limit||limit.verification!=='continuous-volume-v1'||
      typeof limit.geometryRevision!=='string'||!limit.geometryRevision||
      !Number.isFinite(limit.distance)||limit.distance<0||limit.distance>desired)return unverified('boundary-unverified');
    if(hit===0||limit.distance===0)return unverified('no-camera-clearance');
    var safe=Math.max(0,Math.min(desired,hit,limit.distance)-0.04);
    function at(d){return {x:anchor.x+direction.x*d,y:anchor.y+direction.y*d,z:anchor.z+direction.z*d};}
    var prior=Number.isFinite(previousDistance)?Math.max(0,Math.min(desired,previousDistance)):safe;
    dt=Number.isFinite(dt)?Math.max(0,Math.min(dt,0.1)):0;
    // Retract immediately; only extending may ease. Never interpolate through a wall.
    var boom=Math.min(safe,prior+(safe-prior)*(1-Math.exp(-8*dt)));
    if(Math.abs(safe-boom)<0.001)boom=safe;
    var target=boom>1e-6?point(anchor):{x:anchor.x-direction.x,y:anchor.y-direction.y,z:anchor.z-direction.z};
    return {contractVersion:2,verified:true,geometryRevision:limit.geometryRevision,volumeRadius:volume.radius,
      position:at(boom),target:target,distance:boom,avatarVisible:boom>=0.45};
  }

  // Presentation camera only: physical movement/action clearance remains with
  // the host. Local per-view occluder fading handles architectural obstruction.
  // "verified" here means a finite transform/projection, not collision freedom.
  function fixedCamera(anchor,yaw,pitch,projection){
    function invalid(reason){return {contractVersion:3,strategy:'fixed-distance',
      verified:false,reason:reason,fallback:'hold-tps',position:null,target:null,
      distance:2.6,avatarVisible:false,holding:true};}
    if(!finite(anchor)||!Number.isFinite(yaw)||!Number.isFinite(pitch))return invalid('pose-unverified');
    if(!cameraVolume(projection))return invalid('projection-unverified');
    pitch=Math.max(-0.35,Math.min(0.55,pitch));
    var direction={x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch)+0.18,z:Math.cos(yaw)*Math.cos(pitch)};
    var norm=Math.hypot(direction.x,direction.y,direction.z),boom=2.6;
    return {contractVersion:3,strategy:'fixed-distance',verified:true,holding:false,
      position:{x:anchor.x+direction.x/norm*boom,y:anchor.y+direction.y/norm*boom,z:anchor.z+direction.z/norm*boom},
      target:point(anchor),distance:boom,avatarVisible:true};
  }

  function create(host,preference){
    ['readPose','resolveSocket','isSafe','findSafe','restorePose','clearInput','castCamera'].forEach(function(k){
      if(typeof host[k]!=='function') throw new TypeError('TPS host requires '+k);
    });
    var prefs=profile(preference),previous=null,action=null,phase=0,boom=null,disposed=false;
    var state='idle',reason=null,lastCamera=null;
    function holdCamera(cameraReason){
      host.clearInput();
      return lastCamera?Object.assign({},lastCamera,{verified:false,holding:true,reason:cameraReason,fallback:'hold-tps'}):
        {contractVersion:3,strategy:'fixed-distance',verified:false,holding:true,reason:cameraReason,
          fallback:'hold-tps',position:null,target:null,distance:2.6,avatarVisible:false};
    }
    function frame(avatar,supportY,view,invalidAvatar){
      // Holding presentation must never restore an older action/placement.
      // State, lock, support and hiding always describe the current safety result.
      return {version:VERSION,mode:prefs.mode,state:avatar||action?state:'holding',reason:reason,
        avatar:avatar,phase:phase,motionSource:'procedural-placeholder',actionKind:action?action.kind:null,
        supportY:supportY,avatarHidden:!!invalidAvatar||!!action&&state==='blocked',locked:!!action,camera:view};
    }
    function socketChanged(s,p){
      return !s||s.kind!==action.kind||!validPose(s.pose)||
        (action.kind==='bath-pose'&&!Number.isFinite(s.supportY))||s.signature!==action.signature||s.pose.floor!==p.floor;
    }
    function cancel(why,restore){
      if(action&&restore){
        if(typeof host.canExitAction==='function'){
          var exitReady=false;
          try{exitReady=host.canExitAction({id:action.id,kind:action.kind,signature:action.signature})===true;}catch(e){}
          if(!exitReady){state='blocked';reason='no-safe-exit';host.clearInput();return false;}
        }
        var live=host.readPose();
        var candidates=[action.origin,live];
        var safe=candidates.find(function(p){return validPose(p)&&p.floor===live.floor&&host.isSafe(p);});
        if(!safe) safe=host.findSafe(live);
        if(!validPose(safe)||safe.floor!==live.floor||!host.isSafe(safe)){
          // Remain locked until the host can provide a safe spawn; never teleport
          // into furniture or fall back to an unchecked old coordinate.
          state='blocked';reason='no-safe-exit';host.clearInput();return false;
        }
        host.restorePose(poseCopy(safe));
      }
      action=null;state='idle';reason=why||null;previous=null;boom=null;
      if(why==='context-reset'||why==='disposed'||why==='mode-change')lastCamera=null;
      host.clearInput();return true;
    }
    function setMode(mode){
      if(disposed||!['fps','tps'].includes(mode))return false;
      if(!cancel('mode-change',true))return false;
      prefs.mode=mode;return true;
    }
    function requestAction(id,expectedKind){
      if(disposed||prefs.mode!=='tps'||action)return false;
      var p=host.readPose(),s=host.resolveSocket(id);
      // Socket availability is an explicit catalogue opt-in, never guessed by name.
      if(!validPose(p)||!s||!['sit','mirror-pose','bath-pose'].includes(s.kind)||(expectedKind&&s.kind!==expectedKind)||(s.kind==='bath-pose'&&!Number.isFinite(s.supportY))||!validPose(s.pose)||!finite(s.approach)||s.pose.floor!==p.floor||
        distance(p,s.approach)>1.25||!host.isSafe(p)||s.reachable!==true)return false;
      action={id:id,kind:s.kind,signature:s.signature,origin:poseCopy(p),
        lastPose:poseCopy(s.pose),supportY:Number.isFinite(s.supportY)?s.supportY:null};
      phase=0;state=s.kind==='bath-pose'?'entering':s.kind==='mirror-pose'?'posing':'sitting';reason=null;host.clearInput();return true;
    }
    function tick(seconds){
      if(disposed)return null;
      var dt=Math.max(0,Math.min(Number.isFinite(seconds)?seconds:0,0.1));
      var p=host.readPose();
      if(!validPose(p)){
        if(action&&socketChanged(host.resolveSocket(action.id),p)){cancel('socket-changed',true);p=host.readPose();}
        if(!validPose(p))return prefs.mode==='tps'?frame(action?poseCopy(action.lastPose):null,
          action?action.supportY:null,holdCamera('pose-unverified'),true):null;
      }
      var avatar=poseCopy(p),supportY=null;
      if(action){
        var s=host.resolveSocket(action.id);
        if(socketChanged(s,p)){
          cancel('socket-changed',true);p=host.readPose();
        }else{
          if(state!=='blocked'){
            action.lastPose=poseCopy(s.pose);action.supportY=Number.isFinite(s.supportY)?s.supportY:null;
            phase=Math.min(1,phase+dt/0.35);
            state=action.kind==='bath-pose'?(phase===1?'bathing':'entering'):action.kind==='mirror-pose'?(phase===1?'posed':'posing'):(phase===1?'seated':'sitting');
          }
        }
        // A refused exit is not a new placement. In particular, deletion may
        // remove the physical support, so retain diagnostics but hide the actor
        // until the host certifies an exit (or leaves the walkthrough context).
        avatar=action?poseCopy(action.lastPose):poseCopy(p);
        supportY=action?action.supportY:null;
      }
      if(!action){
        var same=previous&&previous.floor===p.floor;
        var speed=same&&dt>0?distance(p,previous)/dt:0;
        var turning=same&&Math.abs(angle(p.yaw-previous.yaw))>0.002;
        // Read actual displacement after host collision resolution, not held keys.
        state=speed>0.025?'walking':turning?'turning':'idle';
        phase=(phase+Math.min(speed,3)*dt/1.1)%1;
      }
      previous=poseCopy(p);
      var anchor={x:avatar.x,y:avatar.y+(action&&(action.kind==='bath-pose'||action.kind==='sit'&&state!=='blocked')?0.85:1.25),z:avatar.z};
      var projection=null;
      if(typeof host.readCameraProjection==='function'){
        try{projection=host.readCameraProjection();}catch(e){/* unavailable during host rebuild: fallback */}
      }
      var view=prefs.mode==='tps'?fixedCamera(anchor,p.yaw,Number.isFinite(p.pitch)?p.pitch:0,projection):null;
      if(view){if(view.verified)lastCamera=view;else view=holdCamera(view.reason);}
      return frame(avatar,supportY,view,false);
    }
    return {tick:tick,requestAction:requestAction,requestSit:function(id){return requestAction(id,'sit');},setMode:setMode,
      cancel:function(){return !disposed&&cancel('cancelled',true);},
      // A plan switch discards old coordinates. Host must spawn in the NEW plan.
      reset:function(){return !disposed&&cancel('context-reset',false);},
      dispose:function(){if(!disposed){cancel('disposed',false);disposed=true;}},
      preference:function(){return profile(prefs);}};
  }
  return {version:VERSION,cameraContractVersion:2,profile:profile,castBoxes:castBoxes,
    cameraVolume:cameraVolume,camera:camera,fixedCamera:fixedCamera,fixedCameraContractVersion:3,create:create};
});
