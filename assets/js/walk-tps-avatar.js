/* Owned by one editor runtime. Procedural adult-size mock, NOT a Mixamo rig. */
(function(root){
  'use strict';
  root.createWalkTpsPlaceholder=function(T){
    var group=new T.Group(),geometries=[],legs=[],arms=[];
    group.name='TPS procedural placeholder';group.userData.walkTpsAvatar=true;
    var material=new T.MeshStandardMaterial({color:0x477787,roughness:0.8});
    var skin=new T.MeshStandardMaterial({color:0xcbb299,roughness:0.9});
    function block(parent,w,h,d,x,y,z,mat){
      var geometry=new T.BoxGeometry(w,h,d);geometries.push(geometry);
      var m=new T.Mesh(geometry,mat||material);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;
    }
    block(group,.38,.53,.22,0,1.14,0);block(group,.23,.28,.23,0,1.57,0,skin);
    block(group,.055,.06,.07,0,1.56,-.14,skin);
    [-1,1].forEach(function(side){
      var hip=new T.Group();hip.position.set(side*.115,.86,0);group.add(hip);
      block(hip,.14,.4,.15,0,-.2,0);
      var knee=new T.Group();knee.position.y=-.4;hip.add(knee);
      block(knee,.13,.4,.14,0,-.2,0);var foot=block(knee,.15,.075,.26,0,-.4225,-.045);foot.userData.walkTpsFoot=true;
      legs.push({hip:hip,knee:knee});
      var arm=new T.Group();arm.position.set(side*.27,1.35,0);group.add(arm);
      block(arm,.105,.51,.11,0,-.255,0);arms.push(arm);
    });
    var disposed=false;
    return {group:group,pose:function(s,groundY){
      if(disposed)return;
      var bathing=s.locked&&s.actionKind==='bath-pose';
      var posing=s.locked&&s.actionKind==='mirror-pose'&&s.state!=='blocked';
      var seated=s.locked&&s.actionKind!=='mirror-pose'&&(s.state!=='blocked'||bathing);
      // This pelvis offset belongs only to THIS mock. Never store it in sockets.
      group.position.set(s.avatar.x,s.avatar.y-(seated?.86:0),s.avatar.z);group.rotation.y=s.avatar.yaw;
      group.visible=!!(s.mode==='tps'&&s.camera&&s.camera.verified&&s.camera.avatarVisible);
      legs.forEach(function(l,i){
        var cycle=s.phase*Math.PI*2+(i?Math.PI:0),walking=s.state==='walking';
        var angle=walking?Math.sin(cycle)*.5:0;
        l.hip.rotation.x=seated?Math.PI/2:angle;
        l.knee.rotation.x=seated?-Math.PI/2:0;
        l.hip.position.y=.86;l.hip.position.x=(i?1:-1)*(bathing?.07:.115);
        // Mock-only shin fitting; this is not rig IK or a production motion.
        l.knee.scale.y=seated?Math.max(.1,(s.avatar.y-groundY)/.46):1;
        if(!seated){
          var sole=.86-.86*Math.cos(angle)+.045*Math.sin(angle)-.13*Math.abs(Math.sin(angle));
          var swing=walking?Math.max(0,Math.cos(cycle)):0;
          // The supporting foot contacts the host's flat floor. Lift the swing
          // foot without letting its tilted toe penetrate the floor.
          l.hip.position.y+=swing>1e-8?Math.max(0,-sole)+.045*swing:-sole;
        }
      });
      arms.forEach(function(a,i){a.position.x=(i?1:-1)*(bathing?.16:.27);a.rotation.x=bathing?1.0:posing?(i?.5:.95):seated?.4:s.state==='walking'?-Math.sin(s.phase*Math.PI*2+(i?Math.PI:0))*.35:0;});
    },dispose:function(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(function(g){g.dispose();});material.dispose();skin.dispose();}};
  };
})(window);
