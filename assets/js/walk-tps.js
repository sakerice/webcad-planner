/* One TPS owner per real editor/pane. Uses WALK movement, floor sampling,
 * renderer and scene geometry; never installs a second controller or RAF. */
(function(root){
  'use strict';
  var F=root.WalkTpsFoundation,controller=null,avatar=null,output=null,disposed=false;
  var plan=null,floor=null,scene=null,revision=0,boundary=null,boxes=[],sockets=[],stale=true,sceneReady=false;
  var bathSafety=null,bathCache=null,collectionRevision=0;
  var prefs=F.profile(null),candidate=null,candidateKind=null,uiKey=null,planStages=0;
  function clearInput(){WALK.keys={};Object.keys(iMov).forEach(function(k){iMov[k]=false;});}
  function pose(){return {x:WALK.x,y:floorTopY(WALK.floor)+(WALK.groundOff||0),z:WALK.z,yaw:WALK.yaw,pitch:WALK.pitch||0,floor:WALK.floor};}
  function invalidate(){stale=true;revision++;}
  function releaseAvatar(){if(avatar){avatar.dispose();avatar=null;}if(bathSafety){bathSafety.dispose();bathSafety=null;}bathCache=null;}
  function reset(resetPreference){
    if(planStages)return;
    if(controller)controller.reset();output=null;candidate=null;releaseAvatar();
    boxes=[];sockets=[];boundary=null;stale=true;clearInput();
    if(resetPreference){prefs=F.profile(null);if(controller)controller.setMode('fps');}
  }
  function context(){
    if(planStages)return;
    var changed=plan!==DATA,hadPlan=!!plan;
    if(changed||floor!==WALK.floor){
      reset(changed);plan=DATA;floor=WALK.floor;
      if(changed&&hadPlan&&WALK.active){
        // Use the host spawn after a committed plan replacement. Retain the
        // selected floor if it has rooms; otherwise choose a real room floor.
        var rooms=DATA.rooms||[],next=rooms.some(function(r){return r.floor===ST.floor;})?ST.floor:rooms.length?rooms[0].floor:ST.floor;
        if(next!==ST.floor){
          document.getElementById('floor-sel').value=String(next);onFloorChange(next);
        }else{_walkCollFloor=null;walkSpawn();walkApplyFpsCamera();drawWalkMinimap();}
        floor=WALK.floor;
      }
    }
    if(scene!==sc3){releaseAvatar();scene=sc3;invalidate();}
  }
  function isStairAt(p){return walkStairSampleAt(p.x/U,p.z/U,p.floor,0)!==null||walkLevelStairGroundAt(p.x/U,p.z/U,p.floor,0)!==null;}
  function collect(){
    collectionRevision++;bathCache=null;
    boxes=[];sockets=[];sceneReady=!!sc3&&!hasPendingGltfModels()&&!_tablet3DRebuildQueued;
    if(!sc3)return;
    sc3.updateMatrixWorld(true);
    function add(m,matrix,ref,kind){
      var determinant=matrix.determinant();
      if(!matrix.elements.every(Number.isFinite)||!Number.isFinite(determinant)||Math.abs(determinant)<1e-12){sceneReady=false;return;}
      if(!m.geometry.boundingBox)m.geometry.computeBoundingBox();
      var b=m.geometry.boundingBox&&m.geometry.boundingBox.clone().applyMatrix4(matrix);
      if(!b||b.isEmpty()||![...b.min.toArray(),...b.max.toArray()].every(Number.isFinite)){sceneReady=false;return;}
      boxes.push({min:b.min,max:b.max,ref:ref,kind:kind,local:m.geometry.boundingBox.clone(),inverse:matrix.clone().invert(),geometry:m.geometry,matrix:matrix.clone()});
    }
    sc3.traverse(function(m){
      var socketSpec=m.userData.walkSeatSocket||m.userData.walkActionSocket;
      if(socketSpec&&m.userData.selectRef)sockets.push({group:m,item:m.userData.selectRef,spec:socketSpec});
      // Built geometry is marked by the existing scene builder; exclude sky,
      // explicitly tagged non-physical helpers and our private actor. Hidden built
      // walls still count; transparency/visibility alone never excludes a solid.
      if(!m.isMesh||!m.geometry||!m.userData.b||m.userData.setbackHelper||
        m.userData.selectionHelper||m.userData.moveGizmo||m.userData.hitProxy||m.userData.shadowHelper)return;
      if(m.isInstancedMesh){
        var a=new THREE.Matrix4(),world=new THREE.Matrix4();
        for(var i=0;i<m.count;i++){
          m.getMatrixAt(i,a);
          if(m.userData.instanceWalkVisible&&m.userData.instanceWalkVisible[i]===false){
            // The renderer hides other-floor instances with an exact zero-scale
            // matrix. Their immutable physical placement still counts as solid.
            var physical=(m.userData.instanceBaseMatrices||[])[i];
            if(!a.elements.every(function(value,index){return value===(index===15?1:0);})||!physical||!physical.isMatrix4){sceneReady=false;continue;}
            a.copy(physical);
          }
          world.multiplyMatrices(m.matrixWorld,a);add(m,world,(m.userData.instanceRefs||[])[i],m.userData.selectKind);
        }
      }else add(m,m.matrixWorld,m.userData.selectRef,m.userData.selectKind);
    });
    var rooms=DATA.rooms.filter(function(r){return r.floor===WALK.floor&&!r.hidden3D;}),heightKnown=true;
    // Reuse resolved room/floor heights even when the renderer cuts a ceiling
    // away. Unknown/sloped/custom ceilings decline this first vertical slice.
    rooms.forEach(function(r){
      try{
        if(roomIsVoidCeiling(r)||roomCeilingProfile(r)||
          (typeof CeilingDesigner!=='undefined'&&CeilingDesigner.areas(r).length)){heightKnown=false;return;}
        var bottom=roomFloorTopY(r),top=floorBaseY(r.floor)+roomCeilingHeightM(r);
        if(!Number.isFinite(bottom)||!Number.isFinite(top)||top<=bottom){heightKnown=false;return;}
        RoomGeometry.cells(r).forEach(function(c){
          boxes.push({min:{x:c.x*U,y:-10000,z:c.y*U},max:{x:(c.x+c.w)*U,y:bottom,z:(c.y+c.d)*U},ref:r,kind:'room'});
          boxes.push({min:{x:c.x*U,y:top,z:c.y*U},max:{x:(c.x+c.w)*U,y:10000,z:(c.y+c.d)*U},ref:r,kind:'room'});
        });
      }catch(e){heightKnown=false;}
    });
    boundary=heightKnown?root.WalkTpsBoundary.compile(rooms,'scene-'+revision+'-floor-'+WALK.floor):null;
    // Hidden solids cannot be certified using absent meshes.
    if(DATA.walls.concat(DATA.items).some(function(i){return i.floor===WALK.floor&&i.hidden3D;}))sceneReady=false;
    stale=false;
  }
  function sweep(q){
    if(!sceneReady||!boundary||isStairAt(pose()))return null;
    return boundary(q);
  }
  function boundaryClear(a,b,r){
    if(!sceneReady||!boundary)return false;
    var d=new THREE.Vector3(b.x-a.x,0,b.z-a.z),length=d.length();if(length)d.divideScalar(length);
    var v=boundary({contractVersion:2,origin:a,direction:d,length:length,volume:{kind:'sphere',radius:r}});
    return !!v&&v.distance>=length-1e-8&&(length>0||v.distance===0&&
      boundary({contractVersion:2,origin:a,direction:{x:1,y:0,z:0},length:0.001,volume:{kind:'sphere',radius:r}}).distance>0);
  }
  function obstacles(p,ignore){
    // Enclosing body prism uses the existing solid boxes. Ground contact is
    // allowed, but surfaces/other furniture extending above the feet are not.
    var all=boxes.filter(function(b){return b.ref!==ignore&&b.max.y>p.y+0.015;});
    DATA.rooms.filter(function(r){return r.floor===p.floor&&Math.abs(roomFloorTopY(r)-p.y)>0.015;}).forEach(function(r){
      RoomGeometry.cells(r).forEach(function(c){all.push({min:{x:c.x*U,y:-10000,z:c.y*U},max:{x:(c.x+c.w)*U,y:10000,z:(c.y+c.d)*U}});});
    });
    DATA.items.filter(function(i){return i.floor===p.floor&&isStairPartType(i.type);}).forEach(function(i){
      var corners=getObjBounds(i),xs=corners.map(function(c){return c.x*U;}),zs=corners.map(function(c){return c.y*U;});
      all.push({min:{x:Math.min.apply(null,xs),y:-10000,z:Math.min.apply(null,zs)},max:{x:Math.max.apply(null,xs),y:10000,z:Math.max.apply(null,zs)}});
    });
    return all;
  }
  function bodyClear(a,b,ignore,radius,height){
    radius=radius||WALK_PLAYER_RADIUS_MM*U;height=height||1.74;
    if(isStairAt(a)||Math.abs(roomFloorAt(a.floor,a.x/U,a.z/U)-a.y)>0.015||!boundaryClear(a,b,radius))return false;
    var origin={x:a.x,y:a.y+height/2,z:a.z},direction=new THREE.Vector3(b.x-a.x,0,b.z-a.z),length=direction.length();
    if(length)direction.divideScalar(length);else direction.set(1,0,0);
    var testLength=Math.max(length,0.001),half={x:radius,y:height/2-.02,z:radius};
    return obstacles(a,ignore).every(function(box){
      if(!box.inverse)return F.castBoxes(origin,direction,testLength,half,[box])>=testLength;
      // Enclose the WORLD standing prism in the mesh's local frame before the
      // same continuous box cast. This avoids a rotated sofa's world AABB
      // incorrectly occupying its reachable front approach. The enclosure
      // remains conservative under non-uniform scaling and reflection.
      var inv=box.inverse,e=inv.elements;
      var start=new THREE.Vector3(origin.x,origin.y,origin.z).applyMatrix4(inv);
      var end=new THREE.Vector3(origin.x+direction.x*testLength,origin.y+direction.y*testLength,origin.z+direction.z*testLength).applyMatrix4(inv);
      var delta=end.sub(start),localLength=delta.length();
      if(!Number.isFinite(localLength)||localLength<=0)return false;
      delta.divideScalar(localLength);
      var pad={x:Math.abs(e[0])*half.x+Math.abs(e[4])*half.y+Math.abs(e[8])*half.z,
        y:Math.abs(e[1])*half.x+Math.abs(e[5])*half.y+Math.abs(e[9])*half.z,
        z:Math.abs(e[2])*half.x+Math.abs(e[6])*half.y+Math.abs(e[10])*half.z};
      return F.castBoxes(start,delta,localLength,pad,[box.local])>=localLength;
    });
  }
  function safe(p){return p.floor===WALK.floor&&!walkSpawnObstructed(p.x/U,p.z/U,p.floor)&&bodyClear(p,p,null);}
  function findSafe(p){
    var q=walkSpawnClearNear(p.x/U,p.z/U,p.floor);
    if(!q)return null;
    var next={x:q.x*U,y:roomFloorAt(p.floor,q.x,q.y),z:q.y*U,yaw:p.yaw,floor:p.floor};
    return safe(next)?next:null;
  }
  function restore(p){WALK.x=p.x;WALK.z=p.z;WALK.yaw=p.yaw;walkUpdateGround(true);}
  function socket(id){
    var entry=sockets.find(function(s){return String(s.item.id)===String(id)&&DATA.items.includes(s.item);});
    if(!entry)return null;
    var it=entry.item,s=entry.spec,g=entry.group,p=pose();
    if(s.version!==1||!['sit','mirror-pose','bath-pose'].includes(s.kind)||it.floor!==p.floor||!s.revision||!s.seat||!s.approach||!s.front)return null;
    var seat=g.localToWorld(new THREE.Vector3().fromArray(s.seat));
    var approach=g.localToWorld(new THREE.Vector3().fromArray(s.approach));
    var front=new THREE.Vector3().fromArray(s.front).transformDirection(g.matrixWorld);
    var ground=roomFloorAt(p.floor,approach.x/U,approach.z/U);approach.y=ground;
    var rel=new THREE.Vector3(p.x-seat.x,0,p.z-seat.z),side=Math.abs(rel.x*front.z-rel.z*front.x);
    var seatHeight=seat.y-ground,mirror=s.kind==='mirror-pose',bath=s.kind==='bath-pose',supportY=null;
    var yaw=mirror?Math.atan2(front.x,front.z):Math.atan2(-front.x,-front.z);
    if(bath){
      if(!s.support||!s.facing)return null;
      supportY=g.localToWorld(new THREE.Vector3().fromArray(s.support)).y;
      var facing=new THREE.Vector3().fromArray(s.facing).transformDirection(g.matrixWorld);
      yaw=Math.atan2(-facing.x,-facing.z);
      if(supportY-ground<.08||supportY-ground>.25)return null;
    }
    if(mirror){
      if(!s.target)return null;
      var target=g.localToWorld(new THREE.Vector3().fromArray(s.target));
      if(target.y-ground<.8||target.y-ground>1.6)return null;
      seat.y=ground;seatHeight=0;
    }
    var reachable=sceneReady&&(mirror||seatHeight>=0.2&&seatHeight<=0.65)&&Math.abs(ground-p.y)<0.015&&Math.hypot(p.x-approach.x,p.z-approach.z)<0.5&&
      (mirror||rel.dot(front)>0.3&&side<0.3)&&safe(p)&&(bath?bathClear(it,p,{x:seat.x,y:seat.y,z:seat.z,yaw:yaw,floor:it.floor},supportY):bodyClear(p,{x:seat.x,y:ground,z:seat.z},mirror?null:it,mirror?.6:undefined));
    return {kind:s.kind,signature:JSON.stringify([it.id,it.type,it.floor,it.x,it.y,it.w,it.d,it.rot,it.flipX,it.flipY,it.elev,it.showMirror,s,g.matrixWorld.elements]),approach:approach,reachable:reachable,supportY:supportY,
      pose:{x:seat.x,y:seat.y,z:seat.z,yaw:yaw,floor:it.floor}};
  }
  function bathClear(item,p,target,supportY){
    var key=JSON.stringify([collectionRevision,item.id,p.x,p.y,p.z,p.floor,target,supportY]);
    if(bathCache&&bathCache.key===key)return bathCache.value;
    var own=boxes.filter(function(b){return b.ref===item;}),surfaces=[],valid=own.length>0;
    own.forEach(function(b){var faces=root.WalkTpsMeshVolumes.surfaceBoxes(THREE,b);if(!faces)valid=false;else surfaces=surfaces.concat(faces);});
    if(!bathSafety)bathSafety=root.WalkTpsBathSafety.create(THREE,root.createWalkTpsPlaceholder,F);
    var clear=valid&&bathSafety.check({pose:target,supportY:supportY,origin:p,
      rimY:Math.max.apply(null,own.map(function(b){return b.max.y;})),surfaces:surfaces,obstacles:obstacles(p,item),
      boundary:sweep,approachClear:function(height){return bodyClear(p,p,null,.72,height);}});
    bathCache={key:key,value:!!clear};return !!clear;
  }
  function canExitAction(action){
    if(action.kind!=='bath-pose')return true;
    if(!sceneReady)return false;
    var s=socket(action.id);
    // Furniture deletion/transform invalidates the mock placement. The shared
    // controller still checks an external safe host origin before releasing it.
    return !s||s.signature!==action.signature||s.reachable===true;
  }
  function ensure(){
    if(controller)return;
    controller=F.create({readPose:pose,resolveSocket:socket,isSafe:safe,findSafe:findSafe,restorePose:restore,clearInput:clearInput,canExitAction:canExitAction,
      castCamera:function(a,d,l,r){return sceneReady?root.WalkTpsMeshVolumes.cast(THREE,a,d,l,r,boxes):NaN;},sweepCameraBoundary:sweep,
      readCameraProjection:function(){return {kind:'perspective',centered:!camExt.filmOffset&&!(camExt.view&&camExt.view.enabled),
        near:camExt.near,aspect:camExt.aspect,verticalFovDegrees:camExt.getEffectiveFOV()};}
    },prefs);
  }
  function updateUi(){
    var mode=document.getElementById('walk-tps-mode'),action=document.getElementById('walk-tps-action'),label=document.getElementById('walk-tps-status');
    if(!mode)return;
    var key=JSON.stringify([prefs.mode,candidate,candidateKind,output&&output.actionKind,output&&output.locked,output&&output.state==='blocked',output&&output.camera&&output.camera.verified,output&&output.camera&&output.camera.avatarVisible]);
    if(key===uiKey)return;uiKey=key;
    updateWalkEyePresetButton();
    mode.setAttribute('aria-pressed',String(prefs.mode==='tps'));mode.textContent=prefs.mode==='tps'?'一人称視点へ':'三人称視点へ';mode.title=prefs.mode==='tps'?'一人称視点へ切り替えます':'三人称視点へ切り替えます。人物と動作は仮モデルです';
    action.hidden=prefs.mode!=='tps';action.disabled=!(output&&output.locked)&&!candidate;
    action.textContent=output&&output.state==='blocked'?'退出を再確認':output&&output.locked?(output.actionKind==='bath-pose'?'出る / 解除':output.actionKind==='mirror-pose'?'ポーズ終了':'立つ / 解除'):candidateKind==='bath-pose'?'入浴姿勢（仮）':candidateKind==='mirror-pose'?'ポーズ（仮）':'座る';
    label.hidden=prefs.mode!=='tps';label.textContent=output&&output.state==='blocked'?'人物を非表示：安全な退出先がありません。障害物を除いて再確認、またはウォークスルー終了':
      output&&output.camera&&!output.camera.verified?'三人称視点を確認できないため一人称表示':
      output&&output.camera&&!output.camera.avatarVisible?'壁際：仮人物を一時非表示':output&&output.locked?(output.actionKind==='bath-pose'?'服あり・入浴姿勢（仮）':output.actionKind==='mirror-pose'?'仮モデル・鏡前ポーズ（仮）':'仮モデル・着座姿勢（仮）'):'仮モデル・仮歩行';
  }
  function update(dt){
    if(disposed||!isWalkView()||!WALK.active)return false;
    context();
    if(prefs.mode!=='tps'){updateUi();return false;}
    ensure();if(stale||WALK._doorsAnim)collect();
    if(!avatar){avatar=root.createWalkTpsPlaceholder(THREE);sc3.add(avatar.group);}
    var before=output;output=controller.tick(dt);if(!output)return false;
    avatar.pose(output,Number.isFinite(output.supportY)?output.supportY:pose().y);
    if(output.camera&&output.camera.verified){var c=output.camera;camExt.position.set(c.position.x,c.position.y,c.position.z);camExt.lookAt(c.target.x,c.target.y,c.target.z);}
    else walkApplyFpsCamera();
    candidate=null;candidateKind=null;
    if(!output.locked&&output.camera&&output.camera.verified&&output.camera.avatarVisible)for(var i=0;i<sockets.length;i++){var resolved=socket(sockets[i].item.id);if(resolved&&resolved.reachable){candidate=String(sockets[i].item.id);candidateKind=resolved.kind;break;}}
    updateUi();
    var changed=JSON.stringify(before)!==JSON.stringify(output);
    if(changed)invalidate3D(!before||before.phase!==output.phase||before.state!==output.state||JSON.stringify(before.avatar)!==JSON.stringify(output.avatar));
    return changed;
  }
  function setMode(mode){
    if(disposed)return false;context();ensure();if(stale)collect();
    if(!controller.setMode(mode)){update(0);return false;}prefs=controller.preference();
    if(mode==='fps'){releaseAvatar();output=null;walkApplyFpsCamera();}else update(0);
    updateUi();invalidate3D();return true;
  }
  function action(){if(!controller)return false;if(stale)collect();
    var ok=output&&output.locked?controller.cancel():candidate&&controller.requestAction(candidate);update(0);return !!ok;}
  function cancel(){if(!controller)return true;if(stale)collect();var ok=controller.cancel();update(0);return ok;}
  function dispose(){if(disposed)return;reset(true);if(controller)controller.dispose();disposed=true;root.removeEventListener('blur',blur);}
  function preservePlanStage(){
    planStages++;var ended=false;
    return function(){if(!ended){ended=true;planStages--;}};
  }
  function blur(){clearInput();}
  root.addEventListener('blur',blur);
  root.WalkTps={preservePlanStage:preservePlanStage,cameraVerified:function(){return !!(!disposed&&prefs.mode==='tps'&&output&&output.camera&&output.camera.verified);},update:update,invalidate:invalidate,reset:reset,dispose:dispose,cancel:cancel,action:action,setMode:setMode,
    toggle:function(){return setMode(prefs.mode==='tps'?'fps':'tps');},enabled:function(){return !disposed&&prefs.mode==='tps';},
    beforeMove:function(){context();if(output&&output.locked)clearInput();},
    preference:function(){return F.profile(prefs);},restorePreference:function(p){context();var mode=F.profile(p).mode;return mode===prefs.mode?true:setMode(mode);},
    debug:function(){return {output:output,candidate:candidate,candidateKind:candidateKind,boxes:boxes.length,sockets:sockets.length,sceneReady:sceneReady,bathQueryActive:!!bathSafety,disposed:disposed};}};
})(window);
