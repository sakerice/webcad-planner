/* Converts the existing RoomGeometry cells to a conservative continuous boundary
 * query. No point sampling; empty cells and outside slabs are swept as solids. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./room-geometry.js'),require('./walk-tps-foundation.js'));
  else root.WalkTpsBoundary=factory(root.RoomGeometry,root.WalkTpsFoundation);
})(typeof globalThis!=='undefined'?globalThis:this,function(RoomGeometry,Tps){
  'use strict';
  function compile(rooms,revision){
    try{
      if(!Array.isArray(rooms)||!rooms.length||rooms.length>256)return null;
      var cells=[];
      rooms.forEach(function(room){
        var r=Object.assign({},room);
        if(r.shape)r.shape=RoomGeometry.normalize(r.shape);
        else if(![r.x,r.y,r.w,r.d].every(Number.isFinite)||r.w<=0||r.d<=0||
          Math.max(Math.abs(r.x),Math.abs(r.y),Math.abs(r.x+r.w),Math.abs(r.y+r.d))>1000000)throw Error('unsupported room');
        cells=cells.concat(RoomGeometry.cells(r));
      });
      if(!cells.length||cells.length>1024)return null;
      var xs=Array.from(new Set(cells.flatMap(function(c){return [c.x,c.x+c.w];}))).sort(function(a,b){return a-b;});
      var zs=Array.from(new Set(cells.flatMap(function(c){return [c.y,c.y+c.d];}))).sort(function(a,b){return a-b;});
      if((xs.length-1)*(zs.length-1)>16384)return null;
      var boxes=[],far=1000000;
      function box(x0,z0,x1,z1){boxes.push({min:{x:x0/1000,y:-far,z:z0/1000},max:{x:x1/1000,y:far,z:z1/1000}});}
      for(var i=0;i<xs.length-1;i++)for(var j=0;j<zs.length-1;j++){
        // Grid lines contain EVERY polygon edge from RoomGeometry.cells.
        // One midpoint classifies this whole exact cell, not samples of a path.
        var x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2;
        if(!cells.some(function(c){return x>c.x&&x<c.x+c.w&&z>c.y&&z<c.y+c.d;}))box(xs[i],zs[j],xs[i+1],zs[j+1]);
      }
      box(-far*1000,-far*1000,xs[0],far*1000);box(xs[xs.length-1],-far*1000,far*1000,far*1000);
      box(xs[0],-far*1000,xs[xs.length-1],zs[0]);box(xs[0],zs[zs.length-1],xs[xs.length-1],far*1000);
      return function(q){
        if(!q||q.contractVersion!==2||!q.volume||q.volume.kind!=='sphere'||!Number.isFinite(q.volume.radius)||q.volume.radius<0)return null;
        return {verification:'continuous-volume-v1',geometryRevision:String(revision),
          distance:Tps.castBoxes(q.origin,q.direction,q.length,q.volume.radius,boxes)};
      };
    }catch(e){return null;}
  }
  return {compile:compile};
});
