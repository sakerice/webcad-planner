/* Conservative mesh-volume refinement for thin, merged wall/door geometry.
 * A single mesh AABB can fill a real doorway. Triangle AABBs preserve its hole.
 * Thick volumes keep their full AABB: surface-only queries must never certify
 * a camera starting deep inside a solid. No renderer, loader or ownership. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./walk-tps-foundation.js'));
  else root.WalkTpsMeshVolumes=factory(root.WalkTpsFoundation);
})(typeof globalThis!=='undefined'?globalThis:this,function(F){
  'use strict';
  function parts(T,record,radius){
    var g=record.geometry,m=record.matrix;
    if(!g||!m||!g.boundingBox)return null;
    var size=g.boundingBox.getSize(new T.Vector3()),e=m.elements;
    var span=Math.min(size.x*Math.hypot(e[0],e[1],e[2]),size.y*Math.hypot(e[4],e[5],e[6]),size.z*Math.hypot(e[8],e[9],e[10]));
    // For a closed solid thinner than the sphere diameter, every interior
    // point is within radius of a surface along this local axis. Therefore
    // the expanded triangle boxes also cover its solid interior. Using them
    // for thicker objects would leave an unsafe hollow core.
    if(!Number.isFinite(span)||span>2*radius-1e-8)return null;
    return surfaceBoxes(T,record);
  }
  function surfaceBoxes(T,record){
    var g=record.geometry,m=record.matrix;
    if(!g||!m)return null;
    if(record.triangleBoxes!==undefined)return record.triangleBoxes;
    var p=g.attributes.position,index=g.index,count=index?index.count:p&&p.count;
    if(!p||!Number.isInteger(count)||count<3||count%3||count>12288)return record.triangleBoxes=null;
    var out=[],v=new T.Vector3();
    for(var i=0;i<count;i+=3){
      var b=new T.Box3();
      for(var j=0;j<3;j++){
        var at=index?index.getX(i+j):i+j;
        if(!Number.isInteger(at)||at<0||at>=p.count)return record.triangleBoxes=null;
        v.fromBufferAttribute(p,at).applyMatrix4(m);
        if(![v.x,v.y,v.z].every(Number.isFinite))return record.triangleBoxes=null;
        b.expandByPoint(v);
      }
      out.push(b);
    }
    return record.triangleBoxes=out;
  }
  function cast(T,origin,direction,length,radius,records){
    var nearest=length;
    for(var i=0;i<records.length&&nearest>0;i++){
      var r=records[i],broad=F.castBoxes(origin,direction,nearest,radius,[r]);
      if(broad>=nearest)continue;
      var refined=parts(T,r,radius);
      nearest=refined?F.castBoxes(origin,direction,nearest,radius,refined):broad;
    }
    return nearest;
  }
  return {cast:cast,surfaceBoxes:surfaceBoxes};
});
