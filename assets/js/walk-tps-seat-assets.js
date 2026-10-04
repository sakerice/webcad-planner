/* Explicit registration for an existing repository asset, not a type-name guess.
 * Source SHA256: 080358fb2baaab3a25aab9283f3e95bd1528c790da0b1896a4d55f24b13953e1.
 * Anchor measured from the decoded upward-facing cushion triangles. */
(function(root){
  'use strict';
  // The catalogue variant has byte-identical Draco geometry; textures differ.
  var urls=['assets/models/unity_exported/Sofa01.glb','assets/models/furniture_mega/glb/Sofa01.glb'],seat=[0,.819843590259552,0];
  function supports(path){return urls.includes(path);}
  function attach(clone,path){
    if(!supports(path)||!clone)return false;
    clone.updateMatrixWorld(true);
    var T=root.THREE,p=clone.localToWorld(new T.Vector3().fromArray(seat));
    var bounds=new T.Box3().setFromObject(clone),height=p.y-bounds.min.y;
    if(height<.3||height>.65||bounds.max.x-bounds.min.x<1)return false;
    var ray=new T.Raycaster(new T.Vector3(p.x,bounds.max.y+.1,p.z),new T.Vector3(0,-1,0));
    var hit=ray.intersectObject(clone,true)[0];
    if(!hit||Math.abs(hit.point.y-p.y)>.015||!hit.face||hit.face.normal.y<.9)return false;
    clone.userData.walkSeatSocket={version:1,kind:'sit',revision:'unity-sofa01-cushion-v1',
      seat:seat.slice(),front:[0,0,-1],approach:[0,0,-.9372053742408752-.65/Math.abs(clone.scale.z)]};
    return true;
  }
  root.WalkTpsSeatAssets={supports:supports,attach:attach};
})(window);
