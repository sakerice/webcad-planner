/* Explicit existing-furniture affordances. No loader, renderer or asset ownership. */
(function(root){
  'use strict';
  function attachMirror(group,item,model,mirror){
    if(item.type!=='original-shoe-tall'||model.id!==item.type||!item.showMirror||!mirror||
      !Number.isFinite(item.w)||!Number.isFinite(item.d)||item.w<600||item.d<250)return false;
    // Uses the exact optional mirror already built by the host, in its parent frame.
    var p=[mirror.position.x,0,mirror.position.z+.85];
    group.userData.walkActionSocket={version:1,kind:'mirror-pose',revision:'original-shoe-tall-mirror-v1',
      seat:p.slice(),approach:p.slice(),front:[0,0,1],target:[mirror.position.x,mirror.position.y,mirror.position.z]};
    return true;
  }
  var bathPath='assets/models/original/original-bathtub.glb';
  function attachBath(clone,path){
    if(path!==bathPath||!clone)return false;
    clone.userData.walkActionSocket={version:1,kind:'bath-pose',revision:'original-bathtub-compact-mock-v1',
      seat:[-.24,.34,0],approach:[0,0,1.225],front:[0,0,1],facing:[1,0,0],support:[0,.14,0]};
    return true;
  }
  root.WalkTpsInteractions={attachMirror:attachMirror,attachBath:attachBath,requiresInstance:function(path){return path===bathPath;}};
})(window);
